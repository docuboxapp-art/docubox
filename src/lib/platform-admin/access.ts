import 'server-only';

import type { User } from '@supabase/supabase-js';
import { cache } from 'react';
import { getServerCookieUser } from '@/lib/security/crypto-lifecycle-e2e-access';
import { createServiceClient } from '@/lib/supabase/server';
import { hasPlatformPermissionForNavigation } from '@/lib/platform-admin/authorization';

export type PlatformAccess = {
  active: true;
  role: string;
  permissions: string[];
  requiresStepUp: boolean;
  totpEnrolled: boolean;
  passkeyRequired: boolean;
  passkeyEnrolled: boolean;
  source: 'platform_staff' | 'auth.users.is_super_admin';
};

type PlatformAccessPayload = {
  active?: unknown;
  role?: unknown;
  permissions?: unknown;
  requires_step_up?: unknown;
  totp_enrolled?: unknown;
  passkey_required?: unknown;
  passkey_enrolled?: unknown;
  source?: unknown;
};

function parseAccessPayload(value: unknown): PlatformAccess | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as PlatformAccessPayload;
  if (payload.active !== true || typeof payload.role !== 'string') return null;
  const permissions = Array.isArray(payload.permissions)
    ? payload.permissions.filter(
        (permission): permission is string => typeof permission === 'string'
      )
    : [];
  const source =
    payload.source === 'auth.users.is_super_admin' ? 'auth.users.is_super_admin' : 'platform_staff';

  return {
    active: true,
    role: payload.role,
    permissions,
    requiresStepUp: payload.requires_step_up !== false,
    totpEnrolled: payload.totp_enrolled === true,
    passkeyRequired: payload.passkey_required === true,
    passkeyEnrolled: payload.passkey_enrolled === true,
    source,
  };
}

export function hasPlatformPermission(access: PlatformAccess, permission: string) {
  return hasPlatformPermissionForNavigation(access, permission);
}

export async function hasConfirmedTotp(
  userId: string,
  service: ReturnType<typeof createServiceClient>
) {
  const totp = await service
    .from('user_totp_settings')
    .select('id')
    .eq('user_id', userId)
    .eq('is_enabled', true)
    .not('confirmed_at', 'is', null)
    .limit(1)
    .maybeSingle();
  return !totp.error && Boolean(totp.data);
}

export async function hasActivePasskey(
  userId: string,
  service: ReturnType<typeof createServiceClient>
) {
  const passkey = await service
    .from('webauthn_credentials')
    .select('id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  return !passkey.error && Boolean(passkey.data);
}

/**
 * Resolves Control Plane access through a service-only RPC. The legacy
 * is_super_admin flag remains only as a bootstrap/recovery path while
 * platform_staff is rolled out; tenant and workspace roles are never read.
 */
export async function resolvePlatformAccess(
  user: User,
  service = createServiceClient()
): Promise<PlatformAccess | null> {
  const resolved = await service.rpc('get_platform_staff_access', { p_user_id: user.id });
  if (!resolved.error) return parseAccessPayload(resolved.data);

  const bootstrap = await service.rpc('is_internal_super_admin', { p_user_id: user.id });
  if (bootstrap.error || bootstrap.data !== true) return null;

  return {
    active: true,
    role: 'DOCUBOX_SUPER_ADMIN',
    permissions: ['*'],
    requiresStepUp: true,
    totpEnrolled: await hasConfirmedTotp(user.id, service),
    passkeyRequired: true,
    passkeyEnrolled: await hasActivePasskey(user.id, service),
    source: 'auth.users.is_super_admin',
  };
}

export const getCurrentPlatformAccess = cache(async () => {
  const user = await getServerCookieUser();
  if (!user) return { user: null, access: null };
  return { user, access: await resolvePlatformAccess(user) };
});
