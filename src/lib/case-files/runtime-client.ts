'use client';
import { createClient } from '@/lib/supabase/client';

export async function caseRequest<T>(url: string, body?: unknown): Promise<T> {
  const session = await createClient().auth.getSession();
  const token = session.data.session?.access_token;
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    cache: 'no-store',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      typeof result.error === 'string' ? result.error : 'No se pudo completar la operación.'
    );
  return result.data as T;
}
