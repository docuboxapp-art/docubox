'use client';

import forge from 'node-forge';

const KDF_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface EncryptedEfirmaKeyMaterial {
  certificate_der_base64: string;
  certificate_fingerprint_sha256: string;
  encrypted_key_ciphertext: string;
  encrypted_key_iv: string;
  encrypted_key_salt: string;
  wrap_algorithm: 'AES-256-GCM';
  kdf_algorithm: 'PBKDF2-SHA256';
  kdf_iterations: number;
  format_version: 1;
}

export interface StoredEfirmaKey extends EncryptedEfirmaKeyMaterial {
  user_id?: string;
  certificate_serial?: string | null;
  certificate_rfc?: string | null;
  certificate_subject?: string | null;
  certificate_not_after?: string | null;
  consented_at?: string;
  last_used_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const normalized = value.replace(/^data:[^,]+,/, '').replace(/\s/g, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToForgeBuffer(bytes: Uint8Array) {
  return forge.util.decode64(bytesToBase64(bytes));
}

async function deriveWrappingKey(password: string, salt: Uint8Array, iterations: number) {
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt.buffer as ArrayBuffer,
      iterations,
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function readPrivateKey(keyBytes: Uint8Array, password: string) {
  const text = new TextDecoder().decode(keyBytes);
  if (text.includes('-----BEGIN')) {
    const privateKey = forge.pki.decryptRsaPrivateKey(text, password);
    if (!privateKey) throw new Error('EFIRMA_PASSWORD_INVALID');
    return privateKey;
  }

  try {
    const encryptedAsn1 = forge.asn1.fromDer(bytesToForgeBuffer(keyBytes), false);
    const privateKeyInfo = forge.pki.decryptPrivateKeyInfo(encryptedAsn1, password);
    if (!privateKeyInfo) throw new Error('EFIRMA_PASSWORD_INVALID');
    return forge.pki.privateKeyFromAsn1(privateKeyInfo);
  } catch (error) {
    if (error instanceof Error && error.message === 'EFIRMA_PASSWORD_INVALID') throw error;
    throw new Error('EFIRMA_KEY_UNSUPPORTED');
  }
}

function readCertificate(certificateDerBase64: string) {
  try {
    const certificateAsn1 = forge.asn1.fromDer(
      bytesToForgeBuffer(base64ToBytes(certificateDerBase64)),
      false
    );
    return forge.pki.certificateFromAsn1(certificateAsn1);
  } catch {
    throw new Error('EFIRMA_CERTIFICATE_INVALID');
  }
}

function assertKeyMatchesCertificate(
  privateKey: forge.pki.rsa.PrivateKey,
  certificateDerBase64: string
) {
  const certificate = readCertificate(certificateDerBase64);
  const publicKey = certificate.publicKey as forge.pki.rsa.PublicKey;
  if (!publicKey?.n || !publicKey?.e) throw new Error('EFIRMA_CERTIFICATE_UNSUPPORTED');
  if (privateKey.n.compareTo(publicKey.n) !== 0 || privateKey.e.compareTo(publicKey.e) !== 0) {
    throw new Error('EFIRMA_KEY_CERTIFICATE_MISMATCH');
  }
}

export async function validateEfirmaKeyLocally(
  keyBytes: Uint8Array,
  password: string,
  certificateDerBase64: string
) {
  if (!password) throw new Error('EFIRMA_PASSWORD_REQUIRED');
  const privateKey = readPrivateKey(keyBytes, password);
  assertKeyMatchesCertificate(privateKey, certificateDerBase64);
}

export async function encryptEfirmaKeyForStorage(
  keyBytes: Uint8Array,
  password: string,
  certificateDerBase64: string
): Promise<EncryptedEfirmaKeyMaterial> {
  await validateEfirmaKeyLocally(keyBytes, password, certificateDerBase64);

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const wrappingKey = await deriveWrappingKey(password, salt, KDF_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer, tagLength: 128 },
    wrappingKey,
    new Uint8Array(keyBytes).buffer
  );
  const certificateBytes = base64ToBytes(certificateDerBase64);
  const fingerprint = await crypto.subtle.digest('SHA-256', certificateBytes);

  return {
    certificate_der_base64: bytesToBase64(certificateBytes),
    certificate_fingerprint_sha256: Array.from(new Uint8Array(fingerprint))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(''),
    encrypted_key_ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    encrypted_key_iv: bytesToBase64(iv),
    encrypted_key_salt: bytesToBase64(salt),
    wrap_algorithm: 'AES-256-GCM',
    kdf_algorithm: 'PBKDF2-SHA256',
    kdf_iterations: KDF_ITERATIONS,
    format_version: 1,
  };
}

export async function decryptStoredEfirmaKey(
  material: EncryptedEfirmaKeyMaterial,
  password: string
) {
  if (
    material.wrap_algorithm !== 'AES-256-GCM' ||
    material.kdf_algorithm !== 'PBKDF2-SHA256' ||
    material.format_version !== 1
  ) {
    throw new Error('EFIRMA_VAULT_FORMAT_UNSUPPORTED');
  }

  try {
    const salt = base64ToBytes(material.encrypted_key_salt);
    const iv = base64ToBytes(material.encrypted_key_iv);
    const wrappingKey = await deriveWrappingKey(password, salt, material.kdf_iterations);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer, tagLength: 128 },
      wrappingKey,
      base64ToBytes(material.encrypted_key_ciphertext)
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new Error('EFIRMA_PASSWORD_INVALID');
  }
}

export async function signEfirmaPayloadLocally(
  material: EncryptedEfirmaKeyMaterial,
  password: string,
  payloadBase64: string
) {
  const keyBytes = await decryptStoredEfirmaKey(material, password);
  try {
    const privateKey = readPrivateKey(keyBytes, password);
    assertKeyMatchesCertificate(privateKey, material.certificate_der_base64);
    const payloadBytes = base64ToBytes(payloadBase64);
    const digest = forge.md.sha256.create();
    digest.update(bytesToForgeBuffer(payloadBytes));
    const signature = privateKey.sign(digest);
    return bytesToBase64(Uint8Array.from(signature, (character) => character.charCodeAt(0)));
  } finally {
    keyBytes.fill(0);
  }
}

export async function fileToBytes(file: File) {
  return new Uint8Array(await file.arrayBuffer());
}
