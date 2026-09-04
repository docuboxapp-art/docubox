import 'server-only';

import { emitDomainEvent } from '@/lib/notifications/service';
import {
  categoryForLegacyType,
  severityForLegacyPriority,
  type NotificationCategory,
  type NotificationSeverity,
} from '@/lib/notifications/policy';

export type NotificationType = 'document' | 'task' | 'request' | 'alert' | 'info';
export type NotificationPriority = 'alta' | 'media' | 'baja';

export interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  description: string;
  priority?: NotificationPriority;
  metadata?: Record<string, unknown>;
  eventType?: string;
  category?: NotificationCategory;
  severity?: NotificationSeverity;
  workspaceId?: string | null;
  actorUserId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actionUrl?: string | null;
  actionLabel?: string | null;
  deduplicationKey?: string | null;
}

function eventTypeFor(params: Omit<CreateNotificationParams, 'userId'>) {
  if (params.eventType) return params.eventType;
  const action = typeof params.metadata?.action === 'string' ? params.metadata.action : 'updated';
  return `${categoryForLegacyType(params.type).toLowerCase()}.${action}`;
}

function workspaceFor(params: Omit<CreateNotificationParams, 'userId'>) {
  return (
    params.workspaceId ??
    (typeof params.metadata?.workspace_id === 'string' ? params.metadata.workspace_id : null)
  );
}

function documentIdFor(params: Omit<CreateNotificationParams, 'userId'>) {
  if (typeof params.metadata?.documentoId === 'string') return params.metadata.documentoId;
  if (typeof params.metadata?.documentId === 'string') return params.metadata.documentId;
  return null;
}

function documentActionUrl(params: Omit<CreateNotificationParams, 'userId'>) {
  if (
    typeof params.metadata?.documentUrl === 'string' &&
    params.metadata.documentUrl.startsWith('/')
  ) {
    return params.metadata.documentUrl;
  }
  const documentId = documentIdFor(params);
  return documentId ? `/visor-documento/${documentId}` : null;
}

export async function createNotificationServer(params: CreateNotificationParams): Promise<void> {
  await emitDomainEvent({
    type: eventTypeFor(params),
    recipients: [{ userId: params.userId }],
    title: params.title,
    description: params.description,
    legacyType: params.type,
    category: params.category ?? categoryForLegacyType(params.type),
    severity: params.severity ?? severityForLegacyPriority(params.priority),
    legacyPriority: params.priority,
    workspaceId: workspaceFor(params),
    actorUserId: params.actorUserId ?? null,
    entityType: params.entityType ?? (documentIdFor(params) ? 'document' : null),
    entityId: params.entityId ?? documentIdFor(params),
    actionUrl: params.actionUrl ?? documentActionUrl(params),
    actionLabel: params.actionLabel ?? (documentIdFor(params) ? 'Ver documento' : null),
    metadata: params.metadata,
    deduplicationKey: params.deduplicationKey,
  });
}

export async function createNotificationsForUsersServer(
  userIds: string[],
  params: Omit<CreateNotificationParams, 'userId'>
): Promise<void> {
  await emitDomainEvent({
    type: eventTypeFor(params),
    recipients: userIds.map((userId) => ({ userId })),
    title: params.title,
    description: params.description,
    legacyType: params.type,
    category: params.category ?? categoryForLegacyType(params.type),
    severity: params.severity ?? severityForLegacyPriority(params.priority),
    legacyPriority: params.priority,
    workspaceId: workspaceFor(params),
    actorUserId: params.actorUserId ?? null,
    entityType: params.entityType ?? (documentIdFor(params) ? 'document' : null),
    entityId: params.entityId ?? documentIdFor(params),
    actionUrl: params.actionUrl ?? documentActionUrl(params),
    actionLabel: params.actionLabel ?? (documentIdFor(params) ? 'Ver documento' : null),
    metadata: params.metadata,
    deduplicationKey: params.deduplicationKey,
  });
}
