import 'server-only';

import { lookup } from 'node:dns/promises';
import { createOpaqueSecret, encryptOrganizationSecret } from '@/lib/organization/server';
import { isPrivateNetworkAddress, parsePublicWebhookUrl } from '@/lib/organization/webhook-security';
import type { PublicApiContext } from './server';
import { PublicApiError } from './server';

export const PUBLIC_WEBHOOK_EVENTS = [
  'document.created',
  'document.sent',
  'document.cancelled',
  'document.completed',
  'participant.completion_committed',
  'workflow.participation_advanced',
] as const;

const safeColumns =
  'id,workspace_id,name,endpoint_url,environment,event_types,status,failure_count,last_delivery_at,last_success_at,last_failure_at,created_at,updated_at';

export async function validatePublicWebhookUrl(value: unknown) {
  const url = parsePublicWebhookUrl(value);
  if (!url) throw new PublicApiError(400, 'invalid_webhook_url', 'La URL HTTPS no es valida.');
  try {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateNetworkAddress(address))) {
      throw new PublicApiError(400, 'invalid_webhook_url', 'La URL no puede apuntar a una red privada.');
    }
  } catch (cause) {
    if (cause instanceof PublicApiError) throw cause;
    throw new PublicApiError(400, 'webhook_host_unresolved', 'El host del webhook no se pudo validar.');
  }
  return url.toString();
}

export function normalizePublicWebhookEvents(value: unknown) {
  const allowed = new Set<string>(PUBLIC_WEBHOOK_EVENTS);
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string' && allowed.has(item)))]
    : [];
}

export async function createPublicWebhook(context: PublicApiContext, input: Record<string, unknown>) {
  const name = String(input.name || '').trim();
  const endpointUrl = await validatePublicWebhookUrl(input.endpoint_url);
  const eventTypes = normalizePublicWebhookEvents(input.event_types);
  if (!name || name.length > 120 || !eventTypes.length) {
    throw new PublicApiError(400, 'invalid_webhook', 'Nombre y eventos validos son obligatorios.');
  }
  const secret = createOpaqueSecret('whsec');
  const encrypted = encryptOrganizationSecret(secret.value);
  const result = await context.service
    .from('organization_webhook_endpoints')
    .insert({
      workspace_id: context.credential.workspace_id,
      name,
      endpoint_url: endpointUrl,
      environment: context.credential.environment,
      event_types: eventTypes,
      secret_hash: secret.hash,
      secret_ciphertext: encrypted.ciphertext,
      secret_iv: encrypted.iv,
      secret_tag: encrypted.tag,
      secret_version: encrypted.version,
      created_by: context.credential.created_by,
    })
    .select(safeColumns)
    .single();
  if (result.error) throw result.error;
  await context.service.from('organization_audit_events').insert({
    workspace_id: context.credential.workspace_id,
    actor_user_id: context.credential.created_by,
    event_type: 'integration.webhook.created',
    resource_type: 'organization_webhook_endpoint',
    resource_id: result.data.id,
    summary: `Webhook creado mediante API: ${name}`,
    severity: 'high',
    module: 'integrations',
    origin: 'api',
    payload: { credential_id: context.credential.id, event_types: eventTypes },
  });
  return { data: result.data, secret: secret.value, shown_once: true };
}

export { safeColumns as publicWebhookSafeColumns };
