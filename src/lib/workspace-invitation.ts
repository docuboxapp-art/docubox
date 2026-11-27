import { createClient } from '@/lib/supabase/client';

export async function joinWorkspaceByCode(code: string) {
  const { data, error } = await createClient().auth.getSession();
  if (error || !data.session) throw new Error('Inicia sesión para unirte a un espacio.');
  const response = await fetch('/api/configuracion/unirse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session.access_token}`,
    },
    body: JSON.stringify({ code }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || typeof result?.name !== 'string') {
    throw new Error(result?.error || 'No fue posible unirse al espacio.');
  }
  return result.name as string;
}

export async function loadWorkspaceInvitations() {
  const { data, error } = await createClient().rpc('list_docubox_workspace_invitations');
  if (error) throw new Error('No fue posible consultar las invitaciones.');
  return (data as Array<{ id: string; workspace_id: string; workspace_name: string; invited_at: string | null }>).map((row) => ({
    ...row,
    owner_name: '',
    owner_email: '',
    invited_at: row.invited_at ?? '',
  }));
}

export async function acceptWorkspaceMembership(invitationId: string) {
  const { data, error } = await createClient().rpc('accept_docubox_workspace_membership', {
    p_invitation: invitationId,
  });
  if (error || !data) throw new Error('La invitación venció, cambió de estado o ya fue aceptada.');
}
