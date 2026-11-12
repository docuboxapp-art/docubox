import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/** Apply one request deadline without replacing Supabase's auth or RLS behavior. */
export function fetchWithRequestDeadline(deadline: AbortSignal): typeof fetch {
  return (input, init) =>
    fetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline,
    });
}

/**
 * Server-side Supabase client with service role key.
 * Use ONLY in API routes / server-side code — never expose to the browser.
 */
export function createServiceClient(deadline?: AbortSignal) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Supabase service credentials are not configured.');
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false },
    ...(deadline ? { global: { fetch: fetchWithRequestDeadline(deadline) } } : {}),
  });
}

/**
 * Alias for createServiceClient — for API routes that import createClient from server.ts
 */
export function createClient() {
  return createServiceClient();
}

/**
 * Anon client for server-side JWT validation.
 * Use this to validate user Bearer tokens in API routes.
 * The anon key properly validates JWTs against Supabase Auth.
 */
export function createAnonClient(accessToken?: string, deadline?: AbortSignal) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Supabase public credentials are not configured.');
  }
  return createSupabaseClient(url, anonKey, {
    auth: { persistSession: false },
    global:
      accessToken || deadline
        ? {
            ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
            ...(deadline ? { fetch: fetchWithRequestDeadline(deadline) } : {}),
          }
        : undefined,
  });
}
