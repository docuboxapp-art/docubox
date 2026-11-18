'use client';

import { useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';

export function useCollaborationApi() {
  const supabase = useMemo(() => createClient(), []);
  return useCallback(
    async <T>(path: string, init?: Parameters<typeof fetch>[1]): Promise<T> => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Tu sesion ha expirado.');
      const headers = new Headers(init?.headers);
      if (!(init?.body instanceof FormData) && !headers.has('Content-Type'))
        headers.set('Content-Type', 'application/json');
      headers.set('Authorization', `Bearer ${token}`);
      const response = await fetch(path, {
        ...init,
        headers,
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudo completar la operacion.');
      return payload as T;
    },
    [supabase]
  );
}
