import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireDocumentAccess, documentAccessResponse } from '@/lib/security/document-access';
import { signatureConsentSnapshot } from '@/lib/evidence-v2/consent';

const METHODS = new Set(['autografa', 'efirma', 'clicksign']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    const requestedParticipantRecordId = String(body.participantRecordId || '');
    const signedAt = new Date(String(body.signedAt || '')).toISOString();
    if (!documentId || !requestedParticipantRecordId || !METHODS.has(method)) {
      return NextResponse.json(
        { error: 'Datos de firma incompletos.', code: 'FINAL_SIGNATURE_INPUT_INVALID' },
        { status: 422 }
      );
    }
    const { user, document, service } = await requireDocumentAccess(request, documentId);
    const participant = Array.isArray(document.participantes)
      ? (document.participantes.find((candidate: Record<string, unknown>) => {
          const candidateIds = [candidate.user_id, candidate.id].map((value) =>
            String(value || '').trim()
          );
          return (
            candidateIds.includes(requestedParticipantRecordId) ||
            candidateIds.includes(user.id) ||
            (normalized(candidate.email) !== '' &&
              normalized(candidate.email) === normalized(user.email))
          );
        }) as Record<string, unknown> | undefined)
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
    const participantRecordId =
      [participant?.user_id, participant?.id, requestedParticipantRecordId, user.id]
        .map((value) => String(value || '').trim())
        .find((value) => UUID_PATTERN.test(value)) || user.id;
    const versionResult = await service
      .from('document_versions')
      .select('id,sha256')
      .eq('document_id', documentId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (versionResult.error) throw versionResult.error;
    const consent = signatureConsentSnapshot(signedAt);
    const requestedAttemptId = String(body.attemptId || '');
    const signatureId = UUID_PATTERN.test(requestedAttemptId) ? requestedAttemptId : randomUUID();
    let finalizedSignatureId = signatureId;
    let evidenceId = String(body.evidenceId || '');

    if (method === 'clicksign') {
      const existing = await service
        .from('signature_evidence')
        .select('id,evidence_role,document_version_id')
        .eq('capture_id', signatureId)
        .eq('document_id', documentId)
        .eq('captured_by', user.id)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) {
        if (
          existing.data.evidence_role !== 'FINAL_SIGNATURE' ||
          existing.data.document_version_id !== (versionResult.data?.id || null)
        ) {
          return NextResponse.json(
            {
              error: 'El intento de firma no coincide con la evidencia.',
              code: 'SIGNATURE_ATTEMPT_CONFLICT',
            },
            { status: 409 }
          );
        }
        evidenceId = existing.data.id;
      } else {
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
        if (inserted.error) {
          const concurrent = await service
            .from('signature_evidence')
            .select('id')
            .eq('capture_id', signatureId)
            .eq('document_id', documentId)
            .eq('captured_by', user.id)
            .eq('evidence_role', 'FINAL_SIGNATURE')
            .maybeSingle();
          if (concurrent.error || !concurrent.data) throw inserted.error;
          evidenceId = concurrent.data.id;
        } else {
          evidenceId = inserted.data.id;
        }
      }
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
      const expectedEvidenceType = method === 'autografa' ? 'autograph_signature' : 'efirma_sat';
      const candidate = await service
        .from('signature_evidence')
        .select('id,evidence_type,evidence_role,document_version_id,signature_id,is_voided')
        .eq('id', evidenceId)
        .eq('document_id', documentId)
        .eq('captured_by', user.id)
        .maybeSingle();
      if (candidate.error) throw candidate.error;
      if (
        !candidate.data ||
        candidate.data.is_voided ||
        candidate.data.evidence_type !== expectedEvidenceType
      ) {
        return NextResponse.json(
          {
            error: 'La evidencia técnica no corresponde al método de firma.',
            code: 'SIGNATURE_EVIDENCE_METHOD_MISMATCH',
          },
          { status: 409 }
        );
      }

      let previousFinalsQuery = service
        .from('signature_evidence')
        .select('id,signature_id')
        .eq('document_id', documentId)
        .eq('captured_by', user.id)
        .eq('evidence_type', expectedEvidenceType)
        .eq('evidence_role', 'FINAL_SIGNATURE')
        .eq('is_voided', false)
        .neq('id', evidenceId);
      previousFinalsQuery = versionResult.data?.id
        ? previousFinalsQuery.eq('document_version_id', versionResult.data.id)
        : previousFinalsQuery.is('document_version_id', null);
      const previousFinals = await previousFinalsQuery;
      if (previousFinals.error) throw previousFinals.error;

      const supersededEvidenceIds = (previousFinals.data || []).map((item) => item.id);
      let effectiveSignatureId = candidate.data.signature_id || signatureId;
      if (
        method === 'autografa' &&
        !candidate.data.signature_id &&
        (previousFinals.data || []).some((item) => item.signature_id === signatureId)
      ) {
        effectiveSignatureId = randomUUID();
      }
      finalizedSignatureId = effectiveSignatureId;

      if (supersededEvidenceIds.length > 0) {
        const linkedResponses = await service
          .from('participation_responses')
          .select('id,signature_evidence_id')
          .in('signature_evidence_id', supersededEvidenceIds)
          .limit(1);
        if (linkedResponses.error) throw linkedResponses.error;
        if ((linkedResponses.data || []).length > 0) {
          return NextResponse.json(
            {
              error: 'La evidencia previa ya forma parte de una participación confirmada.',
              code: 'SIGNATURE_EVIDENCE_ALREADY_COMMITTED',
            },
            { status: 409 }
          );
        }
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
      if (method === 'autografa') updateValues.signature_id = effectiveSignatureId;
      const updated = await service
        .from('signature_evidence')
        .update(updateValues)
        .eq('id', evidenceId)
        .eq('document_id', documentId)
        .eq('captured_by', user.id)
        .in(
          'evidence_role',
          method === 'autografa' ? ['CAPTURE', 'FINAL_SIGNATURE'] : ['FINAL_SIGNATURE']
        )
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

      if (supersededEvidenceIds.length > 0) {
        const voided = await service
          .from('signature_evidence')
          .update({
            is_voided: true,
            voided_at: signedAt,
            voided_by: user.id,
            void_reason: 'SUPERSEDED_BY_SIGNATURE_RETRY',
          })
          .in('id', supersededEvidenceIds)
          .eq('is_voided', false);
        if (voided.error) throw voided.error;
      }
    }

    return NextResponse.json({ ok: true, evidenceId, signatureId: finalizedSignatureId, consent });
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
