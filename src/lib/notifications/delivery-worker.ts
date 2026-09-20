import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmailNotification } from '@/lib/emailNotifications';
import { sendSms, SmsConfigurationError } from '@/lib/smsNotifications';

const MAX_ATTEMPTS = 4;

function retryDelaySeconds(attempt: number) {
  return Math.min(30 * 2 ** Math.max(0, attempt - 1), 60 * 60);
}

async function appendDeliveryEvent(
  service: SupabaseClient,
  input: {
    notificationId: string;
    workspaceId?: string | null;
    eventType: string;
    outcome: 'delivery_sent' | 'delivery_failed' | 'delivery_queued';
    channel: string;
    code?: string | null;
  }
) {
  const result = await service.from('notification_event_log').insert({
    notification_id: input.notificationId,
    workspace_id: input.workspaceId || null,
    event_type: input.eventType,
    outcome: input.outcome,
    metadata: { channel: input.channel, error_code: input.code || null },
  });
  if (result.error) throw result.error;
}

async function queueFallback(
  service: SupabaseClient,
  delivery: Record<string, unknown>,
  notification: Record<string, unknown>
) {
  const fallback = String(delivery.fallback_channel || '');
  if (!['email', 'sms'].includes(fallback)) return false;
  const inserted = await service.from('notification_deliveries').insert({
    notification_id: notification.id,
    channel: fallback,
    status: 'queued',
    provider: null,
    delivery_policy: 'single',
    fallback_channel: null,
  });
  if (inserted.error?.code !== '23505' && inserted.error) throw inserted.error;
  await appendDeliveryEvent(service, {
    notificationId: String(notification.id),
    workspaceId: String(notification.workspace_id || '') || null,
    eventType: String(notification.event_type || 'notification.delivery'),
    outcome: 'delivery_queued',
    channel: fallback,
  });
  return true;
}

export async function processNotificationDeliveries(
  service: SupabaseClient,
  options: { limit?: number; now?: Date } = {}
) {
  const now = options.now || new Date();
  const limit = Math.min(Math.max(options.limit || 25, 1), 100);
  const summary = { scanned: 0, delivered: 0, retrying: 0, failed: 0, fallbackQueued: 0 };

  for (let index = 0; index < limit; index += 1) {
    const claim = await service.rpc('claim_due_notification_delivery', {
      p_now: now.toISOString(),
    });
    if (claim.error) throw claim.error;
    const delivery = Array.isArray(claim.data) ? claim.data[0] : claim.data;
    if (!delivery) break;
    summary.scanned += 1;
    const attempt = Number(delivery.attempt_count || 1);

    const notificationResult = await service
      .from('notifications')
      .select(
        'id,user_id,workspace_id,event_type,title,description,entity_id,action_url,idempotency_key'
      )
      .eq('id', delivery.notification_id)
      .maybeSingle();
    if (notificationResult.error || !notificationResult.data) {
      await service
        .from('notification_deliveries')
        .update({
          status: 'cancelled',
          last_error_code: 'NOTIFICATION_NOT_FOUND',
          failed_at: new Date().toISOString(),
        })
        .eq('id', delivery.id)
        .eq('status', 'processing');
      summary.failed += 1;
      continue;
    }
    const notification = notificationResult.data;
    const profileResult = await service
      .from('user_profiles')
      .select('id,email,full_name,phone,telefono')
      .eq('id', notification.user_id)
      .maybeSingle();
    if (profileResult.error) throw profileResult.error;

    try {
      let providerMessageId: string | null = null;
      let provider = '';
      if (delivery.channel === 'email') {
        const email = String(profileResult.data?.email || '').trim();
        if (!email.includes('@')) throw new Error('DELIVERY_EMAIL_UNAVAILABLE');
        const result = await sendEmailNotification({
          type: 'action_required',
          to: email,
          recipientName: profileResult.data?.full_name || undefined,
          actionDescription: String(notification.description || ''),
          documentName: String(notification.title || 'Docubox'),
          documentUrl: notification.action_url || undefined,
          idempotencyKey: String(notification.idempotency_key || `notification/${notification.id}`),
        });
        provider = 'resend';
        providerMessageId = result.id || null;
      } else if (delivery.channel === 'sms') {
        const phone = String(
          profileResult.data?.telefono || profileResult.data?.phone || ''
        ).trim();
        if (!phone) throw new Error('DELIVERY_SMS_UNAVAILABLE');
        const result = await sendSms({
          phone,
          recipientName: profileResult.data?.full_name || undefined,
          documentName: String(notification.title || 'Docubox'),
          message: String(notification.description || '').slice(0, 500),
        });
        if (result.error) throw new Error(result.codigo_error || 'SMS_PROVIDER_REJECTED');
        provider = 'envia-sms';
        providerMessageId =
          result.response?.identificador && typeof result.response.identificador === 'object'
            ? JSON.stringify(result.response.identificador).slice(0, 500)
            : null;
      } else {
        throw new Error('DELIVERY_CHANNEL_NOT_SUPPORTED');
      }

      const completed = await service
        .from('notification_deliveries')
        .update({
          status: 'sent',
          provider,
          provider_message_id: providerMessageId,
          sent_at: new Date().toISOString(),
          last_error_code: null,
          last_error_detail: {},
          next_retry_at: null,
        })
        .eq('id', delivery.id)
        .eq('status', 'processing');
      if (completed.error) throw completed.error;
      await appendDeliveryEvent(service, {
        notificationId: String(notification.id),
        workspaceId: notification.workspace_id,
        eventType: notification.event_type,
        outcome: 'delivery_sent',
        channel: delivery.channel,
      });
      summary.delivered += 1;
    } catch (cause) {
      const code = cause instanceof Error ? cause.message.slice(0, 120) : 'DELIVERY_FAILED';
      const configuredFailure =
        cause instanceof SmsConfigurationError ||
        /UNAVAILABLE|NOT_SUPPORTED|NOT_CONFIGURED|INVALID/i.test(code);
      // A network failure after invoking an SMS provider is ambiguous. Do not
      // retry it automatically because that could duplicate a text message.
      const ambiguousSms = delivery.channel === 'sms' && cause instanceof TypeError;
      const shouldRetry = !configuredFailure && !ambiguousSms && attempt < MAX_ATTEMPTS;
      const failed = await service
        .from('notification_deliveries')
        .update({
          status: shouldRetry ? 'failed' : 'cancelled',
          last_error_code: code,
          last_error_detail: { retryable: shouldRetry, ambiguous: ambiguousSms },
          next_retry_at: shouldRetry
            ? new Date(now.getTime() + retryDelaySeconds(attempt) * 1000).toISOString()
            : null,
          failed_at: new Date().toISOString(),
        })
        .eq('id', delivery.id)
        .eq('status', 'processing');
      if (failed.error) throw failed.error;
      await appendDeliveryEvent(service, {
        notificationId: String(notification.id),
        workspaceId: notification.workspace_id,
        eventType: notification.event_type,
        outcome: 'delivery_failed',
        channel: delivery.channel,
        code,
      });
      if (shouldRetry) summary.retrying += 1;
      else {
        summary.failed += 1;
        if (await queueFallback(service, delivery, notification)) summary.fallbackQueued += 1;
      }
    }
  }
  return summary;
}
