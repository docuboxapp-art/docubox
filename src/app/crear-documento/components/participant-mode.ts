import type { Participant, ParticipantMode } from './types';

export interface CurrentUserIdentity {
  id?: string;
  name?: string;
  email?: string;
}

function normalizeEmail(value?: string): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function displayName(identity: CurrentUserIdentity, existing?: Participant): string {
  const resolved = String(identity.name || '').trim();
  if (resolved) return `${resolved.replace(/\s+\(Tú\)$/i, '')} (Tú)`;

  const existingName = String(existing?.name || '').trim();
  if (existingName) return existingName;

  const email = String(identity.email || existing?.email || '').trim();
  return email ? `${email} (Tú)` : '(Tú)';
}

function isCurrentUser(participant: Participant, identity: CurrentUserIdentity): boolean {
  const candidate = participant as Participant & { user_id?: string; isCurrentUser?: boolean };
  const identityEmail = normalizeEmail(identity.email);

  return (
    participant.id === 'current-user' ||
    candidate.isCurrentUser === true ||
    (!!identity.id && (participant.id === identity.id || candidate.user_id === identity.id)) ||
    (!!identityEmail && normalizeEmail(participant.email) === identityEmail)
  );
}

export function reconcileParticipantsForMode(
  participants: Participant[],
  mode: ParticipantMode,
  identity: CurrentUserIdentity
): Participant[] {
  if (mode === 'solo_otros') {
    return participants.filter((participant) => !isCurrentUser(participant, identity));
  }

  const existing = participants.find((participant) => isCurrentUser(participant, identity));
  const creator: Participant = {
    ...existing,
    id: 'current-user',
    name: displayName(identity, existing),
    email: String(identity.email || existing?.email || '').trim(),
    role: existing?.role || 'firmante',
  };

  if (mode === 'solo_yo') return [creator];

  if (mode === 'yo_y_otros') {
    const others = participants.filter((participant) => !isCurrentUser(participant, identity));
    return [creator, ...others];
  }

  if (!existing) return participants;

  return participants.map((participant) =>
    isCurrentUser(participant, identity) ? creator : participant
  );
}
