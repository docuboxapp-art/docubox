import { createHash } from 'crypto';
import {
  authenticateOrganizationRequest,
  OrganizationApiError,
  organizationApiFailure,
} from '@/lib/organization/server';
import { createServiceClient } from '@/lib/supabase/server';
import { createNotificationServer } from '@/lib/notificationsInApp';

export const runtime = 'nodejs';

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  if (!domain) return 'correo protegido';
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(2, Math.min(6, name.length - 2)))}@${domain}`;
}

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get('token') || '';
    if (token.length < 32)
      throw new OrganizationApiError(404, 'invitation_not_found', 'La invitacion no es valida.');
    const service = createServiceClient();
    const result = await service
      .from('organization_invitations')
      .select('id,email,status,expires_at,workspaces(id,name,logo_url),organization_roles(name)')
      .eq('token_hash', hashToken(token))
      .maybeSingle();
    if (result.error || !result.data || result.data.status !== 'pending')
      throw new OrganizationApiError(
        404,
        'invitation_not_found',
        'La invitacion no es valida o ya fue utilizada.'
      );
    if (new Date(result.data.expires_at).getTime() <= Date.now())
      throw new OrganizationApiError(410, 'invitation_expired', 'La invitacion ha vencido.');
    return Response.json({
      success: true,
      data: {
        organization: result.data.workspaces,
        role: (result.data.organization_roles as any)?.name || 'Miembro',
        email: maskEmail(result.data.email),
        expires_at: result.data.expires_at,
      },
    });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = String(body.token || '');
    if (token.length < 32)
      throw new OrganizationApiError(400, 'invitation_invalid', 'La invitacion no es valida.');
    const { userClient } = await authenticateOrganizationRequest(request);
    const service = createServiceClient();
    const invitation = await service
      .from('organization_invitations')
      .select('id,workspace_id,invited_by,workspaces(name)')
      .eq('token_hash', hashToken(token))
      .eq('status', 'pending')
      .maybeSingle();
    const result = await userClient.rpc('accept_organization_invitation', { raw_token: token });
    if (result.error) {
      const message = result.error.message || '';
      if (message.includes('email_mismatch'))
        throw new OrganizationApiError(
          403,
          'invitation_email_mismatch',
          'Inicia sesion con el correo al que se envio la invitacion.'
        );
      if (message.includes('expired'))
        throw new OrganizationApiError(410, 'invitation_expired', 'La invitacion ha vencido.');
      if (message.includes('invalid'))
        throw new OrganizationApiError(
          409,
          'invitation_invalid',
          'La invitacion no es valida o ya fue utilizada.'
        );
      throw result.error;
    }
    if (invitation.data?.invited_by) {
      await createNotificationServer({
        userId: invitation.data.invited_by,
        type: 'info',
        title: 'Invitación aceptada',
        description: `Un nuevo miembro se incorporó a ${(invitation.data.workspaces as any)?.name || 'la organización'}.`,
        priority: 'media',
        metadata: {
          workspace_id: invitation.data.workspace_id,
          invitation_id: invitation.data.id,
          event: 'organization_invitation_accepted',
        },
      });
    }
    return Response.json({ success: true, data: result.data?.[0] || null });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}
