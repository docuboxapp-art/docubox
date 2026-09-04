import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import {
  categoryForLegacyType,
  isMandatoryNotification,
  notificationEventPolicy,
  sanitizeNotificationMetadata,
  severityForLegacyPriority,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationLegacyPriority,
  type NotificationSeverity,
} from './policy';

type LegacyType = 'document' | 'task' | 'request' | 'alert' | 'info';

export type NotificationRecipient = {
  userId: string;
  email?: string | null;
};

export type EmitDomainEventInput = {
  type: string;
  recipients: NotificationRecipient[];
  title: string;
  description: string;
  category?: NotificationCategory;
  severity?: NotificationSeverity;
  legacyPriority?: NotificationLegacyPriority;
  legacyType?: LegacyType;
  workspaceId?: string | null;
  actorUserId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actionUrl?: string | null;
  actionLabel?: string | null;
  metadata?: Record<string, unknown>;
  deduplicationKey?: string | null;
  expiresAt?: string | null;
  channels?: NotificationChannel[];
  requestId?: string | null;
};

type Preference = {
  user_id: string;
  category: NotificationCategory;
  in_app_enabled: boolean;
  email_enabled: boolean;
};

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function cleanText(value: string, maxLength: number) {
  return value
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function uuidOrNull(value: unknown): string | null {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function toLegacyPriority(severity: NotificationSeverity): 'alta' | 'media' | 'baja' {
  if (severity === 'critical' || severity === 'warning') return 'alta';
  if (severity === 'success') return 'baja';
  return 'media';
}

function preferenceAllows(
  preference: Preference | undefined,
  channel: NotificationChannel,
  category: NotificationCategory,
  severity: NotificationSeverity
) {
  if (isMandatoryNotification(category, severity)) return true;
  if (!preference) return true;
  if (channel === 'in_app') return preference.in_app_enabled;
  if (channel === 'email') return preference.email_enabled;
  return false;
}

async function appendEvent(
  service: SupabaseClient,
  input: {
    notificationId: string;
    workspaceId?: string | null;
    actorUserId?: string | null;
    eventType: string;
    outcome:
      | 'created'
      | 'deduplicated'
      | 'delivery_queued'
      | 'delivery_sent'
      | 'delivery_failed'
      | 'read'
      | 'unread'
      | 'archived';
    requestId?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const { error } = await service.from('notification_event_log').insert({
    notification_id: input.notificationId,
    workspace_id: input.workspaceId ?? null,
    actor_user_id: input.actorUserId ?? null,
    event_type: input.eventType,
    outcome: input.outcome,
    request_id: input.requestId ?? null,
    metadata: sanitizeNotificationMetadata(input.metadata ?? {}),
  });
  if (error) throw error;
}

export async function emitDomainEvent(input: EmitDomainEventInput) {
  const service = createServiceClient();
  const eventPolicy = notificationEventPolicy(input.type);
  const category =
    input.category ?? eventPolicy?.category ?? categoryForLegacyType(input.legacyType);
  const severity =
    input.severity ??
    eventPolicy?.severity ??
    severityForLegacyPriority(
      input.legacyPriority ?? (input.metadata?.priority as string | undefined)
    );
  const legacyPriority = input.legacyPriority ?? eventPolicy?.legacyPriority;
  const requestedChannels: NotificationChannel[] = input.channels?.length
    ? input.channels
    : (eventPolicy?.channels ?? ['in_app']);
  const channels = [
    ...new Set<NotificationChannel>(
      isMandatoryNotification(category, severity)
        ? [...requestedChannels, 'in_app', 'email']
        : requestedChannels
    ),
  ];
  const recipients = [
    ...new Map(
      input.recipients
        .filter((recipient) => recipient.userId)
        .map((recipient) => [recipient.userId, recipient])
    ).values(),
  ];
  const metadata = sanitizeNotificationMetadata(input.metadata ?? {});
  let workspaceId = uuidOrNull(input.workspaceId) ?? uuidOrNull(metadata.workspace_id);
  const entityId = uuidOrNull(input.entityId);
  const actorUserId = uuidOrNull(input.actorUserId);
  const requestId = uuidOrNull(input.requestId);

  if (!input.type || !/^[a-z][a-z0-9_.-]{2,120}$/i.test(input.type)) {
    throw new Error('Invalid notification event type.');
  }
  if (!recipients.length) return { created: [], deduplicated: [] };

  // Document events must remain tenant-scoped even when a legacy caller did
  // not pass the workspace explicitly.
  if (!workspaceId && entityId && input.entityType === 'document') {
    const documentContext = await service
      .from('documentos')
      .select('workspace_id')
      .eq('id', entityId)
      .maybeSingle();
    if (documentContext.error) throw documentContext.error;
    workspaceId = uuidOrNull(documentContext.data?.workspace_id);
  }

  const preferenceResult = await service
    .from('notification_preferences')
    .select('user_id,category,in_app_enabled,email_enabled')
    .in(
      'user_id',
      recipients.map((recipient) => recipient.userId)
    )
    .eq('category', category);
  if (preferenceResult.error) throw preferenceResult.error;
  const preferences = new Map(
    ((preferenceResult.data ?? []) as Preference[]).map((preference) => [
      preference.user_id,
      preference,
    ])
  );

  const created: string[] = [];
  const deduplicated: string[] = [];
  for (const recipient of recipients) {
    const preference = preferences.get(recipient.userId);
    if (!channels.some((channel) => preferenceAllows(preference, channel, category, severity)))
      continue;

    const scopedDeduplicationKey = input.deduplicationKey
      ? `${cleanText(input.deduplicationKey, 360)}:${recipient.userId}`
      : null;
    const now = new Date().toISOString();
    const row = {
      user_id: recipient.userId,
      workspace_id: workspaceId,
      type: input.legacyType ?? eventPolicy?.legacyType ?? 'info',
      title: cleanText(input.title, 180),
      description: cleanText(input.description, 1000),
      priority: legacyPriority ?? toLegacyPriority(severity),
      read: false,
      status: 'unread',
      category,
      event_type: input.type,
      severity,
      entity_type: input.entityType ?? null,
      entity_id: entityId,
      action_url: input.actionUrl ?? null,
      action_label: input.actionLabel ?? null,
      actor_user_id: actorUserId,
      metadata,
      expires_at: input.expiresAt ?? null,
      idempotency_key: scopedDeduplicationKey,
      created_at: now,
    };

    const inserted = await service.from('notifications').insert(row).select('id').maybeSingle();
    if (inserted.error && inserted.error.code !== '23505') throw inserted.error;

    let notificationId = inserted.data?.id as string | undefined;
    if (!notificationId && scopedDeduplicationKey) {
      const existing = await service
        .from('notifications')
        .select('id')
        .eq('idempotency_key', scopedDeduplicationKey)
        .maybeSingle();
      if (existing.error || !existing.data?.id)
        throw existing.error ?? new Error('Notification deduplication lookup failed.');
      notificationId = existing.data.id as string;
      deduplicated.push(notificationId);
      await appendEvent(service, {
        notificationId,
        workspaceId: row.workspace_id,
        actorUserId,
        eventType: input.type,
        outcome: 'deduplicated',
        requestId,
      });
      continue;
    }
    if (!notificationId) throw new Error('Notification could not be persisted.');

    created.push(notificationId);
    await appendEvent(service, {
      notificationId,
      workspaceId: row.workspace_id,
      actorUserId,
      eventType: input.type,
      outcome: 'created',
      requestId,
      metadata: { category, severity },
    });

    for (const channel of channels) {
      if (!preferenceAllows(preference, channel, category, severity)) continue;
      const delivery = await service.from('notification_deliveries').insert({
        notification_id: notificationId,
        channel,
        status: channel === 'in_app' ? 'delivered' : 'queued',
        provider: channel === 'in_app' ? 'docubox' : null,
        recipient_email_sha256:
          channel === 'email' && recipient.email
            ? sha256(recipient.email.trim().toLowerCase())
            : null,
        delivered_at: channel === 'in_app' ? now : null,
      });
      if (delivery.error && delivery.error.code !== '23505') throw delivery.error;
      await appendEvent(service, {
        notificationId,
        workspaceId: row.workspace_id,
        actorUserId,
        eventType: input.type,
        outcome: channel === 'in_app' ? 'delivery_sent' : 'delivery_queued',
        requestId,
        metadata: { channel },
      });
    }
  }
  return { created, deduplicated };
}

export async function recordNotificationState(input: {
  userId: string;
  notificationIds?: string[];
  action: 'read' | 'unread' | 'archived';
  requestId?: string | null;
}) {
  const service = createServiceClient();
  const ids = [...new Set((input.notificationIds ?? []).filter(Boolean))];
  let query = service
    .from('notifications')
    .update(
      input.action === 'read'
        ? { status: 'read', read: true, read_at: new Date().toISOString() }
        : input.action === 'unread'
          ? { status: 'unread', read: false, read_at: null }
          : { status: 'archived', read: true, archived_at: new Date().toISOString() }
    )
    .eq('user_id', input.userId);
  if (ids.length) query = query.in('id', ids);
  else if (input.action !== 'read') return [];

  const updated = await query.select('id,workspace_id,event_type');
  if (updated.error) throw updated.error;
  await Promise.all(
    (updated.data ?? []).map(
      (notification: { id: string; workspace_id: string | null; event_type: string }) =>
        appendEvent(service, {
          notificationId: notification.id,
          workspaceId: notification.workspace_id,
          actorUserId: input.userId,
          eventType: notification.event_type,
          outcome: input.action,
          requestId: input.requestId,
        })
    )
  );
  return updated.data ?? [];
}

export function createNotificationRequestId() {
  return randomUUID();
}
