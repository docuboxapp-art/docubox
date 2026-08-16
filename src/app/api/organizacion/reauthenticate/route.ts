import { randomUUID } from 'crypto';
import {
  authorizeOrganizationRequest,
  createOpaqueSecret,
  OrganizationApiError,
  organizationApiFailure,
  verifyOrganizationPassword,
} from '@/lib/organization/server';

export const runtime = 'nodejs';

const ALLOWED_SCOPES = new Set([
  'members.update',
  'members.suspend',
  'roles.manage',
  'security.manage',
  'certificates.manage',
  'integrations.manage',
  'organization.profile.update',
  'workflows.manage',
  'signature_policies.manage',
  'members.offboard',
  'organization.transfer_ownership',
]);

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    const body = await request.json().catch(() => ({}));
    const workspaceId = String(body.workspace_id || '');
    const password = String(body.password || '');
    const requestedScopes: string[] = Array.isArray(body.scopes) ? body.scopes.map(String) : [];
    const scopes = [
      ...new Set(requestedScopes.filter((scope: string) => ALLOWED_SCOPES.has(scope))),
    ];
    if (!scopes.length)
      throw new OrganizationApiError(
        400,
        'reauthentication_scope_required',
        'Selecciona una operacion valida.'
      );

    const { user, service } = await authorizeOrganizationRequest(
      request,
      workspaceId,
      'organization.read'
    );
    await verifyOrganizationPassword(user.id, user.email, password);

    const secret = createOpaqueSecret('dbxreauth');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
    const inserted = await service.from('organization_reauthentication_sessions').insert({
      workspace_id: workspaceId,
      user_id: user.id,
      token_hash: secret.hash,
      method: 'password',
      scopes,
      expires_at: expiresAt,
      ip_address: forwarded,
      user_agent: request.headers.get('user-agent'),
    });
    if (inserted.error) throw inserted.error;

    await service.from('organization_audit_events').insert({
      workspace_id: workspaceId,
      actor_user_id: user.id,
      event_type: 'security.reauthentication.completed',
      resource_type: 'organization_reauthentication_session',
      summary: 'Reautenticacion completada para una operacion sensible',
      payload: { scopes },
      outcome: 'success',
      severity: 'high',
      module: 'security',
      origin: 'api',
      correlation_id: requestId,
      ip_address: forwarded,
      user_agent: request.headers.get('user-agent'),
    });

    return Response.json({ success: true, token: secret.value, expires_at: expiresAt, scopes });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}
