import { createHash, randomUUID } from 'crypto';
import { Resend } from 'resend';
import { createNotificationServer } from '@/lib/notificationsInApp';
import {
  authorizeOrganizationRequest,
  createOpaqueSecret,
  OrganizationApiError,
  organizationApiFailure,
} from '@/lib/organization/server';

export const runtime = 'nodejs';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SENDS_PER_HOUR = 20;

function cleanEmail(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      })[character] || character
  );
}

function invitationHtml(params: {
  organizationName: string;
  inviterName: string;
  invitationUrl: string;
  expiresAt: string;
  message?: string | null;
}) {
  const organizationName = escapeHtml(params.organizationName);
  const inviterName = escapeHtml(params.inviterName);
  const message = params.message
    ? `<div style="margin:20px 0;padding:14px 16px;border-left:3px solid #1E6BFF;background:#f5f8ff;color:#334155">${escapeHtml(params.message)}</div>`
    : '';
  const expiration = new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(params.expiresAt));
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f4f6f9;font-family:Arial,sans-serif;color:#18181b"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:36px 16px"><table width="600" style="max-width:600px;background:white;border:1px solid #e5e7eb;border-radius:8px"><tr><td style="padding:28px 32px;border-bottom:1px solid #e5e7eb"><strong style="font-size:22px">Docubox</strong></td></tr><tr><td style="padding:32px"><p style="margin:0 0 10px;color:#64748b">Invitacion a una organizacion</p><h1 style="font-size:24px;margin:0 0 16px">Unete a ${organizationName}</h1><p style="line-height:1.6;margin:0">${inviterName} te invito a colaborar en el espacio de trabajo de ${organizationName}.</p>${message}<a href="${params.invitationUrl}" style="display:inline-block;margin:26px 0 18px;padding:13px 22px;border-radius:6px;background:#1E6BFF;color:white;text-decoration:none;font-weight:600">Revisar invitacion</a><p style="font-size:13px;line-height:1.5;color:#64748b;margin:0">El enlace vence el ${escapeHtml(expiration)} y solo puede utilizarse una vez.</p></td></tr></table></td></tr></table></body></html>`;
}

async function sendInvitationEmail(params: {
  email: string;
  organizationName: string;
  inviterName: string;
  invitationUrl: string;
  expiresAt: string;
  message?: string | null;
}) {
  const key = process.env.RESEND_API_KEY;
  if (!key)
    throw new OrganizationApiError(
      503,
      'email_not_configured',
      'El servicio de correo no esta configurado.'
    );
  const resend = new Resend(key);
  const result = await resend.emails.send({
    from: process.env.ORGANIZATION_INVITATION_FROM_EMAIL || 'Docubox <noreply@docubox.com.mx>',
    to: params.email,
    subject: `${params.inviterName} te invito a ${params.organizationName} en Docubox`,
    html: invitationHtml(params),
  });
  if (result.error)
    throw new OrganizationApiError(
      502,
      'email_delivery_failed',
      'No se pudo enviar la invitacion.'
    );
  return result.data?.id || null;
}

function invitationUrl(request: Request, token: string) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  const origin = configured || new URL(request.url).origin;
  return `${origin}/invitacion-organizacion/${encodeURIComponent(token)}`;
}

export async function GET(request: Request) {
  try {
    const workspaceId = new URL(request.url).searchParams.get('workspace_id') || '';
    const { service } = await authorizeOrganizationRequest(request, workspaceId, 'members.read');
    const { data, error } = await service
      .from('organization_invitations')
      .select(
        'id,email,status,delivery_status,delivery_error_code,role_id,unit_id,expires_at,sent_at,last_sent_at,send_count,accepted_at,created_at,organization_roles(name,system_key),organization_units(name)'
      )
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(250);
    if (error) throw error;
    return Response.json({ success: true, data: data || [] });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    const body = await request.json().catch(() => ({}));
    const workspaceId = String(body.workspace_id || '');
    const email = cleanEmail(body.email);
    const roleId = body.role_id ? String(body.role_id) : null;
    const unitId = body.unit_id ? String(body.unit_id) : null;
    const message =
      String(body.message || '')
        .trim()
        .slice(0, 500) || null;
    const idempotencyKey = body.idempotency_key ? String(body.idempotency_key) : randomUUID();
    const { user, service } = await authorizeOrganizationRequest(
      request,
      workspaceId,
      'members.invite'
    );

    if (!EMAIL_PATTERN.test(email))
      throw new OrganizationApiError(400, 'invalid_email', 'Ingresa un correo electronico valido.');

    const [workspaceResult, inviterResult, membershipResult, recipientResult, recentResult] =
      await Promise.all([
        service
          .from('workspaces')
          .select('id,name,organization_enabled')
          .eq('id', workspaceId)
          .maybeSingle(),
        service.from('user_profiles').select('full_name,email').eq('id', user.id).maybeSingle(),
        service
          .from('user_profiles')
          .select('id,workspace_members!inner(id,status,workspace_id)')
          .eq('email', email)
          .eq('workspace_members.workspace_id', workspaceId)
          .maybeSingle(),
        service.from('user_profiles').select('id').eq('email', email).maybeSingle(),
        service
          .from('organization_invitations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .eq('invited_by', user.id)
          .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()),
      ]);
    if (workspaceResult.error || !workspaceResult.data?.organization_enabled)
      throw new OrganizationApiError(
        404,
        'organization_not_found',
        'La organizacion no esta disponible.'
      );
    if (membershipResult.data)
      throw new OrganizationApiError(
        409,
        'member_already_exists',
        'Esta persona ya pertenece a la organizacion.'
      );
    if ((recentResult.count || 0) >= MAX_SENDS_PER_HOUR)
      throw new OrganizationApiError(
        429,
        'invitation_rate_limited',
        'Alcanzaste el limite temporal de invitaciones. Intenta mas tarde.'
      );

    if (roleId) {
      const role = await service
        .from('organization_roles')
        .select('id,system_key')
        .eq('id', roleId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();
      if (role.error || !role.data || role.data.system_key === 'owner')
        throw new OrganizationApiError(400, 'invalid_role', 'Selecciona un rol permitido.');
    }
    if (unitId) {
      const unit = await service
        .from('organization_units')
        .select('id')
        .eq('id', unitId)
        .eq('workspace_id', workspaceId)
        .eq('status', 'active')
        .maybeSingle();
      if (unit.error || !unit.data)
        throw new OrganizationApiError(400, 'invalid_unit', 'Selecciona un equipo activo.');
    }

    const existing = await service
      .from('organization_invitations')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('email', email)
      .eq('status', 'pending')
      .maybeSingle();
    if (existing.data)
      throw new OrganizationApiError(
        409,
        'invitation_already_pending',
        'Ya existe una invitacion pendiente para este correo.'
      );

    const secret = createOpaqueSecret('dbxinv');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const inserted = await service
      .from('organization_invitations')
      .insert({
        workspace_id: workspaceId,
        email,
        role_id: roleId,
        unit_id: unitId,
        invited_by: user.id,
        token_hash: secret.hash,
        token_prefix: secret.publicPrefix,
        expires_at: expiresAt,
        idempotency_key: idempotencyKey,
        invitation_message: message,
        send_count: 1,
        last_sent_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (inserted.error) {
      if (inserted.error.code === '23505')
        throw new OrganizationApiError(
          409,
          'invitation_conflict',
          'La invitacion ya fue registrada.'
        );
      throw inserted.error;
    }

    let deliveryId: string | null = null;
    try {
      deliveryId = await sendInvitationEmail({
        email,
        organizationName: workspaceResult.data.name,
        inviterName:
          inviterResult.data?.full_name || inviterResult.data?.email || 'Un administrador',
        invitationUrl: invitationUrl(request, secret.value),
        expiresAt,
        message,
      });
      await service
        .from('organization_invitations')
        .update({
          delivery_status: 'sent',
          delivery_error_code: null,
          sent_at: new Date().toISOString(),
        })
        .eq('id', inserted.data.id);
    } catch (cause: any) {
      await service
        .from('organization_invitations')
        .update({
          delivery_status: 'failed',
          delivery_error_code: cause?.code || 'email_delivery_failed',
        })
        .eq('id', inserted.data.id);
      throw cause;
    }

    await service.from('organization_audit_events').insert({
      workspace_id: workspaceId,
      actor_user_id: user.id,
      event_type: 'member.invitation.created',
      resource_type: 'organization_invitation',
      resource_id: inserted.data.id,
      summary: `Invitacion enviada a ${email}`,
      payload: { email, role_id: roleId, unit_id: unitId, delivery_id: deliveryId },
      outcome: 'success',
      severity: 'medium',
      module: 'members',
      origin: 'api',
      correlation_id: requestId,
    });
    if (recipientResult.data?.id) {
      await createNotificationServer({
        userId: recipientResult.data.id,
        type: 'info',
        title: `Invitación a ${workspaceResult.data.name}`,
        description: `${inviterResult.data?.full_name || 'Un administrador'} te invitó a colaborar. Revisa el enlace enviado a tu correo.`,
        priority: 'media',
        metadata: {
          workspace_id: workspaceId,
          invitation_id: inserted.data.id,
          event: 'organization_invitation_created',
        },
      });
    }
    return Response.json({ success: true, id: inserted.data.id }, { status: 201 });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}

export async function PATCH(request: Request) {
  const requestId = randomUUID();
  try {
    const body = await request.json().catch(() => ({}));
    const workspaceId = String(body.workspace_id || '');
    const invitationId = String(body.invitation_id || '');
    const action = String(body.action || '');
    const { user, service } = await authorizeOrganizationRequest(
      request,
      workspaceId,
      'members.invite'
    );
    const existing = await service
      .from('organization_invitations')
      .select('*,workspaces(name)')
      .eq('id', invitationId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (existing.error || !existing.data)
      throw new OrganizationApiError(404, 'invitation_not_found', 'No se encontro la invitacion.');
    if (existing.data.status !== 'pending')
      throw new OrganizationApiError(
        409,
        'invitation_not_pending',
        'La invitacion ya no esta pendiente.'
      );

    if (action === 'revoke') {
      const result = await service
        .from('organization_invitations')
        .update({
          status: 'revoked',
          revoked_at: new Date().toISOString(),
          revoked_by: user.id,
          token_hash: null,
        })
        .eq('id', invitationId)
        .eq('status', 'pending');
      if (result.error) throw result.error;
    } else if (action === 'resend') {
      if (
        existing.data.last_sent_at &&
        Date.now() - new Date(existing.data.last_sent_at).getTime() < 60_000
      ) {
        throw new OrganizationApiError(
          429,
          'resend_too_soon',
          'Espera un minuto antes de reenviar.'
        );
      }
      const secret = createOpaqueSecret('dbxinv');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const inviter = await service
        .from('user_profiles')
        .select('full_name,email')
        .eq('id', user.id)
        .maybeSingle();
      await sendInvitationEmail({
        email: existing.data.email,
        organizationName: (existing.data.workspaces as any)?.name || 'tu organizacion',
        inviterName: inviter.data?.full_name || inviter.data?.email || 'Un administrador',
        invitationUrl: invitationUrl(request, secret.value),
        expiresAt,
        message: existing.data.invitation_message,
      });
      const result = await service
        .from('organization_invitations')
        .update({
          token_hash: secret.hash,
          token_prefix: secret.publicPrefix,
          expires_at: expiresAt,
          delivery_status: 'sent',
          delivery_error_code: null,
          sent_at: new Date().toISOString(),
          last_sent_at: new Date().toISOString(),
          send_count: Number(existing.data.send_count || 0) + 1,
        })
        .eq('id', invitationId)
        .eq('status', 'pending');
      if (result.error) throw result.error;
    } else {
      throw new OrganizationApiError(400, 'invalid_action', 'Accion de invitacion no reconocida.');
    }

    await service.from('organization_audit_events').insert({
      workspace_id: workspaceId,
      actor_user_id: user.id,
      event_type: `member.invitation.${action}`,
      resource_type: 'organization_invitation',
      resource_id: invitationId,
      summary:
        action === 'revoke'
          ? `Invitacion cancelada para ${existing.data.email}`
          : `Invitacion reenviada a ${existing.data.email}`,
      payload: { email: existing.data.email },
      outcome: 'success',
      severity: 'medium',
      module: 'members',
      origin: 'api',
      correlation_id: requestId,
    });
    const recipient = await service
      .from('user_profiles')
      .select('id')
      .eq('email', existing.data.email)
      .maybeSingle();
    if (recipient.data?.id) {
      await createNotificationServer({
        userId: recipient.data.id,
        type: action === 'revoke' ? 'alert' : 'info',
        title: action === 'revoke' ? 'Invitación cancelada' : 'Invitación reenviada',
        description:
          action === 'revoke'
            ? `La invitación para ${(existing.data.workspaces as any)?.name || 'la organización'} fue cancelada.`
            : `Se envió un nuevo enlace para ${(existing.data.workspaces as any)?.name || 'la organización'} a tu correo.`,
        priority: action === 'revoke' ? 'alta' : 'media',
        metadata: {
          workspace_id: workspaceId,
          invitation_id: invitationId,
          event: `organization_invitation_${action}`,
        },
      });
    }
    return Response.json({ success: true });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}
