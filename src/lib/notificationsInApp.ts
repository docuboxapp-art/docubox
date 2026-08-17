import { createClient } from '@/lib/supabase/client';
import { createClient as createServiceClient } from '@supabase/supabase-js';

export type NotificationType = 'document' | 'task' | 'request' | 'alert' | 'info';
export type NotificationPriority = 'alta' | 'media' | 'baja';

export interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  description: string;
  priority?: NotificationPriority;
  metadata?: Record<string, unknown>;
}

// ─── Lazy service-role client (server-side only) ──────────────────────────────
let _serviceClient: ReturnType<typeof createServiceClient<any>> | null = null;
function getServiceClient() {
  if (!_serviceClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('[notificationsInApp] Missing Supabase service credentials');
    _serviceClient = createServiceClient<any>(url, key);
  }
  return _serviceClient;
}

/**
 * Inserta una notificación in-app usando el service role (para API routes / server-side).
 * No lanza errores — falla silenciosamente para no interrumpir flujos críticos.
 */
export async function createNotificationServer(params: CreateNotificationParams): Promise<void> {
  try {
    const supabase = getServiceClient();
    await supabase.from('notifications').insert({
      user_id: params.userId,
      type: params.type,
      title: params.title,
      description: params.description,
      priority: params.priority ?? 'media',
      metadata: params.metadata ?? null,
      read: false,
    });
  } catch {
    // Silently ignore — notifications are non-blocking
  }
}

/**
 * Inserta notificaciones para múltiples usuarios usando el service role (server-side).
 */
export async function createNotificationsForUsersServer(
  userIds: string[],
  params: Omit<CreateNotificationParams, 'userId'>
): Promise<void> {
  if (!userIds.length) return;
  try {
    const supabase = getServiceClient();
    const rows = userIds.map((userId) => ({
      user_id: userId,
      type: params.type,
      title: params.title,
      description: params.description,
      priority: params.priority ?? 'media',
      metadata: params.metadata ?? null,
      read: false,
    }));
    await supabase.from('notifications').insert(rows);
  } catch {
    // Silently ignore
  }
}

/**
 * Inserta una notificación in-app para un usuario específico.
 * Usa el cliente de Supabase del navegador (autenticado como el usuario actual).
 * No lanza errores — falla silenciosamente para no interrumpir flujos críticos.
 */
export async function createNotification(params: CreateNotificationParams): Promise<void> {
  try {
    const supabase = createClient();
    await supabase.from('notifications').insert({
      user_id: params.userId,
      type: params.type,
      title: params.title,
      description: params.description,
      priority: params.priority ?? 'media',
      metadata: params.metadata ?? null,
      read: false,
    });
  } catch {
    // Silently ignore — notifications are non-blocking
  }
}

/**
 * Inserta notificaciones para múltiples usuarios a la vez.
 */
export async function createNotificationsForUsers(
  userIds: string[],
  params: Omit<CreateNotificationParams, 'userId'>
): Promise<void> {
  if (!userIds.length) return;
  try {
    const supabase = createClient();
    const rows = userIds.map((userId) => ({
      user_id: userId,
      type: params.type,
      title: params.title,
      description: params.description,
      priority: params.priority ?? 'media',
      metadata: params.metadata ?? null,
      read: false,
    }));
    await supabase.from('notifications').insert(rows);
  } catch {
    // Silently ignore
  }
}
