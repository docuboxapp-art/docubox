import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendOwnerParticipantActionEmail } from '@/lib/emailNotifications';
import { createNotificationServer } from '@/lib/notificationsInApp';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Terminal sub_estados that count as "participated"
const TERMINAL_SUB_ESTADOS = ['firmo', 'firmado', 'aprobo', 'aprobado', 'rechazo', 'rechazado', 'cancelo', 'cancelado'];

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '');

    // Verify user
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    }

    const body = await req.json();
    const {
      documentId,
      documentName,
      userName,
      userEmail,
      userRole,
      evidenceId,
      imageSha256,
      strokesSha256,
      combinedSha256,
      totalStrokes,
      totalDurationMs,
      humanScore,
      anomalyFlags,
      avgPressure,
      capturedAt,
      ipAddress,
      fingerprintId,
      chainHash,
      otpVerified,
      biometric,
      sessionEvidence,
      deviceFingerprint,
      humanBehavior,
      clientTimestamp,
    } = body;

    if (!documentId) {
      return NextResponse.json({ error: 'documentId requerido' }, { status: 400 });
    }

    // Verify user is a participant of this document
    const { data: participacion } = await supabaseAdmin
      .from('participation_responses')
      .select('id, participante_id')
      .eq('documento_id', documentId)
      .eq('participante_id', user.id)
      .maybeSingle();

    // Fetch document with workspace and file info
    const { data: documento } = await supabaseAdmin
      .from('documentos')
      .select('id, nombre, estado, owner_id, participantes, workspace_id, file_size, created_at')
      .eq('id', documentId)
      .maybeSingle();

    if (!documento) {
      return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    }

    const isOwner = documento.owner_id === user.id;
    if (!participacion && !isOwner) {
      return NextResponse.json({ error: 'No tienes permiso para firmar este documento' }, { status: 403 });
    }

    // Fetch workspace name if workspace_id exists
    let workspaceName: string | null = null;
    if (documento.workspace_id) {
      const { data: ws } = await supabaseAdmin
        .from('workspaces')
        .select('name')
        .eq('id', documento.workspace_id)
        .maybeSingle();
      workspaceName = ws?.name ?? null;
    }

    // Fetch document page count from document_metadata (pdf_page_count)
    // documentos table uses 'id' as PK; document_metadata references documents(id)
    // Try to get pages from document_metadata if available
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

    // Parse device type from user agent if not provided
    const ua = sessionEvidence?.user_agent || '';
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

    // Insert into signature_evidence using service role (bypasses RLS)
    const evidencePayload: Record<string, any> = {
      document_id: documentId,
      evidence_type: 'autograph_signature',
      image_sha256: imageSha256,
      strokes_sha256: strokesSha256,
      combined_sha256: combinedSha256,
      human_score: humanScore,
      anomaly_flags: anomalyFlags || [],
      total_strokes: totalStrokes,
      total_duration_ms: totalDurationMs,
      avg_pressure: avgPressure,
      ip_address: ipAddress,
      user_agent: sessionEvidence?.user_agent,
      timezone: sessionEvidence?.timezone,
      geo_latitude: sessionEvidence?.geo?.latitude,
      geo_longitude: sessionEvidence?.geo?.longitude,
      geo_accuracy_m: sessionEvidence?.geo?.accuracy_meters,
      fingerprint_id: fingerprintId,
      chain_hash: chainHash,
      captured_at: capturedAt || new Date().toISOString(),
      captured_by: user.id,

      // ── New fields ──────────────────────────────────────────────────────────
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
      country_code: sessionEvidence?.geo?.country_code ?? null,
      region: sessionEvidence?.geo?.region ?? null,
      city: sessionEvidence?.geo?.city ?? null,

      // Client-side timestamp
      client_timestamp: clientTimestamp ?? null,

      // Human behavior metrics
      total_points: humanBehavior?.total_points ?? null,
      avg_speed_px_s: humanBehavior?.avg_speed_px_s ?? null,
      max_speed_px_s: humanBehavior?.max_speed_px_s ?? null,

      // Document context snapshot
      workspace_id: documento.workspace_id ?? null,
      workspace_name: workspaceName,
      document_pages: documentPages,
      document_size_kb: documentSizeKb,
      document_created_at: documento.created_at ?? null,

      // Participant identity snapshot
      participant_name: userName ?? null,
      participant_email: userEmail ?? user.email ?? null,
      participant_role: participantRole,
    };

    if (biometric) {
      evidencePayload.face_match_score = biometric.face_match_score;
      evidencePayload.face_match_verdict = biometric.face_match_verdict;
      evidencePayload.biometric_method = biometric.method;
    }

    // Use upsert to avoid duplicate if already persisted
    const { data: insertedEvidence, error: evidenceError } = await supabaseAdmin
      .from('signature_evidence')
      .insert(evidencePayload)
      .select('id, captured_at')
      .single();

    if (evidenceError) {
      console.error('Error inserting signature_evidence:', evidenceError);
      // If already exists, that's ok — continue
      if (!evidenceError.message?.includes('duplicate') && !evidenceError.message?.includes('unique')) {
        return NextResponse.json({ error: 'Error al guardar evidencia: ' + evidenceError.message }, { status: 500 });
      }
    }

    // Update participation_responses to mark as signed
    if (participacion) {
      await supabaseAdmin
        .from('participation_responses')
        .update({
          estado: 'firmado',
          fecha_respuesta: new Date().toISOString(),
        })
        .eq('id', participacion.id);
    }

    // Update participant sub_estado in documentos.participantes JSONB
    const userEmailLower = (user.email || '').toLowerCase();
    if (userEmailLower) {
      const { error: participantStateError } = await supabaseAdmin.rpc('update_participante_sub_estado', {
        p_documento_id: documentId,
        p_email: user.email,
        p_sub_estado: 'firmado',
      });
      if (participantStateError) {
        console.warn('[persist-evidence] No se pudo actualizar el subestado:', participantStateError.message);
      }
    }

    // ── Check if ALL participants have completed and close document if so ──
    // Re-fetch updated participantes
    const { data: updatedDoc } = await supabaseAdmin
      .from('documentos')
      .select('participantes, estado')
      .eq('id', documentId)
      .maybeSingle();

    if (updatedDoc && updatedDoc.estado !== 'completado' && updatedDoc.estado !== 'cancelado') {
      const participantes: any[] = updatedDoc.participantes ?? [];
      const allCompleted =
        participantes.length > 0 &&
        participantes.every((p: any) => {
          const sub = (p.sub_estado ?? '').toLowerCase();
          return TERMINAL_SUB_ESTADOS.includes(sub);
        });

      if (allCompleted) {
        const now = new Date().toISOString();
        await supabaseAdmin
          .from('documentos')
          .update({ estado: 'completado', fecha_completado: now })
          .eq('id', documentId);

        // Log completion activity
        const { error: completionLogError } = await supabaseAdmin
          .from('document_activity_log')
          .insert({
            documento_id: documentId,
            user_id: user.id,
            action: 'documento_completado',
            details: {
              motivo: 'Todos los participantes han completado su participación',
              total_participantes: participantes.length,
            },
          });
        if (completionLogError) {
          console.warn('[persist-evidence] No se pudo registrar el cierre:', completionLogError.message);
        }
      } else {
        // ── Advance participation chain for sequential/mixed orders ──────────
        // Call advance-participation to notify the next participant(s) in line
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
          console.error('[persist-evidence] Error advancing participation chain:', advErr);
          // Non-critical — document is already saved
        }
      }
    }

    // Log activity
    const { error: signatureLogError } = await supabaseAdmin
      .from('document_activity_log')
      .insert({
        documento_id: documentId,
        user_id: user.id,
        action: 'firma_autografa_completada',
        details: {
          evidence_id: insertedEvidence?.id || evidenceId,
          otp_verified: otpVerified,
          human_score: humanScore,
          has_biometric: !!biometric,
        },
      });
    if (signatureLogError) {
      console.warn('[persist-evidence] No se pudo registrar la firma:', signatureLogError.message);
    }

    // ── Notify owner when participant signs/approves ───────────────────────
    if (documento.owner_id && documento.owner_id !== user.id) {
      const actorName = userName || user.email || 'Un participante';
      const docName = documento.nombre || documentName || 'Documento';

      // In-app notification to owner
      createNotificationServer({
        userId: documento.owner_id,
        type: 'document',
        title: 'Participante firmó el documento',
        description: `${actorName} ha firmado "${docName}".`,
        priority: 'media',
        metadata: { documentoId: documentId, documentName: docName, signerEmail: user.email },
      }).catch(() => {});

      // Email to owner
      const { data: ownerProfile } = await supabaseAdmin
        .from('profiles')
        .select('full_name, email')
        .eq('id', documento.owner_id)
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
      evidenceId: insertedEvidence?.id || evidenceId,
      capturedAt: insertedEvidence?.captured_at || capturedAt,
      documentName: documento.nombre || documentName,
      userName: userName || user.email,
      userEmail: userEmail || user.email,
    });
  } catch (err: any) {
    console.error('persist-evidence error:', err);
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 });
  }
}
