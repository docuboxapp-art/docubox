export const BLOCKCHAIN_EVIDENCE_STATUSES = [
  'GENERATED',
  'SUBMITTED',
  'PENDING_BITCOIN',
  'ANCHORED',
  'VERIFIED',
  'SUBMISSION_FAILED',
  'UPGRADE_FAILED',
  'VERIFICATION_FAILED',
  'INVALID_PROOF',
  'STORAGE_ERROR',
] as const;

export type BlockchainEvidenceStatus = (typeof BLOCKCHAIN_EVIDENCE_STATUSES)[number];

export type BlockchainEvidenceManifestV1 = {
  schema: 'docubox.blockchain-evidence';
  version: '1.0';
  document_hash_algorithm: 'SHA-256';
  document_hash: string;
  evidence_hash_algorithm: 'SHA-256';
  evidence_hash: string;
  document_state: 'FINAL';
  evidence_version: 1;
};

export type ProofInspection = {
  proofIntegrity: boolean;
  pending: boolean;
  bitcoinAttestationFound: boolean;
  bitcoinBlockHeight: number | null;
  bitcoinBlockHash: string | null;
  bitcoinAttestedAt: string | null;
  rawSummary: string;
};

export type ProofVerification = ProofInspection & {
  manifestHashMatches: boolean;
  bitcoinVerified: boolean;
};

export interface OpenTimestampProvider {
  readonly providerId: string;
  createProof(input: {
    canonicalManifest: string;
    manifestHash: string;
    calendars: string[];
  }): Promise<{
    proof: Uint8Array;
    calendarsSucceeded: string[];
    calendarsFailed: string[];
  }>;
  upgradeProof(input: {
    proof: Uint8Array;
    calendars: string[];
  }): Promise<{ proof: Uint8Array; changed: boolean }>;
  verifyProof(input: { proof: Uint8Array; manifestHash: string }): Promise<ProofVerification>;
  getProofStatus(proof: Uint8Array): Promise<ProofInspection>;
}
