'use client';

import { useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';

export function useCertificaApi() {
  const supabase = useMemo(() => createClient(), []);
  return useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Tu sesion ha expirado.');
    const isForm = init?.body instanceof FormData;
    const response = await fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(!isForm ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {}),
      },
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'No se pudo completar la operacion.');
    return payload as T;
  }, [supabase]);
}
