import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { User } from '@supabase/supabase-js';

export const PLATFORM_MFA_COOKIE = 'docubox_platform_mfa';
export const PLATFORM_MFA_MAX_AGE_SECONDS = 30 * 60;

export function platformMfaCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge: PLATFORM_MFA_MAX_AGE_SECONDS,
  };
}

type PlatformMfaPayload = {
  version: 2;
  userId: string;
  lastSignInAt: string;
  passkeyVerified: boolean;
  verifiedAt: number;
  expiresAt: number;
};

function proofSecret() {
  const secret = process.env.PLATFORM_MFA_PROOF_SECRET || process.env.DOCUBOX_INTERNAL_SIGNING_KEY;
  if (!secret || secret.length < 32) {
    throw new Error('PLATFORM_MFA_PROOF_SECRET must contain at least 32 characters.');
  }
  return secret;
}

function signature(encodedPayload: string) {
  return createHmac('sha256', proofSecret()).update(encodedPayload).digest('base64url');
}

export function createPlatformMfaProof(user: User, options: { passkeyVerified?: boolean } = {}) {
  if (!user.last_sign_in_at) throw new Error('Authenticated session has no sign-in timestamp.');
  const now = Math.floor(Date.now() / 1000);
  const payload: PlatformMfaPayload = {
    version: 2,
    userId: user.id,
    lastSignInAt: user.last_sign_in_at,
    passkeyVerified: options.passkeyVerified === true,
    verifiedAt: now,
    expiresAt: now + PLATFORM_MFA_MAX_AGE_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${signature(encoded)}`;
}

export function verifyPlatformMfaProof(
  proof: string | undefined,
  user: User,
  options: { requirePasskey?: boolean } = {}
) {
  if (!proof || !user.last_sign_in_at) return false;
  try {
    const [encoded, receivedSignature, extra] = proof.split('.');
    if (!encoded || !receivedSignature || extra) return false;
    const expectedSignature = signature(encoded);
    const received = Buffer.from(receivedSignature, 'base64url');
    const expected = Buffer.from(expectedSignature, 'base64url');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return false;

    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as PlatformMfaPayload;
    const now = Math.floor(Date.now() / 1000);
    return (
      payload.version === 2 &&
      payload.userId === user.id &&
      payload.lastSignInAt === user.last_sign_in_at &&
      (!options.requirePasskey || payload.passkeyVerified) &&
      payload.verifiedAt <= now &&
      payload.expiresAt > now
    );
  } catch {
    return false;
  }
}
