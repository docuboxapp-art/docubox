export type StoredParticipantMode = 'solo_yo' | 'yo_y_otros' | 'solo_otros';

export function resolveParticipantMode(
  storedMode: unknown,
  participants:
    | Array<{ isCurrentUser?: boolean; user_id?: string | null; email?: string | null }>
    | null
    | undefined,
  ownerId: string,
  ownerEmail?: string | null
): StoredParticipantMode | null {
  if (storedMode === 'solo_yo' || storedMode === 'yo_y_otros' || storedMode === 'solo_otros') {
    return storedMode;
  }
  // Documents sent before participant_mode was persisted can be classified only
  // when their original participant composition is unambiguous.
  if (!Array.isArray(participants) || participants.length === 0) return null;
  const isOwner = (participant: {
    isCurrentUser?: boolean;
    user_id?: string | null;
    email?: string | null;
  }) =>
    participant.isCurrentUser === true ||
    participant.user_id === ownerId ||
    (Boolean(ownerEmail) &&
      participant.email?.trim().toLowerCase() === ownerEmail?.trim().toLowerCase());
  const ownerIncluded = participants.some(isOwner);
  if (!ownerIncluded) return 'solo_otros';
  return participants.some((participant) => !isOwner(participant)) ? 'yo_y_otros' : 'solo_yo';
}

export function canInviteToDocument(status: unknown, mode: StoredParticipantMode | null) {
  return status === 'en_proceso' && (mode === 'yo_y_otros' || mode === 'solo_otros');
}
