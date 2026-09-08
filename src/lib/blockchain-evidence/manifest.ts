import { canonicalSha256, sha256Hex } from '@/lib/certification/canonical';
import type { BlockchainEvidenceManifestV1 } from './types';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function assertSha256(value: string, field: string) {
  const normalized = value.trim().toLowerCase();
  if (!SHA256_PATTERN.test(normalized))
    throw new TypeError(`${field} must be a lowercase SHA-256 digest`);
  return normalized;
}

export function createBlockchainEvidenceManifest(input: {
  documentHash: string;
  evidenceHash: string;
}) {
  const manifest: BlockchainEvidenceManifestV1 = {
    schema: 'docubox.blockchain-evidence',
    version: '1.0',
    document_hash_algorithm: 'SHA-256',
    document_hash: assertSha256(input.documentHash, 'documentHash'),
    evidence_hash_algorithm: 'SHA-256',
    evidence_hash: assertSha256(input.evidenceHash, 'evidenceHash'),
    document_state: 'FINAL',
    evidence_version: 1,
  };
  const result = canonicalSha256(manifest);
  return { manifest, canonical: result.canonical, manifestHash: result.sha256 };
}

export function hashBytes(bytes: Uint8Array) {
  return sha256Hex(bytes);
}
