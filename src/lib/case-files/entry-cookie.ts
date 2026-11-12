import { createHmac, timingSafeEqual } from 'node:crypto';

export function signEntryGrant(secret: string, scope: string, codeHash: string, expires: number) {
  if (secret.length < 32) throw new Error('CASE_INVITATION_CONFIG');
  const signature = createHmac('sha256', secret)
    .update(`case-entry-v1:${scope}.${codeHash}.${expires}`)
    .digest('hex');
  return `${codeHash}.${expires}.${signature}`;
}
export function verifyEntryGrant(secret: string, scope: string, value: string, now = Date.now()) {
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [code, expiry, signature] = parts;
  if (
    secret.length < 32 ||
    !/^[a-f0-9]{64}$/.test(code) ||
    !/^\d{10,16}$/.test(expiry) ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    !Number.isSafeInteger(Number(expiry)) ||
    Number(expiry) <= now
  )
    return null;
  const expected = signEntryGrant(secret, scope, code, Number(expiry)).split('.')[2];
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex')) ? code : null;
}
