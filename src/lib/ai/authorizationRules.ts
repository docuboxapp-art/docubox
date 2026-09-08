export type LuciaDocumentGrantInput = {
  documentWorkspaceId: string;
  requestedWorkspaceId: string;
  documentOwnerId: string;
  userId: string;
  userEmail?: string | null;
  membershipRole: string;
  membershipStatus: string;
  membershipExpiresAt?: string | null;
  hidden: boolean;
  participants: Array<Record<string, unknown>>;
};

export function isActiveLuciaMembership(status: string, expiresAt?: string | null) {
  return status === 'active' && (!expiresAt || new Date(expiresAt).getTime() > Date.now());
}

export function canReadLuciaDocument(input: LuciaDocumentGrantInput) {
  if (input.documentWorkspaceId !== input.requestedWorkspaceId || input.hidden) return false;
  if (!isActiveLuciaMembership(input.membershipStatus, input.membershipExpiresAt)) return false;
  const role = input.membershipRole.toLowerCase();
  if (
    input.documentOwnerId === input.userId ||
    ['owner', 'admin', 'workspace_admin'].includes(role)
  )
    return true;
  const email = String(input.userEmail || '')
    .trim()
    .toLowerCase();
  return input.participants.some((participant) => {
    if (participant.current_access === false || participant.portal_token_invalidated_at)
      return false;
    const participantEmail = String(participant.email || '')
      .trim()
      .toLowerCase();
    return (
      participant.id === input.userId ||
      participant.user_id === input.userId ||
      Boolean(email && participantEmail === email)
    );
  });
}

export function isUsablePublicCapability(
  status: string,
  allowedStatuses: readonly string[],
  expiresAt?: string | null,
  revokedAt?: string | null
) {
  return (
    !revokedAt &&
    allowedStatuses.includes(status) &&
    (!expiresAt || new Date(expiresAt).getTime() > Date.now())
  );
}
