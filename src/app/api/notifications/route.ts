import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { recordNotificationState } from '@/lib/notifications/service';
import { createAnonClient } from '@/lib/supabase/server';

async function getAuthenticatedUser(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (token) {
    const { data, error } = await createAnonClient().auth.getUser(token);
    if (!error && data.user) return data.user;
  }
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  );
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user;
}

export async function PATCH(request: NextRequest) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const action = body.action;
  if (!['read', 'unread', 'archived'].includes(action)) {
    return NextResponse.json({ error: 'Acción no válida.' }, { status: 400 });
  }
  const notificationIds = Array.isArray(body.notification_ids)
    ? body.notification_ids.filter(
        (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)
      )
    : [];
  if (action !== 'read' && notificationIds.length === 0) {
    return NextResponse.json({ error: 'Selecciona al menos una notificación.' }, { status: 400 });
  }

  try {
    const updated = await recordNotificationState({
      userId: user.id,
      notificationIds,
      action,
      requestId: request.headers.get('x-request-id'),
    });
    return NextResponse.json({ updated: updated.map((row: { id: string }) => row.id) });
  } catch (error) {
    console.error('[notifications] state update failed', error);
    return NextResponse.json(
      { error: 'No fue posible actualizar las notificaciones.' },
      { status: 500 }
    );
  }
}
