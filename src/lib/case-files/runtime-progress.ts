import type { CaseEligibilityCondition } from './review-policy';

/** Blocking checks govern eligibility; their absence is not completed work. */
export function caseEvidenceProgress(conditions: readonly CaseEligibilityCondition[]): number {
  const work = conditions.filter(
    (condition) =>
      condition.status !== 'not_applicable' &&
      (condition.key === 'approval' ||
        /^(content|review|verification|signature|stage):/.test(condition.key))
  );
  return work.length
    ? Math.round(
        (100 * work.filter((condition) => condition.status === 'satisfied').length) / work.length
      )
    : 0;
}
