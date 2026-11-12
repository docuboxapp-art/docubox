import assert from 'node:assert/strict';
import test from 'node:test';
import { isDefinitivelyInvalidAuthToken } from '../src/lib/supabase/auth-verification.ts';
import { isTemporaryDatabaseFailure } from '../src/lib/supabase/backend-failure.ts';

test('a rejected JWT is distinguishable from a temporary Auth outage', () => {
  assert.equal(isDefinitivelyInvalidAuthToken({ status: 401, code: 'bad_jwt' }), true);
  assert.equal(isDefinitivelyInvalidAuthToken({ code: 'refresh_token_not_found' }), true);
  for (const failure of [
    { status: 503, code: 'request_timeout' },
    { status: 503, code: 'bad_jwt' },
    { status: 504, name: 'AuthRetryableFetchError' },
    { status: 520, code: 'unexpected_failure' },
    { name: 'AbortError' },
    null,
  ]) {
    assert.equal(isDefinitivelyInvalidAuthToken(failure), false);
  }
});

test('temporary PostgREST and PostgreSQL failures remain distinct from permanent data errors', () => {
  for (const code of ['PGRST002', '57014', '08006', '08P01']) {
    assert.equal(isTemporaryDatabaseFailure({ code }), true);
  }
  for (const status of [502, 503, 504, 520, 522]) {
    assert.equal(isTemporaryDatabaseFailure(null, status), true);
  }
  assert.equal(isTemporaryDatabaseFailure({ code: '23505' }, 409), false);
});
