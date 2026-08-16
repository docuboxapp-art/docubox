import test from 'node:test';
import assert from 'node:assert/strict';
import { automationRetryStatus, calculateAutomationBackoffSeconds } from './automation-policy.ts';

test('calcula backoff exponencial con limite superior', () => {
  assert.equal(calculateAutomationBackoffSeconds(1, {}), 30);
  assert.equal(calculateAutomationBackoffSeconds(2, {}), 60);
  assert.equal(
    calculateAutomationBackoffSeconds(10, { base_seconds: 3600, backoff: 'exponential' }),
    21600
  );
});

test('respeta backoff fijo', () => {
  assert.equal(calculateAutomationBackoffSeconds(4, { base_seconds: 45, backoff: 'fixed' }), 45);
});

test('envia a dead letter al agotar intentos', () => {
  assert.equal(automationRetryStatus(2, { max_attempts: 3 }), 'retrying');
  assert.equal(automationRetryStatus(3, { max_attempts: 3 }), 'dead_lettered');
});
