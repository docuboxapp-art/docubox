export type EvidenceUiState =
  | 'preparing'
  | 'waiting_certifications'
  | 'generating'
  | 'generated'
  | 'verified'
  | 'retry_scheduled'
  | 'error';

export type EvidenceFinalizationStatus = {
  state: string;
  attemptCount: number;
  nextAttemptAt: string | null;
};

export function evidenceUiState(
  finalizationState: string | null,
  packageOverall: string | null
): EvidenceUiState {
  if (packageOverall !== null) return packageOverall === 'valid' ? 'verified' : 'generated';
  if (
    finalizationState === 'FINALIZATION_ERROR' ||
    finalizationState === 'EVIDENCE_READY' ||
    finalizationState === 'EVIDENCE_READY_WITH_PENDING_SUPPLEMENTS'
  )
    return 'error';
  if (finalizationState === 'FINALIZATION_RETRY_SCHEDULED') return 'retry_scheduled';
  if (
    [
      'WAITING_FOR_PADES',
      'WAITING_FOR_TIMESTAMP',
      'WAITING_FOR_NOM151',
      'WAITING_FOR_OTS_STAMP',
    ].includes(finalizationState || '')
  )
    return 'waiting_certifications';
  if (
    [
      'GENERATING_EVIDENCE',
      'SIGNING_EVIDENCE',
      'STORING_EVIDENCE',
      'READY_FOR_EVIDENCE_XML',
    ].includes(finalizationState || '')
  )
    return 'generating';
  return 'preparing';
}

export function evidenceResumeDelay(
  finalization: EvidenceFinalizationStatus | null | undefined,
  now = Date.now()
): number | null {
  if (
    !finalization ||
    !['FINALIZATION_PENDING', 'FINALIZATION_RETRY_SCHEDULED'].includes(finalization.state) ||
    !Number.isInteger(finalization.attemptCount) ||
    finalization.attemptCount < 0 ||
    !finalization.nextAttemptAt
  )
    return null;
  const due = Date.parse(finalization.nextAttemptAt);
  if (!Number.isFinite(due)) return null;
  return Math.max(0, due - now + 500);
}
