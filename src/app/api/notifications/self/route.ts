import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { emitDomainEvent } from '@/lib/notifications/service';
import { categoryForLegacyType, severityForLegacyPriority } from '@/lib/notifications/policy';
import { createAnonClient } from '@/lib/supabase/server';

const TYPES = new Set(['document', 'task', 'request', 'alert', 'info']);
const PRIORITIES = new Set(['alta', 'media', 'baja']);

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

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (
    body.userId !== user.id ||
    !TYPES.has(body.type) ||
    typeof body.title !== 'string' ||
    typeof body.description !== 'string'
  ) {
    return NextResponse.json({ error: 'Solicitud de notificación inválida.' }, { status: 400 });
  }

  const priority = PRIORITIES.has(body.priority) ? body.priority : 'media';
  try {
    await emitDomainEvent({
      type: `${categoryForLegacyType(body.type).toLowerCase()}.client_confirmation`,
      recipients: [{ userId: user.id }],
      title: body.title,
      description: body.description,
      legacyType: body.type,
      category: categoryForLegacyType(body.type),
      severity: severityForLegacyPriority(priority),
      legacyPriority: priority,
      actorUserId: user.id,
      entityType: typeof body.metadata?.documentoId === 'string' ? 'document' : null,
      entityId: typeof body.metadata?.documentoId === 'string' ? body.metadata.documentoId : null,
      actionUrl:
        typeof body.metadata?.documentoId === 'string'
          ? `/visor-documento/${body.metadata.documentoId}`
          : null,
      actionLabel: typeof body.metadata?.documentoId === 'string' ? 'Ver documento' : null,
      metadata: body.metadata,
    });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error('[notifications] client confirmation failed', error);
    return NextResponse.json(
      { error: 'No fue posible registrar la notificación.' },
      { status: 500 }
    );
  }
}
