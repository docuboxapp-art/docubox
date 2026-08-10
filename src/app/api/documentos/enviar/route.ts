import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendParticipantInvitationEmails } from '@/lib/emailNotifications';
import { createNotificationServer } from '@/lib/notificationsInApp';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Reliable two-step workspace lookup
async function resolvePersonalWorkspace(userId: string): Promise<string | null> {
  try {
    const { data: memberships, error: memberErr } = await supabaseAdmin
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', userId);

    if (memberErr || !memberships || memberships.length === 0) return null;

    const workspaceIds = memberships.map((m: any) => m.workspace_id);

    const { data: personalWs, error: wsErr } = await supabaseAdmin
      .from('workspaces')
      .select('id')
      .in('id', workspaceIds)
      .eq('workspace_type', 'personal')
      .limit(1)
      .maybeSingle();

    if (wsErr || !personalWs) return null;
    return personalWs.id;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    // Verify authenticated user via JWT
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    // Parse multipart form data
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const metaRaw = formData.get('meta') as string | null;

    if (!metaRaw) {
      return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
    }

    const {
      documentoId,
      fileName,
      fileSize,
      fileType,
      fileHashSha256,
      nombre,
      descripcion,
      numeroOficio,
      grupotipoId,
      tipoDocumentoId,
      ruta,
      etiquetasIds,
      participantes,
      camposSolicitados,
      workspaceId,
      otroTipoDocumento,
      participationOrder,
      gruposFirma,
      publico,
      selloDigital,
      estampaAutenticacion,
      metadatosAdicionales,
    } = JSON.parse(metaRaw);

    if (!documentoId || !fileName || !fileHashSha256) {
      return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
    }

    // Resolve workspace_id using reliable two-step lookup
    let resolvedWorkspaceId: string | null = workspaceId || null;

    // Verify provided workspaceId actually belongs to this user
    if (resolvedWorkspaceId) {
      const { data: wCheck } = await supabaseAdmin
        .from('workspace_members')
        .select('workspace_id')
        .eq('workspace_id', resolvedWorkspaceId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!wCheck) resolvedWorkspaceId = null;
    }

    // If no valid workspace provided, find the user's personal workspace
    if (!resolvedWorkspaceId) {
      resolvedWorkspaceId = await resolvePersonalWorkspace(user.id);
    }

    // Upsert document record using service role (bypasses RLS)
    // ── Determine initial visible participants based on participation order ──
    const TERMINAL_SUB_ESTADOS_ENVIAR = ['firmo','firmado','aprobo','aprobado','rechazo','rechazado','cancelo','cancelado'];
    function isTerminalEnviar(sub: string): boolean {
      return TERMINAL_SUB_ESTADOS_ENVIAR.includes((sub ?? '').toLowerCase());
    }

    function getInitialVisibleParticipants(
      parts: any[],
      order: string,
      grupos: any[]
    ): any[] {
      const nonOwner = parts.filter((p: any) => !p.isCurrentUser);
      if (!order || order === 'paralelo') {
        return nonOwner;
      }
      if (order === 'secuencial') {
        const first = nonOwner[0];
        return first ? [first] : [];
      }
      if (order === 'mixto' && grupos && grupos.length > 0) {
        const firstGrupo = grupos[0];
        const grupoTipo = firstGrupo?.tipo ?? 'paralelo';
        const grupoIds: string[] = firstGrupo?.participantIds ?? [];
        const grupoParticipants = parts.filter((p: any) => grupoIds.includes(p.id) && !p.isCurrentUser);
        if (grupoTipo === 'paralelo') return grupoParticipants;
        if (grupoTipo === 'secuencial') {
          const ordered = grupoIds.map((id: string) => parts.find((p: any) => p.id === id)).filter(Boolean);
          const first = ordered.find((p: any) => !p.isCurrentUser);
          return first ? [first] : [];
        }
        return grupoParticipants;
      }
      return nonOwner;
    }

    const effectiveOrder: string = participationOrder || 'paralelo';
    const effectiveGrupos: any[] = gruposFirma || [];
    const initialVisibleIds = new Set(
      getInitialVisibleParticipants(participantes || [], effectiveOrder, effectiveGrupos).map((p: any) => p.id)
    );

    // Mark visible/notificado flags on participants
    const participantesConVisibilidad = (participantes || []).map((p: any) => ({
      ...p,
      visible: p.isCurrentUser ? true : initialVisibleIds.has(p.id),
      notificado: p.isCurrentUser ? true : initialVisibleIds.has(p.id),
    }));

    const { error: upsertError } = await supabaseAdmin.from('documentos').upsert({
      documento_id: documentoId,
      owner_id: user.id,
      workspace_id: resolvedWorkspaceId,
      file_name: fileName,
      file_size: fileSize,
      file_type: fileType || 'application/octet-stream',
      file_hash_sha256: fileHashSha256,
      nombre: nombre || fileName.replace(/\.[^/.]+$/, ''),
      descripcion: descripcion || null,
      numero_oficio: numeroOficio || null,
      grupo_tipo_documento_id: grupotipoId || null,
      tipo_documento_id: tipoDocumentoId || null,
      otro_tipo_documento: (tipoDocumentoId === '__otros__' ? (otroTipoDocumento || null) : null),
      ruta_guardado: ruta || 'raiz',
      etiquetas_ids: etiquetasIds || [],
      estado: 'en_proceso',
      participantes: participantesConVisibilidad,
      campos_solicitados: camposSolicitados || [],
      participation_order: effectiveOrder,
      grupos_firma: effectiveGrupos.length > 0 ? effectiveGrupos : null,
      es_publico: publico ?? false,
      sello_digital: selloDigital ?? false,
      estampa_autenticacion: estampaAutenticacion ?? false,
      metadatos_adicionales: metadatosAdicionales ?? false,
    }, { onConflict: 'documento_id' });

    if (upsertError) {
      console.error('[DOCUBOX][enviar] Error en upsert documentos:', upsertError.message);
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    // Retrieve the DB UUID for the document
    const { data: docRow, error: selectError } = await supabaseAdmin
      .from('documentos')
      .select('id')
      .eq('documento_id', documentoId)
      .single();

    if (selectError || !docRow) {
      console.error('[DOCUBOX][enviar] Error al obtener id del documento:', selectError?.message);
      return NextResponse.json({ error: 'No se pudo obtener el id del documento' }, { status: 500 });
    }

    const dbDocumentId = docRow.id;

    // Upload file to storage using service role (bypasses storage RLS)
    if (file) {
      const safeFileName = fileName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9.\-_]/g, '_');

      const wsId = resolvedWorkspaceId || user.id;
      const storagePath = `${wsId}/${dbDocumentId}/${safeFileName}`;

      const fileBuffer = await file.arrayBuffer();

      const { error: uploadError } = await supabaseAdmin.storage
        .from('documents')
        .upload(storagePath, fileBuffer, {
          upsert: true,
          contentType: file.type || fileType || 'application/octet-stream',
        });

      if (uploadError) {
        console.error('[DOCUBOX][enviar] Error al subir archivo:', uploadError.message);
        return NextResponse.json({ error: uploadError.message || 'Error al subir el archivo' }, { status: 500 });
      }

      // Save the storage path as file_url so mis-documentos can display/download it
      const { data: signedUrlData } = await supabaseAdmin.storage
        .from('documents')
        .createSignedUrl(storagePath, 60 * 60 * 24 * 365); // 1 year

      await supabaseAdmin
        .from('documentos')
        .update({ file_url: signedUrlData?.signedUrl || storagePath })
        .eq('id', dbDocumentId);
    }

    // ── Send invitation email notifications for participants with email method ──
    try {
      // Send invitation only to participants who have 'correo' or 'email' in tipoNotificacion
      // AND have a valid email address
      // ── IMPORTANT: Only notify the initial visible participants based on participation order ──
      const allEmailParticipants = (participantesConVisibilidad || []).filter(
        (p: { email?: string; isCurrentUser?: boolean; tipoNotificacion?: string[]; visible?: boolean }) => {
          if (!p.email || p.isCurrentUser) return false;
          if (!p.email.includes('@')) return false;
          // Only notify participants who are visible (first batch based on order)
          if (!p.visible) return false;
          // Check if participant selected email as notification method
          const notifMethods = (p.tipoNotificacion || []).map((n: string) => n.toLowerCase());
          return notifMethods.some((n: string) => n === 'correo' || n === 'email');
        }
      );

      const { data: senderProfile } = await supabaseAdmin
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle();
      const senderName = senderProfile?.full_name || user.email || 'Un usuario';

      // ── In-app notification: notify each participant who has a user_id ────
      for (const p of (participantesConVisibilidad || [])) {
        if (p.isCurrentUser) continue;
        // Only notify visible participants (first batch)
        if (!p.visible) continue;
        const participantUserId = (p as any).user_id;
        if (participantUserId) {
          createNotificationServer({
            userId: participantUserId,
            type: 'document',
            title: 'Has sido invitado a participar en un documento',
            description: `${senderName} te ha invitado a participar en "${nombre || fileName}".`,
            priority: 'alta',
            metadata: {
              documentoId: dbDocumentId,
              documentName: nombre || fileName,
              senderName,
              role: (p as any).acto || 'Participante',
            },
          }).catch(() => {});
        }
      }

      // Send invitation emails to all participants with a valid email
      if (allEmailParticipants.length > 0) {
        console.log(`[DOCUBOX][enviar] Sending invitation emails to ${allEmailParticipants.length} participants`);

        // Build portal URLs per participant — always use the document's DB UUID as token
        // (the portal page resolves it via the /api/portal-participante/info endpoint)
        const participantsWithPortalUrl = allEmailParticipants.map((p: any) => {
          const portalToken = p.portal_token || dbDocumentId;
          return {
            ...p,
            documentUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/portal-participante/${portalToken}`,
          };
        });

        await sendParticipantInvitationEmails({
          participants: participantsWithPortalUrl,
          documentName: nombre || fileName,
          documentDescription: descripcion || undefined,
          senderName,
          documentUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/portal-participante/${dbDocumentId}`,
        });
      } else {
        console.log('[DOCUBOX][enviar] No participants with email found — skipping email notifications');
      }

      const allNotifiedParticipants = allEmailParticipants;

      if (allNotifiedParticipants.length > 0) {
        // ── Stamp fecha_notificacion on each participant in JSONB ──────────
        try {
          const { data: docRow2 } = await supabaseAdmin
            .from('documentos')
            .select('participantes')
            .eq('id', dbDocumentId)
            .single();

          if (docRow2?.participantes) {
            const now = new Date().toISOString();
            const updatedParticipantes = (docRow2.participantes as any[]).map((p: any) => {
              const isNotified = allNotifiedParticipants.some(
                (ep: { email?: string }) => ep.email && ep.email === p.email
              );
              if (isNotified) {
                return { ...p, fecha_notificacion: now };
              }
              return p;
            });
            await supabaseAdmin
              .from('documentos')
              .update({ participantes: updatedParticipantes })
              .eq('id', dbDocumentId);
          }
        } catch (stampErr) {
          console.error('[DOCUBOX][enviar] Error al marcar fecha_notificacion:', stampErr);
        }

        // ── Log audit trail: invitacion_enviada per participant ────────────
        try {
          const auditRows = allNotifiedParticipants.map((p: { email?: string; name?: string; tipoNotificacion?: string[] }) => ({
            documento_id: dbDocumentId,
            actor_id: user.id,
            action: 'invitacion_enviada',
            category: 'notificacion',
            details: {
              participant_email: p.email,
              participant_name: p.name,
              channel: 'email',
              email_type: (p.tipoNotificacion || []).some((n: string) => ['correo', 'email'].includes(n.toLowerCase()))
                ? 'participant_invitation' :'signature_request',
            },
          }));
          await supabaseAdmin.from('audit_trail').insert(auditRows);
        } catch (auditErr) {
          console.error('[DOCUBOX][enviar] Error al registrar audit trail:', auditErr);
        }
      }
    } catch (emailErr) {
      console.error('[DOCUBOX][enviar] Error al enviar notificaciones de firma:', emailErr);
      // Non-blocking: document was already saved successfully
    }

    return NextResponse.json({ success: true, dbDocumentId }, { status: 200 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    console.error('[DOCUBOX][enviar] Error inesperado:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
