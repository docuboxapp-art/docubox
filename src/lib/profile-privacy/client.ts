import { createClient } from '@/lib/supabase/client';
import type { ProfileCard } from './model';

export class PrivacyRequestError extends Error {
  constructor(
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

export async function profilePrivacy<T>(action: string, data: object = {}, signal?: AbortSignal) {
  const {
    data: { session },
  } = await createClient().auth.getSession();
  if (!session?.access_token) throw new Error('Inicia sesión para continuar.');
  const response = await fetch('/api/perfil/privacidad', {
    method: 'POST',
    cache: 'no-store',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ ...data, action }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body)
    throw new PrivacyRequestError(
      body?.error || 'No fue posible completar la operación.',
      body?.code
    );
  return body.data as T;
}

export async function loadVisibleProfileCards(ids: string[]) {
  if (!ids.length) return [];
  try {
    const cards = await Promise.all(
      Array.from({ length: Math.ceil(ids.length / 75) }, (_, index) =>
        profilePrivacy<ProfileCard[]>('cards', { ids: ids.slice(index * 75, (index + 1) * 75) })
      )
    );
    return cards.flat();
  } catch (error) {
    if (!(error instanceof PrivacyRequestError) || error.code !== 'PRIVACY_SETUP') throw error;
    const { data, error: dbError } = await createClient()
      .from('user_profiles')
      .select('id,full_name,nombre,apellido_paterno,apellido_materno,email,avatar_url')
      .in('id', ids);
    if (dbError) throw dbError;
    return (data || []).map((row) => ({
      id: row.id,
      name:
        row.full_name ||
        [row.nombre, row.apellido_paterno, row.apellido_materno].filter(Boolean).join(' '),
      email: row.email,
      avatarUrl: row.avatar_url,
    }));
  }
}
