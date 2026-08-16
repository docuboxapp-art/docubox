import { lookup } from 'node:dns/promises';
import { authorizeOrganizationRequest, createOpaqueSecret, encryptOrganizationSecret, organizationApiFailure, requireOrganizationReauthentication } from '@/lib/organization/server';
import { isPrivateNetworkAddress, parsePublicWebhookUrl } from '@/lib/organization/webhook-security';

export const runtime = 'nodejs';

const safeColumns = 'id,workspace_id,name,endpoint_url,environment,event_types,status,failure_count,last_delivery_at,last_success_at,last_failure_at,created_by,created_at,updated_at';
const internalColumns = `${safeColumns},secret_version`;
const supportedEvents = new Set([
  'document.created', 'document.sent', 'document.viewed', 'document.rejected', 'document.cancelled', 'document.completed',
  'signature.started', 'signature.completed', 'identity.completed', 'identity.review_required',
  'case.opened', 'case.closed', 'certificate.expiring', 'member.invited', 'member.activated', 'member.suspended',
]);

function normalizeEvents(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((event): event is string => typeof event === 'string' && supportedEvents.has(event)))];
}

async function validateEndpoint(value: unknown) {
  try {
    const url = parsePublicWebhookUrl(value);
    if (!url) return '';
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateNetworkAddress(address))) return '';
    return url.toString();
  } catch {
    return '';
  }
}

export async function GET(request: Request) {
  try {
    const workspaceId = new URL(request.url).searchParams.get('workspace_id') || '';
    const { service } = await authorizeOrganizationRequest(request, workspaceId, 'integrations.read');
    const { data, error } = await service.from('organization_webhook_endpoints').select(safeColumns).eq('workspace_id', workspaceId).order('created_at', { ascending: false });
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
    const endpointUrl = await validateEndpoint(body.endpoint_url);
    const environment = body.environment === 'production' ? 'production' : 'sandbox';
    const eventTypes = normalizeEvents(body.event_types);
    if (!name || !endpointUrl || !eventTypes.length) return Response.json({ success: false, error: 'Completa nombre, URL HTTPS y eventos.' }, { status: 400 });

    const { user, service } = await authorizeOrganizationRequest(request, workspaceId, 'integrations.manage');
    await requireOrganizationReauthentication(request, workspaceId, user.id, 'integrations.manage');
    const secret = createOpaqueSecret('whsec');
    const encrypted = encryptOrganizationSecret(secret.value);
    const { data, error } = await service.from('organization_webhook_endpoints').insert({
      workspace_id: workspaceId,
      name,
      endpoint_url: endpointUrl,
      environment,
      event_types: eventTypes,
      secret_hash: secret.hash,
      secret_ciphertext: encrypted.ciphertext,
      secret_iv: encrypted.iv,
      secret_tag: encrypted.tag,
      secret_version: encrypted.version,
      created_by: user.id,
    }).select(safeColumns).single();
    if (error) throw error;
    await service.from('organization_audit_events').insert({ workspace_id: workspaceId, actor_user_id: user.id, event_type: 'integration.webhook.created', resource_type: 'organization_webhook_endpoint', resource_id: data.id, summary: `Webhook creado: ${name}`, severity: 'high', module: 'integrations', payload: { endpoint_origin: new URL(endpointUrl).origin, environment, event_types: eventTypes } });
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
    if (!id || !['enable', 'disable', 'revoke', 'rotate'].includes(action)) return Response.json({ success: false, error: 'Acción inválida.' }, { status: 400 });
    const { user, service } = await authorizeOrganizationRequest(request, workspaceId, 'integrations.manage');
    await requireOrganizationReauthentication(request, workspaceId, user.id, 'integrations.manage');
    const { data: existing, error: readError } = await service.from('organization_webhook_endpoints').select(internalColumns).eq('workspace_id', workspaceId).eq('id', id).single();
    if (readError || !existing) return Response.json({ success: false, error: 'No se encontró el webhook.' }, { status: 404 });

    const status = action === 'enable' ? 'active' : action === 'disable' ? 'disabled' : action === 'revoke' ? 'revoked' : existing.status;
    const changes: Record<string, unknown> = { status };
    let secretValue: string | undefined;
    if (action === 'rotate') {
      const secret = createOpaqueSecret('whsec');
      const encrypted = encryptOrganizationSecret(secret.value);
      Object.assign(changes, { secret_hash: secret.hash, secret_ciphertext: encrypted.ciphertext, secret_iv: encrypted.iv, secret_tag: encrypted.tag, secret_version: Number(existing.secret_version || 1) + 1 });
      secretValue = secret.value;
    }
    const { data, error } = await service.from('organization_webhook_endpoints').update(changes).eq('id', id).eq('workspace_id', workspaceId).select(safeColumns).single();
    if (error) throw error;
    await service.from('organization_audit_events').insert({ workspace_id: workspaceId, actor_user_id: user.id, event_type: `integration.webhook.${action}`, resource_type: 'organization_webhook_endpoint', resource_id: id, summary: `Webhook ${action}: ${existing.name}`, severity: action === 'revoke' ? 'critical' : 'high', module: 'integrations' });
    return Response.json({ success: true, data, ...(secretValue ? { secret: secretValue, shown_once: true } : {}) });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}
