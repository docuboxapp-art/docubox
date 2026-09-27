import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { participantEvidenceScope } from '@/lib/documents/participant-evidence-access';
import { documentAccessResponse } from '@/lib/security/document-access';
import { requireDocumentContentAccess } from '@/lib/security/document-content-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeEmail(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function date(value: unknown): string | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function notificationStatus(value: unknown) {
  const status = String(value || '').toLowerCase();
  if (status === 'delivered') return 'Entregada';
  if (status === 'failed' || status === 'bounced') return 'Fallida';
  if (status === 'accepted') return 'Aceptada por proveedor';
  return 'Enviada';
}

function participationStatus(value: unknown) {
  const status = String(value || '').toLowerCase();
  if (status === 'firmo' || status === 'firmado') return 'Firmó';
  if (status === 'aprobo' || status === 'aprobado') return 'Aprobó';
  if (status === 'rechazo' || status === 'rechazado') return 'Rechazó';
  if (status === 'cancelo' || status === 'cancelado') return 'Canceló';
  if (status === 'en_revision') return 'En revisión';
  if (status === 'sin_revisar') return 'Sin revisar';
  return status || 'Pendiente';
}

function signatureMethod(value: unknown) {
  const method = String(value || '').toLowerCase();
  if (method === 'autografa' || method === 'autograph' || method === 'autograph_otp')
    return 'Firma Autógrafa Digital';
  if (method === 'efirma' || method === 'efirma_sat') return 'e.firma SAT';
  if (method === 'click_sign' || method === 'clicksign') return 'Click & Sign';
  return String(value || 'No registrado');
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await context.params;
    const { user, document, service, role, additionalAccessLevel } = await requireDocumentContentAccess(
      request,
      documentId,
      'evidence'
    );
    const indexText = request.nextUrl.searchParams.get('participantIndex') || '';
    const index = Number(indexText);
    const participants = Array.isArray(document.participantes) ? document.participantes : [];
    if (!/^\d+$/.test(indexText) || !Number.isSafeInteger(index) || index >= participants.length) {
      return NextResponse.json({ error: 'Participante no encontrado.' }, { status: 404 });
    }

    const participant = record(participants[index]);
    const email = normalizeEmail(participant.email);
    const scope = additionalAccessLevel === 'evidence' ? 'full' : participantEvidenceScope({
      viewerId: user.id,
      viewerEmail: user.email || '',
      participantId: String(participant.id || ''),
      participantUserId: String(participant.user_id || ''),
      participantEmail: email,
      role,
    });
    const base = {
      participantName: String(participant.nombre || participant.name || 'Participante'),
      method: signatureMethod(participant.metodo_firma),
      action: String(participant.acto || 'Firmante'),
      status: participationStatus(participant.sub_estado || participant.estado),
      signedAt: date(participant.fecha_firma || participant.fecha_participacion),
      scope,
    };

    if (scope === 'summary') {
      return NextResponse.json(
        { data: base },
        { headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    const [responseResult, activityResult] = await Promise.all([
      email
        ? service
            .from('participation_responses')
            .select(
              'id,participante_id,participante_email,firma_completada,firma_completada_at,signature_method,signature_evidence_id,terminos_aceptados'
            )
            .eq('documento_id', documentId)
            .ilike('participante_email', email)
            .eq('firma_completada', true)
            .order('firma_completada_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      service
        .from('document_activity_log')
        .select('id,action,details,created_at')
        .eq('documento_id', documentId)
        .in('action', ['invitacion_enviada', 'recordatorio_enviado'])
        .order('created_at', { ascending: true })
        .limit(500),
    ]);
    if (responseResult.error) throw responseResult.error;
    if (activityResult.error) throw activityResult.error;

    const response = responseResult.data;
    const notificationRows = (activityResult.data || []).filter(
      (row) => normalizeEmail(record(row.details).participant_email) === email
    );
    const invitations = notificationRows.filter((row) => row.action === 'invitacion_enviada');
    const reminders = notificationRows.filter((row) => row.action === 'recordatorio_enviado');
    const invitationAt = date(participant.fecha_notificacion);
    const reminderAt = date(participant.fecha_recordatorio);
    const notificationHistory = [
      ...invitations.map((row) => ({
        id: row.id,
        type: 'initial' as const,
        at: date(row.created_at),
        status: notificationStatus(record(row.details).delivery_status),
      })),
      ...reminders.map((row) => ({
        id: row.id,
        type: 'reminder' as const,
        at: date(row.created_at),
        status: notificationStatus(record(row.details).delivery_status),
      })),
      ...(invitations.length === 0 && invitationAt
        ? [{ id: 'initial-record', type: 'initial' as const, at: invitationAt, status: 'Enviada' }]
        : []),
      ...(reminders.length === 0 && reminderAt
        ? [{ id: 'reminder-record', type: 'reminder' as const, at: reminderAt, status: 'Enviado' }]
        : []),
    ].sort((left, right) => String(left.at).localeCompare(String(right.at)));

    const evidenceSelect =
      'id,signature_id,evidence_type,evidence_role,is_voided,captured_at,signed_at,ip_address,user_agent,timezone,device_type,participant_name,participant_email,cert_subject,cert_rfc,cert_serial_number,cert_not_before,cert_not_after,ocsp_status,ocsp_checked_at,sign_algorithm,consent_accepted,consent_text_version,document_sha256,digital_seal_sha256,signature_hash,validation_provider,provider_reference';
    const evidenceResult = response?.signature_evidence_id
      ? await service
          .from('signature_evidence')
          .select(evidenceSelect)
          .eq('id', response.signature_evidence_id)
          .eq('document_id', documentId)
          .maybeSingle()
      : email
        ? await service
            .from('signature_evidence')
            .select(evidenceSelect)
            .eq('document_id', documentId)
            .ilike('participant_email', email)
            .eq('evidence_role', 'FINAL_SIGNATURE')
            .eq('is_voided', false)
            .order('signed_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        : { data: null, error: null };
    if (evidenceResult.error) throw evidenceResult.error;
    const evidence = evidenceResult.data?.is_voided ? null : evidenceResult.data;

    let otpVerified: boolean | null = null;
    if (evidence?.id && evidence.evidence_type === 'autograph_signature') {
      const otpResult = await service
        .from('document_activity_log')
        .select('details')
        .eq('documento_id', documentId)
        .eq('action', 'autografa_capturada')
        .order('created_at', { ascending: false })
        .limit(100);
      if (otpResult.error) throw otpResult.error;
      const capture = (otpResult.data || []).find(
        (row) => String(record(row.details).evidence_id || '') === evidence.id
      );
      const recordedOtp = record(capture?.details).otp_verified;
      if (typeof recordedOtp === 'boolean') otpVerified = recordedOtp;
    }

    return NextResponse.json(
      {
        data: {
          ...base,
          method: response?.signature_method
            ? signatureMethod(response.signature_method)
            : base.method,
          signedAt: date(response?.firma_completada_at || evidence?.signed_at || base.signedAt),
          notifications: {
            initial: notificationHistory.find((event) => event.type === 'initial') || null,
            lastReminder:
              notificationHistory.filter((event) => event.type === 'reminder').at(-1) || null,
            reminderCount: reminders.length || (reminderAt ? null : 0),
            history: notificationHistory,
          },
          evidence: evidence
            ? {
                id: evidence.id,
                signatureId: evidence.signature_id,
                type: evidence.evidence_type,
                signedAt: date(evidence.signed_at || evidence.captured_at),
                otpVerified,
                ipAddress: additionalAccessLevel
                  ? (evidence.ip_address ? 'Registrada' : null)
                  : evidence.ip_address,
                userAgent: additionalAccessLevel ? null : evidence.user_agent,
                deviceType: evidence.device_type,
                timezone: evidence.timezone,
                consentAccepted: evidence.consent_accepted ?? response?.terminos_aceptados ?? null,
                consentVersion: evidence.consent_text_version,
                documentName: document.file_name || document.nombre,
                documentHash: evidence.document_sha256,
                signatureHash: evidence.signature_hash || evidence.digital_seal_sha256,
                certificateSubject: evidence.cert_subject,
                certificateRfc: evidence.cert_rfc,
                certificateSerial: evidence.cert_serial_number,
                certificateNotBefore: date(evidence.cert_not_before),
                certificateNotAfter: date(evidence.cert_not_after),
                certificateStatus: evidence.ocsp_status,
                certificateCheckedAt: date(evidence.ocsp_checked_at),
                algorithm: evidence.sign_algorithm,
                validationProvider: evidence.validation_provider,
                providerReference: evidence.provider_reference,
              }
            : null,
        },
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    const access = documentAccessResponse(error);
    if (access.status !== 500) {
      return NextResponse.json(access.body, { status: access.status });
    }
    console.error('[participant-details] No fue posible cargar la evidencia:', error);
    return NextResponse.json(
      { error: 'No fue posible cargar la evidencia del participante.' },
      { status: 500 }
    );
  }
}
