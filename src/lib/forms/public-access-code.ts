import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const key = () =>
  createHash('sha256')
    .update(process.env.SUPABASE_SERVICE_ROLE_KEY || '')
    .digest();

export function normalizePublicCode(value: unknown) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '');
}

export function createPublicCode() {
  const value = randomBytes(5).readUIntBE(0, 5);
  return Array.from({ length: 8 }, (_, index) =>
    alphabet[Math.floor(value / 32 ** (7 - index)) % 32]
  ).join('');
}

export function isLegacyPublicCode(value: string) {
  return /^DBX[0-9A-F]{18}$/.test(normalizePublicCode(value));
}

export function isValidPublicCode(value: string) {
  const normalized = normalizePublicCode(value);
  return /^[A-HJ-NP-Z2-9]{8}$/.test(normalized) || isLegacyPublicCode(normalized);
}

export function publicCodeLookup(value: string) {
  const normalized = normalizePublicCode(value);
  return isLegacyPublicCode(normalized) ? normalized.slice(3, 15) : normalized;
}

export function hashPublicCode(value: string) {
  return createHash('sha256').update(normalizePublicCode(value)).digest('hex');
}

export function matchesPublicCode(value: string, savedHash: string) {
  if (!/^[a-f0-9]{64}$/i.test(savedHash)) return false;
  return timingSafeEqual(Buffer.from(hashPublicCode(value), 'hex'), Buffer.from(savedHash, 'hex'));
}

export function matchesStoredPublicCode(value: string, access: {
  code_lookup: string;
  code_hash: string;
  legacy_code_lookup?: string | null;
  legacy_code_hash?: string | null;
}) {
  const lookup = publicCodeLookup(value);
  if (lookup === access.code_lookup) return matchesPublicCode(value, access.code_hash);
  return lookup === access.legacy_code_lookup && Boolean(access.legacy_code_hash) &&
    matchesPublicCode(value, access.legacy_code_hash!);
}

export function encryptPublicCode(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url')).join('.');
}

export function decryptPublicCode(value: string) {
  const [iv, tag, body] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
