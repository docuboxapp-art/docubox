import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireDocumentAccess, documentAccessResponse } from '@/lib/security/document-access';
import { signatureConsentSnapshot } from '@/lib/evidence-v2/consent';

const METHODS = new Set(['autografa', 'efirma', 'clicksign']);

function normalized(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const documentId = String(body.documentId || '');
    const method = String(body.method || '');
    const participantRecordId = String(body.participantRecordId || '');
    const signedAt = new Date(String(body.signedAt || '')).toISOString();
    if (!documentId || !participantRecordId || !METHODS.has(method)) {
      return NextResponse.json(
        { error: 'Datos de firma incompletos.', code: 'FINAL_SIGNATURE_INPUT_INVALID' },
        { status: 422 }
      );
    }
    const { user, document, service } = await requireDocumentAccess(request, documentId);
    const participant = Array.isArray(document.participantes)
      ? (document.participantes.find(
          (candidate: Record<string, unknown>) =>
            String(candidate.id || candidate.user_id || '') === participantRecordId
        ) as Record<string, unknown> | undefined)
      : undefined;
    const participantBelongsToUser =
      participant &&
      ([participant.id, participant.user_id].map(String).includes(user.id) ||
        (normalized(participant.email) !== '' &&
          normalized(participant.email) === normalized(user.email)));
    if (!participantBelongsToUser) {
      return NextResponse.json(
        { error: 'La participación no coincide con la sesión.', code: 'PARTICIPANT_MISMATCH' },
        { status: 403 }
      );
    }
    const versionResult = await service
      .from('document_versions')
      .select('id,sha256')
      .eq('document_id', documentId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (versionResult.error) throw versionResult.error;
    const consent = signatureConsentSnapshot(signedAt);
    const signatureId = randomUUID();
    let evidenceId = String(body.evidenceId || '');

    if (method === 'clicksign') {
      const inserted = await service
        .from('signature_evidence')
        .insert({
          capture_id: signatureId,
          signature_id: signatureId,
          document_id: documentId,
          document_version_id: versionResult.data?.id || null,
          participant_record_id: participantRecordId,
          captured_by: user.id,
          evidence_type: 'click_sign',
          evidence_role: 'FINAL_SIGNATURE',
          document_sha256: versionResult.data?.sha256 || null,
          digital_seal_sha256: body.signatureHash || null,
          captured_at: signedAt,
          signed_at: signedAt,
          consent_text_version: consent.textVersion,
          consent_text_sha256: consent.textHash,
          consent_accepted: true,
          consent_accepted_at: consent.acceptedAt,
          context_ip_status: body.ipAddress ? 'available' : 'unavailable',
          context_geo_status:
            body.latitude !== null && body.longitude !== null ? 'available' : 'unavailable',
          context_user_agent_status: request.headers.get('user-agent')
            ? 'available'
            : 'unavailable',
          ip_address: body.ipAddress || null,
          geo_latitude: body.latitude ?? null,
          geo_longitude: body.longitude ?? null,
          user_agent: request.headers.get('user-agent'),
        })
        .select('id')
        .single();
      if (inserted.error) throw inserted.error;
      evidenceId = inserted.data.id;
    } else {
      if (!evidenceId) {
        return NextResponse.json(
          {
            error: 'No existe evidencia técnica para esta firma.',
            code: 'SIGNATURE_EVIDENCE_REQUIRED',
          },
          { status: 409 }
        );
      }
      const updateValues: Record<string, unknown> = {
        participant_record_id: participantRecordId,
        document_version_id: versionResult.data?.id || null,
        document_sha256: versionResult.data?.sha256 || null,
        evidence_role: 'FINAL_SIGNATURE',
        signed_at: signedAt,
        consent_text_version: consent.textVersion,
        consent_text_sha256: consent.textHash,
        consent_accepted: true,
        consent_accepted_at: consent.acceptedAt,
      };
      if (method === 'autografa') updateValues.signature_id = signatureId;
      const updated = await service
        .from('signature_evidence')
        .update(updateValues)
        .eq('id', evidenceId)
        .eq('document_id', documentId)
        .eq('captured_by', user.id)
        .in('evidence_role', method === 'autografa' ? ['CAPTURE'] : ['FINAL_SIGNATURE'])
        .select('id')
        .maybeSingle();
      if (updated.error) throw updated.error;
      if (!updated.data) {
        return NextResponse.json(
          {
            error: 'No se pudo consolidar la evidencia de firma.',
            code: 'SIGNATURE_EVIDENCE_BINDING_FAILED',
          },
          { status: 409 }
        );
      }
    }

    return NextResponse.json({ ok: true, evidenceId, signatureId, consent });
  } catch (error) {
    const access = documentAccessResponse(error);
    if (access.status !== 500) return NextResponse.json(access.body, { status: access.status });
    console.error(
      '[finalize-signature-evidence]',
      error instanceof Error ? error.message : 'unknown'
    );
    return NextResponse.json(
      {
        error: 'No se pudo consolidar la evidencia de firma.',
        code: 'SIGNATURE_EVIDENCE_FINALIZATION_FAILED',
      },
      { status: 500 }
    );
  }
}
