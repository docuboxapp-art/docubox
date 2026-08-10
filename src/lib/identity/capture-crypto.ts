import 'server-only';
import crypto from 'node:crypto';

type EncryptedEnvelope = {
  version: 'AES-256-GCM-V1';
  iv: string;
  tag: string;
  ciphertext: string;
};

export function captureEncryptionKey() {
  const raw = process.env.ENROLLMENT_ENCRYPTION_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(raw)) return null;
  return Buffer.from(raw, 'hex');
}

export function encryptCapture(value: string, key: Buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const envelope: EncryptedEnvelope = {
    version: 'AES-256-GCM-V1',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
  return JSON.stringify(envelope);
}

export function decryptCapture(value: string, key: Buffer) {
  const envelope = JSON.parse(value) as EncryptedEnvelope;
  if (envelope.version !== 'AES-256-GCM-V1') throw new Error('Unsupported capture encryption version.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function normalizeImageBase64(value: unknown) {
  return String(value || '').replace(/^data:image\/[-+\w.]+;base64,/, '').replace(/\s/g, '');
}

export function validImageBase64(value: string) {
  return value.length >= 256 && value.length <= 16_000_000 && /^[A-Za-z0-9+/=]+$/.test(value);
}
