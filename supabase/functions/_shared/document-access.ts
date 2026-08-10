type AuthUser = { id: string; email?: string | null };

export async function userCanAccessDocument(
  admin: any,
  user: AuthUser,
  documentId: string,
  options: { ownerOrAdminOnly?: boolean } = {},
) {
  if (!documentId || !user?.id) return false;
  const { data: document } = await admin
    .from('documentos')
    .select('id,owner_id,workspace_id,participantes')
    .eq('id', documentId)
    .maybeSingle();
  if (!document) return false;
  if (document.owner_id === user.id) return true;

  if (document.workspace_id) {
    let membershipQuery = admin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', document.workspace_id)
      .eq('user_id', user.id);
    if (options.ownerOrAdminOnly) membershipQuery = membershipQuery.in('role', ['owner', 'admin']);
    const { data: membership } = await membershipQuery.limit(1).maybeSingle();
    if (membership) return true;
  }
  if (options.ownerOrAdminOnly) return false;

  const normalizedEmail = String(user.email || '').trim().toLowerCase();
  if (Array.isArray(document.participantes) && document.participantes.some((participant: any) =>
    participant?.id === user.id
    || (normalizedEmail && String(participant?.email || '').trim().toLowerCase() === normalizedEmail)
  )) return true;

  const { data: byId } = await admin
    .from('participation_responses')
    .select('id')
    .eq('documento_id', documentId)
    .eq('participante_id', user.id)
    .limit(1)
    .maybeSingle();
  if (byId) return true;
  if (!normalizedEmail) return false;
  const { data: byEmail } = await admin
    .from('participation_responses')
    .select('id')
    .eq('documento_id', documentId)
    .ilike('participante_email', normalizedEmail)
    .limit(1)
    .maybeSingle();
  return Boolean(byEmail);
}
