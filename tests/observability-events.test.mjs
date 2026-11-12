import assert from 'node:assert/strict';
import test from 'node:test';
import { buildObservedEvent, observedRoute } from '../src/lib/observability/events.ts';

test('normalizes document and API paths without retaining identifiers or query strings', () => {
  assert.equal(
    observedRoute('/visor-documento/private-document-id?token=secret'),
    '/visor-documento/[id]'
  );
  assert.equal(
    observedRoute('/api/documentos/private-document-id/viewer-file'),
    '/api/documentos/[id]/viewer-file'
  );
  assert.equal(observedRoute('/api/unknown/secret?email=person@example.com'), '/api/other');
});

test('only allowlisted metadata enters observability events', () => {
  const event = buildObservedEvent({
    service: 'session_policy',
    outcome: 'unavailable',
    route: '/visor-documento/private-document-id?email=person@example.com',
    status: 503,
    durationMs: 12_345.8,
    claimsMs: -4,
    code: 'secret-person@example.com',
    correlationId: '69fe2afe-28a5-486a-a902-3b9f4bbaf1e3',
    upstreamRequestIds: ['valid-request-id', 'person@example.com'],
    upstreamStatuses: [504, 900],
  });

  assert.equal(event.route, '/visor-documento/[id]');
  assert.equal(event.code, 'UNKNOWN');
  assert.equal(event.duration_ms, 12_346);
  assert.equal(event.claims_ms, 0);
  assert.deepEqual(event.upstream_request_ids, ['valid-request-id']);
  assert.deepEqual(event.upstream_statuses, [504]);
  assert.doesNotMatch(JSON.stringify(event), /person@example|private-document-id|secret/);
});

test('preserves known infrastructure codes while rejecting unknown values', () => {
  const event = buildObservedEvent({
    service: 'auth',
    outcome: 'unavailable',
    route: '/login',
    code: 'AuthRetryableFetchError',
    status: 504,
  });
  assert.equal(event.code, 'AUTH_RETRYABLE_FETCH');
  assert.equal(event.status, 504);
  assert.equal(
    buildObservedEvent({
      service: 'auth',
      outcome: 'unavailable',
      route: '/login',
      code: 'request_timeout',
    }).code,
    'request_timeout'
  );
});
