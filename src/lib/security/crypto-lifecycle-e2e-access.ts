import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

export type CryptoLifecycleE2eAccessReason =
  | 'CRYPTO_LIFECYCLE_E2E_DISABLED'
  | 'CRYPTO_LIFECYCLE_E2E_INTERNAL_ADMIN_REQUIRED'
  | 'CRYPTO_LIFECYCLE_E2E_WORKSPACE_CONTEXT_REQUIRED'
  | 'CRYPTO_LIFECYCLE_E2E_AUTH_LOOKUP_FAILED';

export type CryptoLifecycleE2eAccessResult =
  | { allowed: true; workspaceId: string; internalRole: 'super_admin' }
  | { allowed: false; reason: CryptoLifecycleE2eAccessReason };

function enabled(value: string | undefined) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(value || '')
      .trim()
      .toLowerCase()
  );
}

export function lifecycleRunnerEnabled() {
  return enabled(process.env.CRYPTO_LIFECYCLE_E2E_ENABLED);
}

async function isInternalSuperAdmin(
  userId: string,
  service: ReturnType<typeof createServiceClient>
) {
  const result = await service.rpc('is_internal_super_admin', { p_user_id: userId });
  if (result.error || typeof result.data !== 'boolean') return null;
  return result.data;
}

async function findLifecycleWorkspace(
  userId: string,
  service: ReturnType<typeof createServiceClient>
) {
  const membership = await service
    .from('workspace_members')
    .select('workspace_id,role,status')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (membership.error || !membership.data?.workspace_id) return null;
  return membership.data.workspace_id as string;
}

/**
 * Shared guard for the temporary lifecycle runner. `is_super_admin` is stored
 * in auth.users and resolved through a service-role-only database function,
 * never from user-editable metadata or tenant/workspace roles.
 */
export async function requireCryptoLifecycleE2EAccess(
  user: User,
  service: ReturnType<typeof createServiceClient>
): Promise<CryptoLifecycleE2eAccessResult> {
  if (!lifecycleRunnerEnabled()) {
    return { allowed: false, reason: 'CRYPTO_LIFECYCLE_E2E_DISABLED' };
  }

  const superAdmin = await isInternalSuperAdmin(user.id, service);
  if (superAdmin === null) {
    return { allowed: false, reason: 'CRYPTO_LIFECYCLE_E2E_AUTH_LOOKUP_FAILED' };
  }
  if (!superAdmin) {
    return { allowed: false, reason: 'CRYPTO_LIFECYCLE_E2E_INTERNAL_ADMIN_REQUIRED' };
  }

  const workspaceId = await findLifecycleWorkspace(user.id, service);
  if (!workspaceId) {
    return { allowed: false, reason: 'CRYPTO_LIFECYCLE_E2E_WORKSPACE_CONTEXT_REQUIRED' };
  }

  return { allowed: true, workspaceId, internalRole: 'super_admin' };
}

export async function getRequestCookieUser(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll() {
        // The runner does not refresh or mutate the browser session.
      },
    },
  });
  const { data, error } = await client.auth.getUser();
  return error || !data.user ? null : data.user;
}

export async function getServerCookieUser() {
  const cookieStore = await cookies();
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // This read-only gate never refreshes or mutates the session.
        },
      },
    }
  );
  const { data, error } = await client.auth.getUser();
  return error || !data.user ? null : data.user;
}

export async function getAuthenticatedRequestUser(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice(7).trim();
    const { data, error } = await createAnonClient().auth.getUser(token);
    if (error || !data.user) return null;
    return data.user;
  }
  return getRequestCookieUser(request);
}
