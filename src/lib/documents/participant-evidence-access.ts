export function participantEvidenceScope(input: {
  viewerId: string;
  viewerEmail: string;
  participantId?: string | null;
  participantUserId?: string | null;
  participantEmail?: string | null;
  role: string;
}): 'full' | 'summary' {
  const email = input.participantEmail?.trim().toLowerCase();
  const isSelf =
    Boolean(input.viewerId) &&
    (input.participantId === input.viewerId ||
      input.participantUserId === input.viewerId ||
      Boolean(email && email === input.viewerEmail.trim().toLowerCase()));

  return isSelf || input.role === 'OWNER' || input.role === 'WORKSPACE_ADMIN' ? 'full' : 'summary';
}
