import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendOwnerParticipantActionEmail } from '@/lib/emailNotifications';
import { createNotificationServer } from '@/lib/notificationsInApp';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '');

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    }

    const body = await req.json();
    const {
      documentId,
      signatureHash,
      ipAddress,
      geoLatitude,
      geoLongitude,
      capturedAt,
      efirmaSerial,
      efirmaRfc,
      efirmaNombre,
      efirmaVigenciaFin,
      userAgent,
      timezone,
      // New fields
      sessionEvidence,
      deviceFingerprint,
      userName,
      userEmail,
      userRole,
      clientTimestamp,
      // Nubarium validation result
      nubariumEstado,
      nubariumFechaConsulta,
      nubariumCodigoValidacion,
    } = body;

    if (!documentId) {
      return NextResponse.json({ error: 'documentId requerido' }, { status: 400 });
    }

    // Verify document exists and user is a participant
    const { data: documento } = await supabaseAdmin
      .from('documentos')
      .select('id, nombre, owner_id, participantes, workspace_id, file_size, created_at')
      .eq('id', documentId)
      .maybeSingle();

    if (!documento) {
      return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    }

    const { data: participacion } = await supabaseAdmin
      .from('participation_responses')
      .select('id')
      .eq('documento_id', documentId)
      .eq('participante_id', user.id)
      .maybeSingle();

    const isOwner = documento.owner_id === user.id;
    if (!participacion && !isOwner) {
      return NextResponse.json({ error: 'Sin permiso para firmar este documento' }, { status: 403 });
    }

    // Fetch workspace name
    let workspaceName: string | null = null;
    if (documento.workspace_id) {
      const { data: ws } = await supabaseAdmin
        .from('workspaces')
        .select('name')
        .eq('id', documento.workspace_id)
        .maybeSingle();
      workspaceName = ws?.name ?? null;
    }

    // Fetch document page count from document_metadata
    let documentPages: number | null = null;
    const { data: docMeta } = await supabaseAdmin
      .from('document_metadata')
      .select('pdf_page_count')
      .eq('document_id', documentId)
      .maybeSingle();
    if (docMeta?.pdf_page_count) {
      documentPages = docMeta.pdf_page_count;
    }

    // Determine participant role from participantes JSONB
    let participantRole: string | null = userRole ?? null;
    if (!participantRole && documento.participantes) {
      const parts: any[] = documento.participantes ?? [];
      const myPart = parts.find((p: any) =>
        p.email?.toLowerCase() === (user.email ?? '').toLowerCase() ||
        p.id === user.id
      );
      if (myPart) {
        participantRole = myPart.rol ?? myPart.role ?? null;
      }
    }

    // Parse device type from user agent
    const ua = sessionEvidence?.user_agent || userAgent || '';
    let deviceType: string | null = null;
    if (ua) {
      if (/iPhone/.test(ua)) deviceType = 'mobile';
      else if (/iPad/.test(ua)) deviceType = 'tablet';
      else if (/Android/.test(ua) && /Mobile/.test(ua)) deviceType = 'mobile';
      else if (/Android/.test(ua)) deviceType = 'tablet';
      else deviceType = 'desktop';
    }

    // Calculate document size in KB
    const documentSizeKb = documento.file_size ? Math.round((documento.file_size / 1024) * 100) / 100 : null;

    // Insert e.firma evidence record
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('signature_evidence')
      .insert({
        document_id: documentId,
        evidence_type: 'efirma_sat',
        signature_hash: signatureHash || null,
        ip_address: ipAddress || null,
        geo_latitude: geoLatitude ?? null,
        geo_longitude: geoLongitude ?? null,
        // captured_at intentionally omitted — DB uses NOW() as authoritative server timestamp
        captured_by: user.id,
        efirma_serial: efirmaSerial || null,
        efirma_rfc: efirmaRfc || null,
        efirma_nombre: efirmaNombre || null,
        efirma_vigencia_fin: efirmaVigenciaFin || null,
        user_agent: sessionEvidence?.user_agent || userAgent || null,
        timezone: sessionEvidence?.timezone || timezone || null,

        // ── New fields ──────────────────────────────────────────────────────
        // Device / session
        language: sessionEvidence?.language ?? deviceFingerprint?.language ?? null,
        screen_resolution: sessionEvidence?.screen ?? deviceFingerprint?.screen_resolution ?? null,
        device_type: deviceType,
        cpu_cores: deviceFingerprint?.cpu_cores ?? null,
        device_memory_gb: deviceFingerprint?.device_memory_gb ?? null,

        // Device fingerprint extras
        canvas_hash: deviceFingerprint?.canvas_hash ?? null,
        webgl_renderer: deviceFingerprint?.webgl_renderer ?? null,
        audio_hash: deviceFingerprint?.audio_hash ?? null,

        // Geolocation extras
        geo_source: sessionEvidence?.geo?.source ?? null,
        country: sessionEvidence?.geo?.country ?? null,
        region: sessionEvidence?.geo?.region ?? null,

        // Client-side timestamp
        client_timestamp: clientTimestamp ?? null,

        // Document context snapshot
        workspace_id: documento.workspace_id ?? null,
        workspace_name: workspaceName,
        document_pages: documentPages,
        document_size_kb: documentSizeKb,
        document_created_at: documento.created_at ?? null,

        // Participant identity snapshot
        participant_name: userName ?? efirmaNombre ?? null,
        participant_email: userEmail ?? user.email ?? null,
        participant_role: participantRole,

        // Nubarium validation result
        nubarium_estado: nubariumEstado ?? null,
        nubarium_fecha_consulta: nubariumFechaConsulta ?? null,
        nubarium_codigo_validacion: nubariumCodigoValidacion ?? null,
      })
      .select('id, captured_at')
      .single();

    if (insertError) {
      console.error('Error inserting e.firma evidence:', insertError);
      // Non-fatal — return partial success
      return NextResponse.json({ success: true, evidenceId: null, warning: insertError.message });
    }

    // Log activity
    await supabaseAdmin
      .from('document_activity_log')
      .insert({
        documento_id: documentId,
        actor_id: user.id,
        actor_email: user.email || '',
        action: 'efirma_sat_completada',
        category: 'firma',
        details: {
          evidence_id: inserted?.id,
          efirma_serial: efirmaSerial,
          efirma_rfc: efirmaRfc,
          hash: signatureHash,
          ip: ipAddress,
        },
      })
      .catch(() => {});

    // ── Update participant sub_estado to 'firmado' ─────────────────────────
    await supabaseAdmin.rpc('update_participante_sub_estado', {
      p_documento_id: documentId,
      p_email: user.email,
      p_sub_estado: 'firmado',
    }).catch(() => {});

    // ── Check if ALL participants completed; advance chain if not ──────────
    const TERMINAL_ESTADOS = ['firmo','firmado','aprobo','aprobado','rechazo','rechazado','cancelo','cancelado'];
    const { data: updatedDoc } = await supabaseAdmin
      .from('documentos')
      .select('participantes, estado, owner_id, nombre')
      .eq('id', documentId)
      .maybeSingle();

    if (updatedDoc && updatedDoc.estado !== 'completado' && updatedDoc.estado !== 'cancelado') {
      const participantes: any[] = updatedDoc.participantes ?? [];
      const allCompleted =
        participantes.length > 0 &&
        participantes.every((p: any) => TERMINAL_ESTADOS.includes((p.sub_estado ?? '').toLowerCase()));

      if (allCompleted) {
        const now = new Date().toISOString();
        await supabaseAdmin
          .from('documentos')
          .update({ estado: 'completado', fecha_completado: now })
          .eq('id', documentId);

        await supabaseAdmin
          .from('document_activity_log')
          .insert({
            documento_id: documentId,
            user_id: user.id,
            action: 'documento_completado',
            details: {
              motivo: 'Todos los participantes han completado su participación (e.firma)',
              total_participantes: participantes.length,
            },
          })
          .catch(() => {});
      } else {
        // ── Advance participation chain for sequential/mixed orders ──────────
        try {
          const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || '';
          const authHeader = req.headers.get('authorization') || '';
          await fetch(`${siteUrl}/api/documentos/advance-participation`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': authHeader,
            },
            body: JSON.stringify({ documentoId: documentId }),
          });
        } catch (advErr) {
          console.error('[persist-efirma-evidence] Error advancing participation chain:', advErr);
        }
      }
    }

    // ── Notify owner when participant signs via e.firma ────────────────────
    if (updatedDoc?.owner_id && updatedDoc.owner_id !== user.id) {
      const actorName = userName || efirmaNombre || user.email || 'Un participante';
      const docName = updatedDoc.nombre || 'Documento';

      createNotificationServer({
        userId: updatedDoc.owner_id,
        type: 'document',
        title: 'Participante firmó con e.Firma SAT',
        description: `${actorName} ha firmado "${docName}" con e.Firma SAT.`,
        priority: 'media',
        metadata: { documentoId: documentId, documentName: docName, signerEmail: user.email },
      }).catch(() => {});

      const { data: ownerProfile } = await supabaseAdmin
        .from('profiles')
        .select('full_name, email')
        .eq('id', updatedDoc.owner_id)
        .maybeSingle();

      if (ownerProfile?.email) {
        sendOwnerParticipantActionEmail({
          ownerEmail: ownerProfile.email,
          ownerName: ownerProfile.full_name || undefined,
          documentName: docName,
          participantName: actorName,
          participantEmail: userEmail || user.email,
          action: 'firmado',
          completedAt: new Date().toISOString(),
        }).catch(() => {});
      }
    }

    return NextResponse.json({
      success: true,
      evidenceId: inserted?.id,
      capturedAt: inserted?.captured_at,
      serverTimestamp: inserted?.captured_at ?? new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('persist-efirma-evidence error:', err);
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 });
  }
}
