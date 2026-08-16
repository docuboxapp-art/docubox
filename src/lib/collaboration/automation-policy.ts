import { z } from 'zod';

const errorPolicySchema = z.object({
  max_attempts: z.number().int().min(1).max(10).default(3),
  backoff: z.enum(['fixed', 'exponential']).default('exponential'),
  base_seconds: z.number().int().min(5).max(3600).default(30),
});

export function calculateAutomationBackoffSeconds(attempt: number, policyValue: unknown) {
  const policy = errorPolicySchema.parse(policyValue || {});
  const multiplier = policy.backoff === 'exponential' ? 2 ** Math.max(0, attempt - 1) : 1;
  return Math.min(policy.base_seconds * multiplier, 6 * 60 * 60);
}

export function automationRetryStatus(attempt: number, policyValue: unknown) {
  const policy = errorPolicySchema.parse(policyValue || {});
  return attempt >= policy.max_attempts ? 'dead_lettered' : 'retrying';
}
