import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateWindow } from '../scripts/observability/evaluate-window.mjs';

function windowAt(minute, overrides = {}) {
  const start = Date.UTC(2026, 9, 15, 0, minute);
  return {
    windowStart: new Date(start).toISOString(),
    windowEnd: new Date(start + 15 * 60_000).toISOString(),
    complete: true,
    deployment: 'abcdef1234567890',
    series: [
      {
        key: 'auth_token',
        requests: 30,
        statuses: { 200: 30 },
        p50Ms: 120,
        p95Ms: 400,
        p99Ms: 500,
        latencySamples: 30,
      },
    ],
    postgres: { connectionTimeouts: 0, statementTimeouts: 0 },
    ...overrides,
  };
}

test('sustained Auth failures alert independently from invalid credentials', () => {
  const input = windowAt(0, {
    series: [
      {
        key: 'auth_token',
        requests: 31,
        statuses: { 200: 3, 400: 1, 504: 27 },
        p50Ms: 5_000,
        p95Ms: 5_100,
        p99Ms: 5_200,
        latencySamples: 31,
      },
    ],
    postgres: { connectionTimeouts: 12, statementTimeouts: 0 },
  });
  const result = evaluateWindow(input);
  assert.equal(result.report.metrics[0].clientErrors, 1);
  assert.equal(result.report.metrics[0].serverErrors, 27);
  assert.deepEqual(result.report.notifications.map((item) => item.key).sort(), [
    'auth_token:availability',
    'postgres:connectivity',
  ]);
  assert.ok(result.report.notifications.every((item) => item.severity === 'critical'));
});

test('deduplicates within cooldown and resolves only after two observed healthy windows', () => {
  const failing = windowAt(0, {
    series: [
      { key: 'auth_token', requests: 30, statuses: { 200: 10, 504: 20 }, latencySamples: 0 },
    ],
  });
  const opened = evaluateWindow(failing);
  const repeated = evaluateWindow(windowAt(15, { series: failing.series }), opened.state);
  assert.equal(repeated.report.notifications.length, 0);
  const firstHealthy = evaluateWindow(windowAt(30), repeated.state);
  assert.equal(firstHealthy.report.notifications.length, 0);
  assert.equal(firstHealthy.state.incidents['auth_token:availability'].status, 'open');
  const recovered = evaluateWindow(windowAt(45), firstHealthy.state);
  assert.equal(recovered.report.notifications[0].type, 'resolved');
});

test('missing provider data never closes an open incident', () => {
  const failing = windowAt(0, {
    series: [{ key: 'auth_token', requests: 30, statuses: { 200: 10, 504: 20 } }],
  });
  const opened = evaluateWindow(failing);
  const missing = evaluateWindow(windowAt(15, { complete: false, series: [] }), opened.state);
  const missingAgain = evaluateWindow(windowAt(30, { complete: false, series: [] }), missing.state);
  assert.equal(missingAgain.state.incidents['auth_token:availability'].status, 'open');
  assert.deepEqual(
    missingAgain.report.notifications.map((item) => item.key),
    ['observability:data_gap']
  );
});

test('healthy baseline and minimum sample size gate latency alerts', () => {
  const high = windowAt(0, {
    baseline: { auth_token: { p95Ms: 500 } },
    series: [
      { key: 'auth_token', requests: 25, statuses: { 200: 25 }, p95Ms: 8_500, latencySamples: 25 },
    ],
  });
  assert.equal(evaluateWindow(high).report.notifications[0].key, 'auth_token:latency');
  high.series[0].latencySamples = 5;
  assert.equal(evaluateWindow(high).report.notifications.length, 0);
});

test('network failures and 503, 520, 522 are technical errors without a credentials alert', () => {
  const result = evaluateWindow(
    windowAt(0, {
      series: [
        {
          key: 'auth_token',
          requests: 20,
          statuses: { 200: 9, 400: 1, 503: 3, 520: 3, 522: 3 },
          networkFailures: 1,
        },
      ],
    })
  );
  assert.equal(result.report.metrics[0].technicalFailures, 10);
  assert.equal(result.report.metrics[0].clientErrors, 1);
  assert.equal(result.report.notifications[0].severity, 'critical');
});

test('a single failed health sample does not alert; the next two escalate', () => {
  const healthFailure = { key: 'auth_health', requests: 1, statuses: {}, networkFailures: 1 };
  const first = evaluateWindow(windowAt(0, { series: [healthFailure] }));
  const second = evaluateWindow(windowAt(15, { series: [healthFailure] }), first.state);
  const third = evaluateWindow(windowAt(30, { series: [healthFailure] }), second.state);
  assert.equal(first.report.notifications.length, 0);
  assert.equal(second.report.notifications[0].severity, 'warning');
  assert.equal(third.report.notifications[0].type, 'escalated');
  assert.equal(third.report.notifications[0].severity, 'critical');
});

test('missing or non-adjacent windows break a health-failure streak', () => {
  const healthFailure = { key: 'auth_health', requests: 1, statuses: {}, networkFailures: 1 };
  const first = evaluateWindow(windowAt(0, { series: [healthFailure] }));
  const missing = evaluateWindow(windowAt(15, { complete: false, series: [] }), first.state);
  const afterGap = evaluateWindow(windowAt(30, { series: [healthFailure] }), missing.state);
  assert.equal(afterGap.report.notifications.length, 0);
  const nonAdjacent = evaluateWindow(windowAt(60, { series: [healthFailure] }), afterGap.state);
  assert.equal(nonAdjacent.report.notifications.length, 0);
});

test('missing route coverage does not imply recovery', () => {
  const failing = evaluateWindow(
    windowAt(0, {
      series: [{ key: 'auth_token', requests: 30, statuses: { 200: 10, 504: 20 } }],
    })
  );
  const absent = evaluateWindow(windowAt(15, { series: [] }), failing.state);
  const absentAgain = evaluateWindow(windowAt(30, { series: [] }), absent.state);
  assert.equal(absentAgain.state.incidents['auth_token:availability'].status, 'open');
});

test('compares the next deployment only with a covered previous window', () => {
  const beforeDeployment = evaluateWindow(windowAt(0));
  const afterDeployment = evaluateWindow(
    windowAt(15, {
      deployment: '1234567890abcdef',
      series: [{ key: 'auth_token', requests: 30, statuses: { 200: 10, 504: 20 } }],
    }),
    beforeDeployment.state
  );
  assert.ok(
    afterDeployment.report.findings.some((finding) => finding.key === 'deployment:regression')
  );
});
