import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { assertKioskDocumentScope } from '@/lib/in-person/kiosk-session.server';
import { consumeServerRateLimit } from '@/lib/security/server-rate-limit';
import {
  bearerToken,
  DocumentAccessError,
  documentAccessResponse,
  requireDocumentAccess,
} from '@/lib/security/document-access';
import { createAnonClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };

type CompletionBody = {
  action?: 'claim' | 'commit';
  documentId?: string;
  participantRecordId?: string;
  participantReferenceId?: string;
  actionType?: 'signature' | 'approval' | 'witness';
  signatureMethod?: 'autografa' | 'efirma' | 'clicksign' | null;
  idempotencyKey?: string;
  attemptId?: string;
  evidenceId?: string | null;
  response?: Record<string, unknown>;
};

function normalized(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function completionError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message || '')
        : String(error || '');
  const knownCode = [
    'COMPLETION_ALREADY_CLAIMED',
    'COMPLETION_CLAIM_EXPIRED',
    'COMPLETION_DOCUMENT_TERMINAL',
    'COMPLETION_DOCUMENT_NOT_ELIGIBLE',
    'COMPLETION_PARTICIPANT_NOT_ELIGIBLE',
    'COMPLETION_DOCUMENT_VERSION_MISMATCH',
    'COMPLETION_KIOSK_COMMIT_CONFLICT',
    'SIGNING_GROUP_WINNER_ALREADY_CLAIMED',
    'DELEGATION_NOT_ACTIVE',
    'DELEGATION_ORIGINAL_ACCOUNT_REQUIRED',
    'DELEGATION_ORIGINAL_SUSPENDED',
    'GROUP_MEMBER_DELEGATION_SLOT_NOT_ELIGIBLE',
  ].find((code) => message.includes(code));
  if (knownCode) return { status: 409, code: knownCode };

  const deniedCode = [
    'COMPLETION_CLAIM_SCOPE_MISMATCH',
    'COMPLETION_PARTICIPANT_SCOPE_DENIED',
    'COMPLETION_ATTEMPT_SCOPE_DENIED',
    'COMPLETION_KIOSK_SESSION_INVALID',
    'COMPLETION_EVIDENCE_SCOPE_INVALID',
  ].find((code) => message.includes(code));
  if (deniedCode) return { status: 403, code: deniedCode };

  const inputCode = [
    'COMPLETION_CLAIM_INPUT_INVALID',
    'COMPLETION_EVIDENCE_REQUIRED',
    'COMPLETION_APPROVAL_EVIDENCE_INVALID',
  ].find((code) => message.includes(code));
  if (inputCode) return { status: 422, code: inputCode };

  return { status: 500, code: 'COMPLETION_COMMIT_FAILED' };
}

async function requireCompletionAuthentication(request: NextRequest) {
  const token = bearerToken(request);
  if (!token) throw new DocumentAccessError('AUTH_REQUIRED', 'Debes iniciar sesion.', 401);

  const {
    data: { user },
    error,
  } = await createAnonClient().auth.getUser(token);
  if (error || !user?.email) {
    throw new DocumentAccessError('AUTH_INVALID', 'La sesion no es valida.', 401);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireCompletionAuthentication(request);
    const body = (await request.json()) as CompletionBody;
    const documentId = String(body.documentId || '');
    const idempotencyKey = String(body.idempotencyKey || '');
    if (
      !UUID_PATTERN.test(documentId) ||
      idempotencyKey.length < 16 ||
      idempotencyKey.length > 240
    ) {
      return NextResponse.json(
        { error: 'Datos de finalización incompletos.', code: 'COMPLETION_INPUT_INVALID' },
        { status: 422, headers }
      );
    }

    const { user, document, service } = await requireDocumentAccess(request, documentId);
    const allowed = await consumeServerRateLimit({
      scope: `participant-completion-${body.action || 'invalid'}`,
      identifiers: [user.id, documentId],
      limit: 12,
      windowSeconds: 300,
    });
    if (!allowed) {
      return NextResponse.json(
        { error: 'Demasiados intentos de finalización.', code: 'RATE_LIMITED' },
        { status: 429, headers }
      );
    }

    const references = await service
      .from('document_participant_references')
      .select(
        'id,participant_json_id,participant_user_id,participant_email_normalized,workspace_id,active'
      )
      .eq('document_id', documentId)
      .eq('active', true);
    if (references.error) throw references.error;

    const userEmail = normalized(user.email);
    const participantRecordId = String(body.participantRecordId || '');
    const participantReferenceId = String(body.participantReferenceId || '');
    let reference = (references.data || []).find((candidate) => {
      const belongsToUser =
        candidate.participant_user_id === user.id ||
        (userEmail !== '' && candidate.participant_email_normalized === userEmail);
      const matchesRequestedIdentity =
        (!participantReferenceId || candidate.id === participantReferenceId) &&
        (!participantRecordId ||
          participantRecordId === user.id ||
          candidate.participant_json_id === participantRecordId ||
          candidate.participant_user_id === participantRecordId ||
          candidate.id === participantRecordId);
      return belongsToUser && matchesRequestedIdentity;
    });
    if (!reference) {
      const delegated = await service
        .from('document_participant_delegations')
        .select('original_participant_reference_id')
        .eq('document_id', documentId)
        .eq('delegate_user_id', user.id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      if (delegated.error) throw delegated.error;
      reference = (references.data || []).find(
        (candidate) =>
          candidate.id === delegated.data?.original_participant_reference_id &&
          (!participantReferenceId || candidate.id === participantReferenceId)
      );
    }
    if (!reference || reference.workspace_id !== document.workspace_id) {
      return NextResponse.json(
        { error: 'La participación no coincide con la sesión.', code: 'PARTICIPANT_MISMATCH' },
        { status: 403, headers }
      );
    }

    const kioskSession = await assertKioskDocumentScope(request, documentId);
    const correlationId = request.headers.get('x-request-id');
    if (body.action === 'claim') {
      if (!['signature', 'approval', 'witness'].includes(String(body.actionType || ''))) {
        return NextResponse.json(
          { error: 'Tipo de participación inválido.', code: 'COMPLETION_ACTION_INVALID' },
          { status: 422, headers }
        );
      }
      const rpc = await service.rpc('claim_participant_completion', {
        p_document_id: documentId,
        p_participant_reference_id: reference.id,
        p_actor_user_id: user.id,
        p_actor_email: user.email || '',
        p_action_type: body.actionType,
        p_signature_method: body.signatureMethod || '',
        p_idempotency_key: idempotencyKey,
        p_in_person_session_id: kioskSession?.id || null,
        p_correlation_id:
          correlationId && UUID_PATTERN.test(correlationId) ? correlationId : randomUUID(),
      });
      if (rpc.error) throw rpc.error;
      return NextResponse.json({ success: true, data: rpc.data }, { headers });
    }

    if (body.action === 'commit') {
      const attemptId = String(body.attemptId || '');
      if (!UUID_PATTERN.test(attemptId) || !body.response || typeof body.response !== 'object') {
        return NextResponse.json(
          { error: 'Commit operacional incompleto.', code: 'COMPLETION_COMMIT_INPUT_INVALID' },
          { status: 422, headers }
        );
      }
      const evidenceId = body.evidenceId ? String(body.evidenceId) : null;
      if (evidenceId && !UUID_PATTERN.test(evidenceId)) {
        return NextResponse.json(
          { error: 'Referencia de evidencia inválida.', code: 'COMPLETION_EVIDENCE_INVALID' },
          { status: 422, headers }
        );
      }
      const rpc = await service.rpc('commit_participant_completion', {
        p_attempt_id: attemptId,
        p_actor_user_id: user.id,
        p_actor_email: user.email || '',
        p_idempotency_key: idempotencyKey,
        p_signature_evidence_id: evidenceId,
        p_response: body.response,
      });
      if (rpc.error) throw rpc.error;
      return NextResponse.json({ success: true, data: rpc.data }, { headers });
    }

    return NextResponse.json(
      { error: 'Acción de finalización inválida.', code: 'COMPLETION_ACTION_INVALID' },
      { status: 400, headers }
    );
  } catch (error) {
    const access = documentAccessResponse(error);
    if (access.status !== 500) {
      return NextResponse.json(access.body, { status: access.status, headers });
    }
    const failure = completionError(error);
    if (failure.status === 500) {
      console.error('[participant-completion]', error instanceof Error ? error.message : error);
    }
    return NextResponse.json(
      { error: 'No fue posible confirmar la participación.', code: failure.code },
      { status: failure.status, headers }
    );
  }
}
