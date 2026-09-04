'use client';

import { createClient } from '@/lib/supabase/client';

export type NotificationStateAction = 'read' | 'unread' | 'archived';

export async function updateNotifications(
  action: NotificationStateAction,
  notificationIds?: Array<string | number>
) {
  const { data } = await createClient().auth.getSession();
  const response = await fetch('/api/notifications', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(data.session?.access_token
        ? { Authorization: `Bearer ${data.session.access_token}` }
        : {}),
    },
    body: JSON.stringify({ action, notification_ids: notificationIds?.map(String) }),
  });
  if (!response.ok) throw new Error('No fue posible actualizar las notificaciones.');
  return response.json() as Promise<{ updated: string[] }>;
}
