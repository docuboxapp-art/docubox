import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['src/lib/evidence-v2/finalization-status.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { evidenceUiState, evidenceResumeDelay } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

test('failed and deferred finalizations are distinct from an in-progress package', () => {
  assert.equal(evidenceUiState('FINALIZATION_ERROR', null), 'error');
  assert.equal(evidenceUiState('FINALIZATION_RETRY_SCHEDULED', null), 'retry_scheduled');
  assert.equal(evidenceUiState('EVIDENCE_READY', null), 'error');
  assert.equal(evidenceUiState('FINALIZATION_RETRY_SCHEDULED', 'valid'), 'verified');
});

test('only due, retryable jobs are scheduled for resumption', () => {
  const now = Date.parse('2026-10-15T02:00:00.000Z');
  assert.equal(
    evidenceResumeDelay(
      { state: 'FINALIZATION_RETRY_SCHEDULED', attemptCount: 2, nextAttemptAt: '2026-10-15T02:01:00.000Z' },
      now
    ),
    60_500
  );
  assert.equal(
    evidenceResumeDelay(
      { state: 'FINALIZATION_PENDING', attemptCount: 0, nextAttemptAt: '2026-10-15T01:59:00.000Z' },
      now
    ),
    0
  );
  assert.equal(
    evidenceResumeDelay(
      { state: 'FINALIZATION_ERROR', attemptCount: 8, nextAttemptAt: '2026-10-15T01:59:00.000Z' },
      now
    ),
    null
  );
});
