import 'server-only';

import { createDecipheriv, createHash, createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isPrivateNetworkAddress, parsePublicWebhookUrl } from './webhook-security';

const MAX_ATTEMPTS = 5;
const WEBHOOK_TIMEOUT_MS = 8_000;

type CanonicalWebhookEvent = {
  id: string;
  workspace_id: string | null;
  document_id: string;
  participant_reference_id?: string | null;
  event_type: string;
  correlation_id: string;
  occurred_at: string;
  payload?: Record<string, unknown> | null;
};

function decryptWebhookSecret(row: Record<string, unknown>) {
  const master = process.env.ORGANIZATION_CREDENTIAL_ENCRYPTION_KEY;
  if (!master) throw new Error('WEBHOOK_SECRET_STORE_NOT_CONFIGURED');
  const key = createHash('sha256').update(`docubox:organization-secrets:v1:${master}`).digest();
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(String(row.secret_iv || ''), 'base64')
  );
  decipher.setAuthTag(Buffer.from(String(row.secret_tag || ''), 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(String(row.secret_ciphertext || ''), 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function sanitizePayload(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 1000);
  if (Array.isArray(value))
    return value.slice(0, 50).map((item) => sanitizePayload(item, depth + 1));
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/token|secret|password|cookie|authorization|otp|private.?key/i.test(key))
      .slice(0, 80)
      .map(([key, nested]) => [key.slice(0, 120), sanitizePayload(nested, depth + 1)])
  );
}

async function assertSafeDestination(value: unknown) {
  const url = parsePublicWebhookUrl(value);
  if (!url) throw new Error('WEBHOOK_DESTINATION_INVALID');
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateNetworkAddress(address))) {
    throw new Error('WEBHOOK_DESTINATION_PRIVATE');
  }
  return url;
}

function retryDelaySeconds(attempt: number) {
  return Math.min(30 * 2 ** Math.max(0, attempt - 1), 6 * 60 * 60);
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function createWebhookSignature(input: {
  secret: string;
  timestamp: string;
  deliveryId: string;
  body: string;
}) {
  return `v1=${createHmac('sha256', input.secret)
    .update(`${input.timestamp}.${input.deliveryId}.${input.body}`)
    .digest('hex')}`;
}

export async function queueWebhookDeliveriesForEvent(
  service: SupabaseClient,
  event: CanonicalWebhookEvent,
  endpointId?: string | null
) {
  let query = service
    .from('organization_webhook_endpoints')
    .select('id,workspace_id,event_types')
    .eq('workspace_id', event.workspace_id)
    .eq('status', 'active');
  if (endpointId) query = query.eq('id', endpointId);
  const endpoints = await query;
  if (endpoints.error) throw endpoints.error;
  const matching = (endpoints.data || []).filter((endpoint) => {
    if (endpointId) return true;
    const eventTypes = Array.isArray(endpoint.event_types) ? endpoint.event_types : [];
    return eventTypes.includes(event.event_type) || eventTypes.includes('*');
  });
  if (!matching.length) {
    if (endpointId) throw new Error('WEBHOOK_ENDPOINT_UNAVAILABLE');
    return { queued: 0, deduplicated: 0 };
  }

  let queued = 0;
  let deduplicated = 0;
  for (const endpoint of matching) {
    const idempotencyKey = `canonical:${event.id}:endpoint:${endpoint.id}`;
    const inserted = await service.from('organization_webhook_deliveries').insert({
      workspace_id: event.workspace_id,
      endpoint_id: endpoint.id,
      event_type: event.event_type,
      event_id: event.id,
      canonical_event_id: event.id,
      correlation_id: event.correlation_id,
      idempotency_key: idempotencyKey,
      payload: {},
      status: 'pending',
      attempt_number: 1,
    });
    if (inserted.error?.code === '23505') deduplicated += 1;
    else if (inserted.error) throw inserted.error;
    else queued += 1;
  }
  return { queued, deduplicated };
}

export async function processOrganizationWebhookDeliveries(
  service: SupabaseClient,
  options: { limit?: number; now?: Date } = {}
) {
  const now = options.now || new Date();
  const limit = Math.min(Math.max(options.limit || 25, 1), 100);
  const summary = { scanned: 0, delivered: 0, retrying: 0, discarded: 0 };

  for (let index = 0; index < limit; index += 1) {
    const claim = await service.rpc('claim_due_organization_webhook_delivery', {
      p_now: now.toISOString(),
    });
    if (claim.error) throw claim.error;
    const delivery = Array.isArray(claim.data) ? claim.data[0] : claim.data;
    if (!delivery) break;
    summary.scanned += 1;
    const attempt = Number(delivery.attempt_number || 1);

    try {
      const [endpointResult, eventResult] = await Promise.all([
        service
          .from('organization_webhook_endpoints')
          .select(
            'id,workspace_id,endpoint_url,status,secret_ciphertext,secret_iv,secret_tag,secret_version'
          )
          .eq('id', delivery.endpoint_id)
          .eq('workspace_id', delivery.workspace_id)
          .maybeSingle(),
        service
          .from('document_operational_events')
          .select(
            'id,workspace_id,document_id,participant_reference_id,event_type,correlation_id,occurred_at,payload'
          )
          .eq('id', delivery.canonical_event_id || delivery.event_id)
          .eq('workspace_id', delivery.workspace_id)
          .maybeSingle(),
      ]);
      if (endpointResult.error || eventResult.error) {
        throw endpointResult.error || eventResult.error;
      }
      if (
        !endpointResult.data ||
        !['active', 'degraded'].includes(endpointResult.data.status) ||
        !eventResult.data
      ) {
        await service
          .from('organization_webhook_deliveries')
          .update({
            status: 'discarded',
            error_code: 'WEBHOOK_RESOURCE_UNAVAILABLE',
            updated_at: now.toISOString(),
          })
          .eq('id', delivery.id)
          .eq('status', 'processing');
        summary.discarded += 1;
        continue;
      }

      const url = await assertSafeDestination(endpointResult.data.endpoint_url);
      const event = eventResult.data as CanonicalWebhookEvent;
      const body = JSON.stringify({
        schema_version: 1,
        delivery_id: delivery.id,
        event: {
          id: event.id,
          type: event.event_type,
          occurred_at: event.occurred_at,
          correlation_id: event.correlation_id,
          workspace_id: event.workspace_id,
          document_id: event.document_id,
          participant_reference_id: event.participant_reference_id || null,
          data: sanitizePayload(event.payload || {}),
        },
      });
      const timestamp = String(Math.floor(now.getTime() / 1000));
      const secret = decryptWebhookSecret(endpointResult.data);
      const signature = createWebhookSignature({
        secret,
        timestamp,
        deliveryId: delivery.id,
        body,
      });
      const startedAt = Date.now();
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Docubox-Webhooks/1.0',
          'x-docubox-delivery-id': delivery.id,
          'x-docubox-event': event.event_type,
          'x-docubox-timestamp': timestamp,
          'x-docubox-signature': signature,
        },
        body,
      });
      if (!response.ok) {
        const error = new Error(`WEBHOOK_HTTP_${response.status}`) as Error & {
          retryable?: boolean;
          responseStatus?: number;
        };
        error.retryable = isRetryableStatus(response.status);
        error.responseStatus = response.status;
        throw error;
      }

      const completed = await service
        .from('organization_webhook_deliveries')
        .update({
          status: 'delivered',
          response_status: response.status,
          response_time_ms: Date.now() - startedAt,
          delivered_at: new Date().toISOString(),
          next_retry_at: null,
          error_code: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', delivery.id)
        .eq('status', 'processing');
      if (completed.error) throw completed.error;
      await service
        .from('organization_webhook_endpoints')
        .update({
          failure_count: 0,
          last_delivery_at: new Date().toISOString(),
          last_success_at: new Date().toISOString(),
        })
        .eq('id', endpointResult.data.id);
      summary.delivered += 1;
    } catch (cause) {
      const marked = cause as Error & { retryable?: boolean; responseStatus?: number };
      const networkFailure =
        marked.name === 'TimeoutError' ||
        marked.name === 'AbortError' ||
        marked instanceof TypeError;
      const retryable = marked.retryable === true || networkFailure;
      const shouldRetry = retryable && attempt < MAX_ATTEMPTS;
      const nextRetryAt = shouldRetry
        ? new Date(now.getTime() + retryDelaySeconds(attempt) * 1000).toISOString()
        : null;
      const updated = await service
        .from('organization_webhook_deliveries')
        .update({
          status: shouldRetry ? 'retrying' : 'discarded',
          response_status: marked.responseStatus || null,
          error_code: String(marked.message || 'WEBHOOK_DELIVERY_FAILED').slice(0, 120),
          next_retry_at: nextRetryAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', delivery.id)
        .eq('status', 'processing');
      if (updated.error) throw updated.error;
      await service
        .from('organization_webhook_endpoints')
        .update({
          failure_count: attempt,
          last_delivery_at: new Date().toISOString(),
          last_failure_at: new Date().toISOString(),
          status: shouldRetry ? 'degraded' : 'disabled',
        })
        .eq('id', delivery.endpoint_id);
      if (shouldRetry) summary.retrying += 1;
      else summary.discarded += 1;
    }
  }
  return summary;
}
