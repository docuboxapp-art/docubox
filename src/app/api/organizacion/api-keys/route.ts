import { createOpaqueSecret, authorizeOrganizationRequest, organizationApiFailure, requireOrganizationReauthentication } from '@/lib/organization/server';

export const runtime = 'nodejs';

const safeColumns = 'id,workspace_id,name,environment,key_prefix,scopes,status,last_used_at,expires_at,rotated_at,created_by,created_at,revoked_at';
const allowedScopes = new Set([
  'documents.read', 'documents.write', 'signatures.read', 'signatures.write',
  'forms.read', 'cases.read', 'identity.read', 'webhooks.manage',
]);

function normalizeScopes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((scope): scope is string => typeof scope === 'string' && allowedScopes.has(scope)))];
}

export async function GET(request: Request) {
  try {
    const workspaceId = new URL(request.url).searchParams.get('workspace_id') || '';
    const { service } = await authorizeOrganizationRequest(request, workspaceId, 'integrations.read');
    const { data, error } = await service.from('organization_api_credentials').select(safeColumns).eq('workspace_id', workspaceId).order('created_at', { ascending: false });
    if (error) throw error;
    return Response.json({ success: true, data });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const workspaceId = String(body.workspace_id || '');
    const name = String(body.name || '').trim();
    const environment = body.environment === 'production' ? 'production' : 'sandbox';
    const scopes = normalizeScopes(body.scopes);
    if (!name || name.length > 100) return Response.json({ success: false, error: 'Indica un nombre válido.' }, { status: 400 });
    if (!scopes.length) return Response.json({ success: false, error: 'Selecciona al menos un alcance.' }, { status: 400 });

    const { user, service } = await authorizeOrganizationRequest(request, workspaceId, 'integrations.manage');
    await requireOrganizationReauthentication(request, workspaceId, user.id, 'integrations.manage');
    const secret = createOpaqueSecret(environment === 'production' ? 'dbx_live' : 'dbx_test');
    const expiresAt = body.expires_at ? new Date(body.expires_at) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) return Response.json({ success: false, error: 'La fecha de expiración no es válida.' }, { status: 400 });

    const { data, error } = await service.from('organization_api_credentials').insert({
      workspace_id: workspaceId,
      name,
      environment,
      key_prefix: secret.publicPrefix,
      secret_hash: secret.hash,
      scopes,
      expires_at: expiresAt?.toISOString() || null,
      created_by: user.id,
    }).select(safeColumns).single();
    if (error) throw error;

    await service.from('organization_audit_events').insert({
      workspace_id: workspaceId,
      actor_user_id: user.id,
      event_type: 'integration.api_key.created',
      resource_type: 'organization_api_credential',
      resource_id: data.id,
      summary: `API key creada: ${name}`,
      severity: 'high',
      module: 'integrations',
      payload: { environment, scopes, key_prefix: secret.publicPrefix },
    });

    return Response.json({ success: true, data, secret: secret.value, shown_once: true }, { status: 201 });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const workspaceId = String(body.workspace_id || '');
    const id = String(body.id || '');
    const action = String(body.action || '');
    if (!id || !['revoke', 'rotate'].includes(action)) return Response.json({ success: false, error: 'Acción inválida.' }, { status: 400 });
    const { user, service } = await authorizeOrganizationRequest(request, workspaceId, 'integrations.manage');
    await requireOrganizationReauthentication(request, workspaceId, user.id, 'integrations.manage');
    const { data: existing, error: readError } = await service.from('organization_api_credentials').select(safeColumns).eq('workspace_id', workspaceId).eq('id', id).single();
    if (readError || !existing) return Response.json({ success: false, error: 'No se encontró la credencial.' }, { status: 404 });

    if (action === 'revoke') {
      const { data, error } = await service.from('organization_api_credentials').update({ status: 'revoked', revoked_at: new Date().toISOString() }).eq('id', id).eq('workspace_id', workspaceId).select(safeColumns).single();
      if (error) throw error;
      await service.from('organization_audit_events').insert({ workspace_id: workspaceId, actor_user_id: user.id, event_type: 'integration.api_key.revoked', resource_type: 'organization_api_credential', resource_id: id, summary: `API key revocada: ${existing.name}`, severity: 'critical', module: 'integrations' });
      return Response.json({ success: true, data });
    }

    const secret = createOpaqueSecret(existing.environment === 'production' ? 'dbx_live' : 'dbx_test');
    const { data, error } = await service.from('organization_api_credentials').update({ key_prefix: secret.publicPrefix, secret_hash: secret.hash, status: 'active', rotated_at: new Date().toISOString(), revoked_at: null }).eq('id', id).eq('workspace_id', workspaceId).select(safeColumns).single();
    if (error) throw error;
    await service.from('organization_audit_events').insert({ workspace_id: workspaceId, actor_user_id: user.id, event_type: 'integration.api_key.rotated', resource_type: 'organization_api_credential', resource_id: id, summary: `API key rotada: ${existing.name}`, severity: 'high', module: 'integrations', payload: { key_prefix: secret.publicPrefix } });
    return Response.json({ success: true, data, secret: secret.value, shown_once: true });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}
