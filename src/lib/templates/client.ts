'use client';

import { createClient } from '@/lib/supabase/client';

export async function templateApiFetch(
  input: Parameters<typeof fetch>[0],
  init: NonNullable<Parameters<typeof fetch>[1]> = {}
) {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Tu sesión ha expirado. Vuelve a iniciar sesión.');

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(input, {
    ...init,
    headers,
    cache: 'no-store',
  });
}
