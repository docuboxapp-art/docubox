'use client';

import { createClient } from '@/lib/supabase/client';

export async function bulkSignatureApiFetch(
  input: Parameters<typeof fetch>[0],
  init: NonNullable<Parameters<typeof fetch>[1]> = {}
) {
  const { data } = await createClient().auth.getSession();
  if (!data.session?.access_token) {
    throw new Error('Tu sesion ha expirado. Vuelve a iniciar sesion.');
  }
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${data.session.access_token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(input, { ...init, headers, cache: 'no-store' });
}
