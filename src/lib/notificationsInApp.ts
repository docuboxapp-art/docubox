'use client';

import { createClient } from '@/lib/supabase/client';

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

/**
 * Puente de compatibilidad para flujos antiguos del navegador. El backend liga
 * el destinatario a la sesión autenticada para impedir envíos a otras cuentas.
 */
export async function createNotification(params: CreateNotificationParams): Promise<void> {
  const { data } = await createClient().auth.getSession();
  const response = await fetch('/api/notifications/self', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(data.session?.access_token
        ? { Authorization: `Bearer ${data.session.access_token}` }
        : {}),
    },
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error('No fue posible registrar la notificación.');
}

/**
 * Las notificaciones a terceros se emiten exclusivamente desde el backend.
 */
export async function createNotificationsForUsers(): Promise<void> {
  throw new Error('Las notificaciones para otros usuarios deben emitirse desde el servidor.');
}
