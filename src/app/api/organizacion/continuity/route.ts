import { createHash, randomBytes, randomUUID } from 'crypto';
import { Resend } from 'resend';
import {
  authenticateOrganizationRequest,
  authorizeOrganizationRequest,
  OrganizationApiError,
  organizationApiFailure,
  verifyOrganizationPassword,
} from '@/lib/organization/server';

export const runtime = 'nodejs';

const offboardingColumns = 'id,workspace_id,member_id,successor_member_id,requested_by,status,effective_at,reason,transfer_plan,asset_inventory,completion_report,idempotency_key,failure_code,started_at,completed_at,cancelled_at,created_at,updated_at';
const ownershipColumns = 'id,workspace_id,current_owner_member_id,target_member_id,requested_by,status,idempotency_key,expires_at,email_sent_at,confirmed_by,confirmed_at,cancelled_at,created_at,updated_at';

const messages: Record<string, string> = {
  organization_permission_denied: 'No tienes permiso para realizar esta acción.',
  organization_member_not_found: 'No se encontró el miembro seleccionado.',
  organization_cannot_offboard_self: 'No puedes darte de baja desde tu propia sesión.',
  organization_owner_transfer_required: 'Primero transfiere la propiedad de la organización.',
  organization_member_already_offboarded: 'El miembro ya fue dado de baja.',
  organization_invalid_successor: 'Selecciona un sucesor activo de la misma organización.',
  organization_successor_required: 'Selecciona un sucesor para reasignar los activos.',
  organization_offboarding_not_due: 'La baja todavía no alcanza la fecha programada.',
  organization_offboarding_job_not_cancellable: 'Esta baja ya no puede cancelarse.',
  organization_invalid_new_owner: 'Selecciona otro miembro activo como nuevo propietario.',
  organization_new_owner_email_not_verified: 'El nuevo propietario debe confirmar su correo electrónico.',
  organization_new_owner_mfa_required: 'El nuevo propietario debe tener TOTP o un dispositivo biométrico activo.',
  organization_current_owner_required: 'Solo el propietario actual puede iniciar la transferencia.',
  organization_ownership_transfer_invalid: 'El enlace de transferencia no es válido o ya fue utilizado.',
  organization_ownership_transfer_expired: 'El enlace de transferencia expiró.',
  organization_ownership_confirmation_denied: 'Este enlace pertenece al nuevo propietario designado.',
  organization_workspace_owner_changed: 'La propiedad cambió antes de completar esta solicitud.',
};

function continuityError(cause: any, fallback = 'No se pudo completar la operación.') {
  const raw = String(cause?.message || '');
  const key = Object.keys(messages).find((candidate) => raw.includes(candidate));
  return new OrganizationApiError(400, key || 'continuity_operation_failed', key ? messages[key] : fallback);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] || character));
}

function auditLog(event: string, values: Record<string, unknown>) {
  console.info(JSON.stringify({ scope: 'organization.continuity', event, at: new Date().toISOString(), ...values }));
}

async function sendOwnershipEmail(params: { request: Request; email: string; organizationName: string; token: string; expiresAt: string }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new OrganizationApiError(503, 'email_provider_not_configured', 'El servicio de correo no está configurado.');
  const origin = new URL(params.request.url).origin;
  const link = `${origin}/organizacion/continuidad?ownership_token=${encodeURIComponent(params.token)}`;
  const resend = new Resend(key);
  const result = await resend.emails.send({
    from: process.env.FROM_EMAIL || 'Docubox <noreply@docubox.com.mx>',
    to: params.email,
    subject: `Confirma la propiedad de ${params.organizationName}`,
    html: `<div style="font-family:'Google Sans','Google Sans Text','Segoe UI',Arial,sans-serif;max-width:620px;margin:auto;color:#18181b"><h2>Transferencia de propiedad</h2><p>Fuiste designado como nuevo propietario de <strong>${escapeHtml(params.organizationName)}</strong>.</p><p>Inicia sesión, revisa la solicitud y confírmala antes de <strong>${escapeHtml(new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'short'}).format(new Date(params.expiresAt)))}</strong>.</p><p><a href="${link}" style="display:inline-block;background:#1E6BFF;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px">Revisar y confirmar</a></p><p style="color:#71717a;font-size:13px">El enlace es personal, de un solo uso y no contiene credenciales de tu cuenta.</p></div>`,
  });
  if (result.error) throw new OrganizationApiError(503, 'ownership_email_failed', 'No se pudo enviar el enlace de confirmación.');
}

export async function GET(request: Request) {
  const started = Date.now();
  const requestId = randomUUID();
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspace_id') || '';
    const action = url.searchParams.get('action') || 'list';

    if (action === 'preview') {
      const memberId = url.searchParams.get('member_id') || '';
      if (!memberId) throw new OrganizationApiError(400, 'member_required', 'Selecciona un miembro.');
      const { userClient } = await authorizeOrganizationRequest(request, workspaceId, 'members.offboard');
      const result = await userClient.rpc('get_organization_member_offboarding_preview', { ws_id: workspaceId, target_member_id: memberId });
      if (result.error) throw continuityError(result.error, 'No se pudo preparar el inventario.');
      auditLog('preview.completed', { request_id: requestId, workspace_id: workspaceId, duration_ms: Date.now() - started });
      return Response.json({ success: true, data: result.data, request_id: requestId });
    }

    const { user, service } = await authorizeOrganizationRequest(request, workspaceId, 'members.read');
    const [jobs, membership] = await Promise.all([
      service.from('organization_member_offboarding_jobs').select(offboardingColumns).eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(50),
      service.from('workspace_members').select('id,role,status').eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle(),
    ]);
    if (jobs.error) throw jobs.error;

    let transfers: unknown[] = [];
    if (membership.data?.role === 'owner') {
      const result = await service.from('organization_ownership_transfers').select(ownershipColumns).eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(20);
      if (result.error) throw result.error;
      transfers = result.data || [];
    }
    auditLog('list.completed', { request_id: requestId, workspace_id: workspaceId, duration_ms: Date.now() - started });
    return Response.json({ success: true, data: { jobs: jobs.data || [], transfers }, request_id: requestId });
  } catch (cause) {
    auditLog('request.failed', { request_id: requestId, duration_ms: Date.now() - started });
    return organizationApiFailure(cause);
  }
}

export async function POST(request: Request) {
  const started = Date.now();
  const requestId = randomUUID();
  try {
    const body = await request.json();
    const action = String(body.action || '');
    const workspaceId = String(body.workspace_id || '');

    if (action === 'confirm_ownership') {
      const token = String(body.token || '');
      if (!token) throw new OrganizationApiError(400, 'ownership_token_required', 'El enlace de transferencia no es válido.');
      const { userClient } = await authenticateOrganizationRequest(request);
      const result = await userClient.rpc('confirm_organization_ownership_transfer', { raw_token: token });
      if (result.error) throw continuityError(result.error, 'No se pudo confirmar la transferencia.');
      auditLog('ownership.confirmed', { request_id: requestId, workspace_id: result.data?.workspace_id, duration_ms: Date.now() - started });
      return Response.json({ success: true, data: result.data, request_id: requestId });
    }

    if (action === 'create_offboarding') {
      const { userClient } = await authorizeOrganizationRequest(request, workspaceId, 'members.offboard');
      const effectiveAt = body.effective_at ? new Date(body.effective_at) : new Date();
      if (Number.isNaN(effectiveAt.getTime())) throw new OrganizationApiError(400, 'invalid_effective_at', 'La fecha programada no es válida.');
      const created = await userClient.rpc('create_organization_member_offboarding_job', {
        ws_id: workspaceId,
        target_member_id: String(body.member_id || ''),
        successor_member_id: body.successor_member_id || null,
        requested_effective_at: effectiveAt.toISOString(),
        offboarding_reason: String(body.reason || ''),
        requested_transfer_plan: body.transfer_plan || {},
        requested_idempotency_key: String(body.idempotency_key || randomUUID()),
      });
      if (created.error) throw continuityError(created.error, 'No se pudo preparar la baja.');

      let data = created.data;
      if (body.execute_now && created.data?.status === 'pending') {
        const executed = await userClient.rpc('execute_organization_member_offboarding_job', { target_job_id: created.data.id });
        if (executed.error) throw continuityError(executed.error, 'No se pudo ejecutar la baja.');
        data = executed.data;
      }
      auditLog('offboarding.created', { request_id: requestId, workspace_id: workspaceId, job_id: created.data?.id, status: data?.status, duration_ms: Date.now() - started });
      return Response.json({ success: true, data, request_id: requestId }, { status: 201 });
    }

    if (action === 'execute_offboarding') {
      const { userClient } = await authorizeOrganizationRequest(request, workspaceId, 'members.offboard');
      const result = await userClient.rpc('execute_organization_member_offboarding_job', { target_job_id: String(body.job_id || '') });
      if (result.error) throw continuityError(result.error, 'No se pudo ejecutar la baja.');
      auditLog('offboarding.executed', { request_id: requestId, workspace_id: workspaceId, job_id: body.job_id, status: result.data?.status, duration_ms: Date.now() - started });
      return Response.json({ success: true, data: result.data, request_id: requestId });
    }

    if (action === 'cancel_offboarding') {
      const { userClient } = await authorizeOrganizationRequest(request, workspaceId, 'members.offboard');
      const result = await userClient.rpc('cancel_organization_member_offboarding_job', { target_job_id: String(body.job_id || '') });
      if (result.error) throw continuityError(result.error, 'No se pudo cancelar la baja.');
      return Response.json({ success: true, request_id: requestId });
    }

    if (action === 'request_ownership') {
      if (String(body.confirmation || '').trim().toUpperCase() !== 'TRANSFERIR PROPIEDAD') {
        throw new OrganizationApiError(400, 'reinforced_confirmation_required', 'Escribe TRANSFERIR PROPIEDAD para confirmar.');
      }
      const { user, userClient, service } = await authorizeOrganizationRequest(request, workspaceId, 'organization.transfer_ownership');
      await verifyOrganizationPassword(user.id, user.email, String(body.current_password || ''));

      const token = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const result = await userClient.rpc('create_organization_ownership_transfer', {
        ws_id: workspaceId,
        target_member_id: String(body.target_member_id || ''),
        requested_token_hash: tokenHash,
        requested_expires_at: expiresAt,
        requested_idempotency_key: String(body.idempotency_key || randomUUID()),
      });
      if (result.error) throw continuityError(result.error, 'No se pudo iniciar la transferencia.');

      const workspace = await service.from('workspaces').select('name').eq('id', workspaceId).single();
      try {
        await sendOwnershipEmail({ request, email: result.data.target_email, organizationName: workspace.data?.name || 'tu organización', token, expiresAt });
        await service.from('organization_ownership_transfers').update({ email_sent_at: new Date().toISOString() }).eq('id', result.data.id);
      } catch (emailError) {
        await userClient.rpc('cancel_organization_ownership_transfer', { target_transfer_id: result.data.id });
        throw emailError;
      }
      auditLog('ownership.requested', { request_id: requestId, workspace_id: workspaceId, transfer_id: result.data.id, duration_ms: Date.now() - started });
      return Response.json({ success: true, data: { id: result.data.id, status: result.data.status, expires_at: result.data.expires_at }, request_id: requestId }, { status: 201 });
    }

    if (action === 'cancel_ownership') {
      const { userClient } = await authorizeOrganizationRequest(request, workspaceId, 'organization.transfer_ownership');
      const result = await userClient.rpc('cancel_organization_ownership_transfer', { target_transfer_id: String(body.transfer_id || '') });
      if (result.error) throw continuityError(result.error, 'No se pudo cancelar la transferencia.');
      return Response.json({ success: true, request_id: requestId });
    }

    throw new OrganizationApiError(400, 'invalid_action', 'Acción inválida.');
  } catch (cause) {
    auditLog('request.failed', { request_id: requestId, duration_ms: Date.now() - started });
    return organizationApiFailure(cause);
  }
}
