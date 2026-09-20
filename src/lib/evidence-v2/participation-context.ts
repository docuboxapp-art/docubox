import type { EvidenceParticipationContext, EvidenceSignatureMethod } from './types';

export type CompletionAttemptSource = {
  id: unknown;
  status: unknown;
  participant_reference_id: unknown;
  in_person_session_id?: unknown;
  signature_evidence_id: unknown;
  participation_response_id?: unknown;
  correlation_id: unknown;
  claimed_at: unknown;
  committed_at: unknown;
  effective_actor_user_id?: unknown;
  delegation_id?: unknown;
  requested_action_type?: unknown;
};

export type InPersonSessionSource = {
  id: unknown;
  status: unknown;
  participant_reference_id: unknown;
  created_at: unknown;
  started_at: unknown;
  completed_at: unknown;
};

export type CanonicalEventSource = {
  id: unknown;
  event_key: unknown;
  correlation_id: unknown;
  payload?: unknown;
};

export type SigningGroupSource = {
  id: unknown;
  completion_policy: unknown;
  winner_participant_reference_id?: unknown;
};

export type SigningGroupMemberSource = {
  group_id: unknown;
  participant_reference_id: unknown;
  ordinal: unknown;
};

export type DelegationSource = {
  id: unknown;
  original_participant_reference_id: unknown;
  group_member_slot_id?: unknown;
  delegate_participant_reference_id?: unknown;
  delegate_user_id: unknown;
  created_by: unknown;
  policy_mode: unknown;
  reason: unknown;
  created_at: unknown;
  completed_at?: unknown;
};

export class EvidenceParticipationContextError extends TypeError {
  constructor(readonly code: string) {
    super(code);
    this.name = 'EvidenceParticipationContextError';
  }
}

function requiredRef(prefix: string, value: unknown, code: string) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new EvidenceParticipationContextError(code);
  return `${prefix}:${normalized}`;
}

function requiredValue(value: unknown, code: string) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new EvidenceParticipationContextError(code);
  return normalized;
}

function requiredUtc(value: unknown, code: string) {
  const timestamp = new Date(String(value || ''));
  if (!Number.isFinite(timestamp.getTime())) {
    throw new EvidenceParticipationContextError(code);
  }
  return timestamp.toISOString();
}

export function buildEvidenceParticipationContext(input: {
  attempt?: CompletionAttemptSource | null;
  session?: InPersonSessionSource | null;
  canonicalEvent?: CanonicalEventSource | null;
  signingGroup?: SigningGroupSource | null;
  signingGroupMembers?: SigningGroupMemberSource[];
  delegation?: DelegationSource | null;
  signingMethod: EvidenceSignatureMethod;
  consentTextHash?: unknown;
}): EvidenceParticipationContext | undefined {
  if (!input.attempt) return undefined;
  if (input.attempt.status !== 'committed') {
    throw new EvidenceParticipationContextError('EVIDENCE_COMPLETION_NOT_COMMITTED');
  }

  const attemptId = String(input.attempt.id || '').trim();
  const participantReferenceId = requiredValue(
    input.attempt.participant_reference_id,
    'EVIDENCE_PARTICIPANT_REFERENCE_MISSING'
  );
  const correlationId = requiredValue(
    input.attempt.correlation_id,
    'EVIDENCE_COMPLETION_CORRELATION_MISSING'
  );
  const expectedEventKey = `completion:${attemptId}:committed`;
  if (
    !input.canonicalEvent ||
    input.canonicalEvent.event_key !== expectedEventKey ||
    String(input.canonicalEvent.correlation_id || '') !== correlationId
  ) {
    throw new EvidenceParticipationContextError('EVIDENCE_COMPLETION_EVENT_MISSING');
  }

  const inPersonSessionId = String(input.attempt.in_person_session_id || '').trim();
  const mode = inPersonSessionId ? 'in_person' : 'remote';
  let inPersonSession: EvidenceParticipationContext['inPersonSession'];
  if (mode === 'in_person') {
    if (
      !input.session ||
      String(input.session.id || '') !== inPersonSessionId ||
      String(input.session.participant_reference_id || '') !== participantReferenceId ||
      input.session.status !== 'completed'
    ) {
      throw new EvidenceParticipationContextError('EVIDENCE_IN_PERSON_SESSION_NOT_COMPLETED');
    }
    inPersonSession = {
      sessionRef: requiredRef(
        'in-person-session',
        input.session.id,
        'EVIDENCE_IN_PERSON_SESSION_REFERENCE_MISSING'
      ),
      status: 'completed',
      createdAt: requiredUtc(
        input.session.created_at,
        'EVIDENCE_IN_PERSON_SESSION_CREATED_AT_MISSING'
      ),
      startedAt: requiredUtc(
        input.session.started_at,
        'EVIDENCE_IN_PERSON_SESSION_STARTED_AT_MISSING'
      ),
      completedAt: requiredUtc(
        input.session.completed_at,
        'EVIDENCE_IN_PERSON_SESSION_COMPLETED_AT_MISSING'
      ),
    };
  }

  const consentTextHash = String(input.consentTextHash || '')
    .trim()
    .toLowerCase();
  const eventPayload =
    input.canonicalEvent?.payload && typeof input.canonicalEvent.payload === 'object'
      ? (input.canonicalEvent.payload as Record<string, unknown>)
      : {};
  const groupId = String(input.signingGroup?.id || eventPayload.signing_group_id || '').trim();
  const delegationId = String(
    input.attempt?.delegation_id || eventPayload.delegation_id || ''
  ).trim();
  const effectiveActorId = String(
    input.attempt?.effective_actor_user_id || eventPayload.effective_actor_user_id || ''
  ).trim();
  const actionRole = String(
    input.attempt?.requested_action_type || eventPayload.requested_action_type || ''
  ).trim();
  const governance =
    groupId || delegationId || effectiveActorId || actionRole
      ? {
          signingGroupRef: groupId ? `signing-group:${groupId}` : null,
          ...(input.delegation?.group_member_slot_id
            ? {
                groupMemberSlotRef: `group-member-slot:${String(input.delegation.group_member_slot_id)}`,
              }
            : {}),
          completionPolicy:
            (input.signingGroup?.completion_policy || eventPayload.completion_policy) === 'ANY_ONE'
              ? ('ANY_ONE' as const)
              : (input.signingGroup?.completion_policy || eventPayload.completion_policy) === 'ALL'
                ? ('ALL' as const)
                : null,
          delegationRef: delegationId ? `delegation:${delegationId}` : null,
          effectiveActorRef: effectiveActorId ? `user:${effectiveActorId}` : null,
          actionRole:
            actionRole === 'witness'
              ? ('witness' as const)
              : actionRole === 'approval'
                ? ('approval' as const)
                : actionRole === 'signature'
                  ? ('signature' as const)
                  : null,
          eligibleParticipantRefs: (input.signingGroupMembers || [])
            .filter((member) => String(member.group_id || '') === groupId)
            .sort((left, right) => Number(left.ordinal || 0) - Number(right.ordinal || 0))
            .map((member) => `participant-reference:${String(member.participant_reference_id)}`),
          winnerParticipantRef: input.signingGroup?.winner_participant_reference_id
            ? `participant-reference:${String(input.signingGroup.winner_participant_reference_id)}`
            : null,
          originalParticipantRef: input.delegation?.original_participant_reference_id
            ? `participant-reference:${String(input.delegation.original_participant_reference_id)}`
            : null,
          delegateUserRef: input.delegation?.delegate_user_id
            ? `user:${String(input.delegation.delegate_user_id)}`
            : null,
          ...(input.delegation?.delegate_participant_reference_id
            ? {
                delegateParticipantRef: `participant-reference:${String(input.delegation.delegate_participant_reference_id)}`,
              }
            : {}),
          delegationCreatedByRef: input.delegation?.created_by
            ? `user:${String(input.delegation.created_by)}`
            : null,
          delegationPolicy: ['ORGANIZATION_ONLY', 'AUTHORIZED_MEMBERS'].includes(
            String(input.delegation?.policy_mode || '')
          )
            ? (String(input.delegation?.policy_mode) as 'ORGANIZATION_ONLY' | 'AUTHORIZED_MEMBERS')
            : null,
          delegationReason: input.delegation?.reason
            ? String(input.delegation.reason).trim()
            : null,
          delegationCreatedAt: input.delegation?.created_at
            ? requiredUtc(input.delegation.created_at, 'EVIDENCE_DELEGATION_CREATED_AT_INVALID')
            : null,
          delegationCompletedAt: input.delegation?.completed_at
            ? requiredUtc(input.delegation.completed_at, 'EVIDENCE_DELEGATION_COMPLETED_AT_INVALID')
            : null,
        }
      : undefined;

  return {
    mode,
    participantReference: requiredRef(
      'participant-reference',
      participantReferenceId,
      'EVIDENCE_PARTICIPANT_REFERENCE_MISSING'
    ),
    authentication: {
      // AUTH-003 claims are created only after the participant bearer session is verified.
      method: 'authenticated_session',
      result: 'verified',
      verifiedAt: requiredUtc(
        input.attempt.claimed_at,
        'EVIDENCE_AUTHENTICATION_TIMESTAMP_MISSING'
      ),
      evidenceRef: requiredRef(
        'completion-attempt',
        input.attempt.id,
        'EVIDENCE_COMPLETION_REFERENCE_MISSING'
      ),
    },
    signingMethod: input.signingMethod,
    consentRef: /^[a-f0-9]{64}$/.test(consentTextHash) ? `consent-sha256:${consentTextHash}` : null,
    completion: {
      attemptRef: requiredRef(
        'completion-attempt',
        input.attempt.id,
        'EVIDENCE_COMPLETION_REFERENCE_MISSING'
      ),
      correlationId,
      committedAt: requiredUtc(input.attempt.committed_at, 'EVIDENCE_COMPLETION_TIMESTAMP_MISSING'),
      responseRef: input.attempt.participation_response_id
        ? requiredRef(
            'participation-response',
            input.attempt.participation_response_id,
            'EVIDENCE_RESPONSE_REFERENCE_MISSING'
          )
        : null,
      canonicalEventRef: requiredRef(
        'operational-event',
        input.canonicalEvent.id,
        'EVIDENCE_COMPLETION_EVENT_REFERENCE_MISSING'
      ),
    },
    inPersonSession,
    ...(governance ? { governance } : {}),
  };
}
