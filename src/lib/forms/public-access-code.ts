import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

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
  return `DBX-${randomBytes(9).toString('hex').toUpperCase()}`;
}

export function publicCodeLookup(value: string) {
  return normalizePublicCode(value).slice(3, 15);
}

export function hashPublicCode(value: string) {
  return createHash('sha256').update(normalizePublicCode(value)).digest('hex');
}

export function matchesPublicCode(value: string, savedHash: string) {
  if (!/^[a-f0-9]{64}$/i.test(savedHash)) return false;
  return timingSafeEqual(Buffer.from(hashPublicCode(value), 'hex'), Buffer.from(savedHash, 'hex'));
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
