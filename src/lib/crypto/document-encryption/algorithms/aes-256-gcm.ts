import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  DOCUMENT_AUTH_TAG_BYTES,
  DOCUMENT_DEK_BYTES,
  DOCUMENT_NONCE_BYTES,
} from '../encryption-metadata';
import { DocumentEncryptionError } from '../errors';

export type AesGcmEncryptedPayload = {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
};

function assertLength(value: Uint8Array, expected: number, label: string) {
  if (value.byteLength !== expected) {
    throw new DocumentEncryptionError(
      'DOCUMENT_ENCRYPTION_FAILED',
      `${label} no cumple la longitud criptografica requerida.`,
      500
    );
  }
}

export function generateDocumentDek() {
  return randomBytes(DOCUMENT_DEK_BYTES);
}

export function encryptAes256Gcm(
  plaintext: Uint8Array,
  dek: Uint8Array,
  aad: Uint8Array,
  nonce = randomBytes(DOCUMENT_NONCE_BYTES)
): AesGcmEncryptedPayload {
  assertLength(dek, DOCUMENT_DEK_BYTES, 'DEK');
  assertLength(nonce, DOCUMENT_NONCE_BYTES, 'Nonce');
  try {
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(dek), Buffer.from(nonce), {
      authTagLength: DOCUMENT_AUTH_TAG_BYTES,
    });
    cipher.setAAD(Buffer.from(aad), { plaintextLength: plaintext.byteLength });
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
    return { ciphertext, nonce: Buffer.from(nonce), authTag: cipher.getAuthTag() };
  } catch (error) {
    throw new DocumentEncryptionError(
      'DOCUMENT_ENCRYPTION_FAILED',
      'No fue posible cifrar el documento.',
      500,
      { cause: error }
    );
  }
}

export function decryptAes256Gcm(input: {
  ciphertext: Uint8Array;
  dek: Uint8Array;
  aad: Uint8Array;
  nonce: Uint8Array;
  authTag: Uint8Array;
}) {
  assertLength(input.dek, DOCUMENT_DEK_BYTES, 'DEK');
  assertLength(input.nonce, DOCUMENT_NONCE_BYTES, 'Nonce');
  assertLength(input.authTag, DOCUMENT_AUTH_TAG_BYTES, 'Auth tag');
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(input.dek),
      Buffer.from(input.nonce),
      { authTagLength: DOCUMENT_AUTH_TAG_BYTES }
    );
    decipher.setAAD(Buffer.from(input.aad), { plaintextLength: input.ciphertext.byteLength });
    decipher.setAuthTag(Buffer.from(input.authTag));
    return Buffer.concat([decipher.update(Buffer.from(input.ciphertext)), decipher.final()]);
  } catch (error) {
    throw new DocumentEncryptionError(
      'DOCUMENT_DECRYPTION_AUTH_FAILURE',
      'La autenticacion criptografica del documento fallo.',
      409,
      { cause: error }
    );
  }
}
