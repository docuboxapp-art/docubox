import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

export const PLATFORM_PASSKEY_COOKIE = 'docubox_platform_passkey';
export const PLATFORM_PASSKEY_MAX_AGE_SECONDS = 5 * 60;

type PlatformPasskeyPayload = {
  version: 1;
  userId: string;
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

function sign(encodedPayload: string) {
  return createHmac('sha256', proofSecret())
    .update(`passkey:${encodedPayload}`)
    .digest('base64url');
}

export function platformPasskeyCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge: PLATFORM_PASSKEY_MAX_AGE_SECONDS,
  };
}

export function createPlatformPasskeyProof(userId: string) {
  const now = Math.floor(Date.now() / 1000);
  const payload: PlatformPasskeyPayload = {
    version: 1,
    userId,
    verifiedAt: now,
    expiresAt: now + PLATFORM_PASSKEY_MAX_AGE_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

export function verifyPlatformPasskeyProof(proof: string | undefined, userId: string) {
  if (!proof) return false;
  try {
    const [encoded, receivedSignature, extra] = proof.split('.');
    if (!encoded || !receivedSignature || extra) return false;
    const received = Buffer.from(receivedSignature, 'base64url');
    const expected = Buffer.from(sign(encoded), 'base64url');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return false;

    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as PlatformPasskeyPayload;
    const now = Math.floor(Date.now() / 1000);
    return (
      payload.version === 1 &&
      payload.userId === userId &&
      payload.verifiedAt <= now &&
      payload.expiresAt > now
    );
  } catch {
    return false;
  }
}
