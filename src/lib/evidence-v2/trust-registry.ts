import 'server-only';

import { constants, createPublicKey, verify } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sha256Hex } from '@/lib/certification/canonical';
import { evidenceV2SigningPayload } from './canonical';
import type { EvidenceV2Package } from './types';

export async function registerEvidenceSigningKey(
  service: SupabaseClient,
  signature: NonNullable<EvidenceV2Package['docuboxSignature']>
) {
  if (!signature.publicKeyPem)
    throw new TypeError('KMS public key is required for trust registration');
  const fingerprint = sha256Hex(
    createPublicKey(signature.publicKeyPem).export({ type: 'spki', format: 'der' })
  );
  if (fingerprint !== signature.publicKeyFingerprintSha256)
    throw new TypeError('KMS public key fingerprint mismatch');
  const result = await service.from('evidence_signing_keys').upsert(
    {
      key_id: signature.keyId,
      key_version: signature.keyVersion,
      purpose: 'EVIDENCE_SEAL',
      algorithm: signature.algorithm,
      public_key_pem: signature.publicKeyPem,
      public_key_fingerprint_sha256: fingerprint,
      valid_from: signature.signedAt,
      status: 'active',
    },
    { onConflict: 'key_id,key_version,purpose', ignoreDuplicates: true }
  );
  if (result.error) throw result.error;
}

export async function verifyEvidenceSealAgainstRegistry(
  service: SupabaseClient,
  value: EvidenceV2Package
) {
  const signature = value.docuboxSignature;
  if (!signature) return false;
  const result = await service
    .from('evidence_signing_keys')
    .select(
      'algorithm,public_key_pem,public_key_fingerprint_sha256,valid_from,valid_to,status,revoked_at'
    )
    .eq('key_id', signature.keyId)
    .eq('key_version', signature.keyVersion)
    .eq('purpose', 'EVIDENCE_SEAL')
    .maybeSingle();
  if (result.error || !result.data || result.data.status === 'revoked' || result.data.revoked_at)
    return false;
  const signedAt = new Date(signature.signedAt).getTime();
  if (signedAt < new Date(result.data.valid_from).getTime()) return false;
  if (result.data.valid_to && signedAt > new Date(result.data.valid_to).getTime()) return false;
  if (result.data.public_key_fingerprint_sha256 !== signature.publicKeyFingerprintSha256)
    return false;
  const payload = evidenceV2SigningPayload(value);
  const options =
    signature.algorithm === 'RSA-PSS-SHA256'
      ? {
          key: result.data.public_key_pem,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: 32,
        }
      : { key: result.data.public_key_pem, padding: constants.RSA_PKCS1_PADDING };
  return verify(
    'sha256',
    Buffer.from(payload.canonical),
    options,
    Buffer.from(signature.signatureBase64, 'base64')
  );
}
