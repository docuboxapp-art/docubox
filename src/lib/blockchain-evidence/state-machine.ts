import type { BlockchainEvidenceStatus } from './types';

const ALLOWED: Record<BlockchainEvidenceStatus, BlockchainEvidenceStatus[]> = {
  GENERATED: ['SUBMITTED', 'SUBMISSION_FAILED', 'STORAGE_ERROR'],
  SUBMITTED: ['PENDING_BITCOIN', 'ANCHORED', 'INVALID_PROOF', 'STORAGE_ERROR'],
  PENDING_BITCOIN: [
    'PENDING_BITCOIN',
    'ANCHORED',
    'UPGRADE_FAILED',
    'INVALID_PROOF',
    'STORAGE_ERROR',
  ],
  ANCHORED: ['VERIFIED', 'VERIFICATION_FAILED', 'INVALID_PROOF', 'STORAGE_ERROR'],
  VERIFIED: ['VERIFIED'],
  SUBMISSION_FAILED: ['SUBMITTED', 'SUBMISSION_FAILED', 'STORAGE_ERROR'],
  UPGRADE_FAILED: [
    'PENDING_BITCOIN',
    'ANCHORED',
    'UPGRADE_FAILED',
    'INVALID_PROOF',
    'STORAGE_ERROR',
  ],
  VERIFICATION_FAILED: ['ANCHORED', 'VERIFIED', 'VERIFICATION_FAILED', 'INVALID_PROOF'],
  INVALID_PROOF: ['INVALID_PROOF'],
  STORAGE_ERROR: ['GENERATED', 'SUBMITTED', 'PENDING_BITCOIN', 'STORAGE_ERROR'],
};

export function assertBlockchainEvidenceTransition(
  from: BlockchainEvidenceStatus,
  to: BlockchainEvidenceStatus
) {
  if (!ALLOWED[from].includes(to))
    throw new Error(`INVALID_BLOCKCHAIN_EVIDENCE_TRANSITION:${from}:${to}`);
}

export function retryDelayMs(attempt: number) {
  const exponent = Math.min(Math.max(attempt, 0), 8);
  return Math.min(15 * 60_000 * 2 ** exponent, 24 * 60 * 60_000);
}
