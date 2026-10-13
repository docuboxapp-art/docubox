import assert from 'node:assert/strict';
import test from 'node:test';
import { formAccessDenial, publicFormCapabilityDenial } from '../supabase/functions/_shared/form-access-policy.ts';

const selected = { id: 'invited-user', email: 'ana@example.com' };
const other = { id: 'other-user', email: 'otra@example.com' };
const privateLink = {
  access_mode: 'private', recipient_email: ' ANA@example.com ',
  recipient_user_id: null, liveness_verified_at: null,
};
const publicLink = {
  access_mode: 'public', recipient_email: 'ana@example.com',
  recipient_user_id: selected.id, liveness_verified_at: '2026-10-10T12:00:00Z',
};

test('a private invitation only opens for the selected recipient account', () => {
  assert.equal(formAccessDenial(privateLink, selected), null);
  assert.equal(formAccessDenial(privateLink, other), 'FORBIDDEN');
  assert.equal(formAccessDenial({ ...privateLink, recipient_user_id: 'another-id' }, selected), 'FORBIDDEN');
});

test('a code-issued public link stays bound to the verified user and liveness result', () => {
  assert.equal(formAccessDenial(publicLink, selected), null);
  assert.equal(formAccessDenial(publicLink, other), 'FORBIDDEN');
  assert.equal(formAccessDenial({ ...publicLink, recipient_user_id: null }, selected), 'FORBIDDEN');
  assert.equal(formAccessDenial({ ...publicLink, liveness_verified_at: null }, selected), 'LIVENESS_REQUIRED');
});

test('an absent or unrecognized access mode cannot open a form', () => {
  assert.equal(formAccessDenial({ ...privateLink, access_mode: null }, selected), 'FORBIDDEN');
  assert.equal(formAccessDenial({ ...privateLink, access_mode: 'other' }, selected), 'FORBIDDEN');
});

test('a public form capability opens without a login only after recent liveness', () => {
  const recent = { ...publicLink, liveness_verified_at: new Date().toISOString() };
  assert.equal(publicFormCapabilityDenial(recent), null);
  assert.equal(publicFormCapabilityDenial({ ...recent, recipient_email: null }), 'FORBIDDEN');
  assert.equal(publicFormCapabilityDenial({ ...recent, recipient_user_id: null }), 'FORBIDDEN');
  assert.equal(publicFormCapabilityDenial({ ...recent, access_mode: 'private' }), 'FORBIDDEN');
  assert.equal(publicFormCapabilityDenial({ ...recent, liveness_verified_at: '2026-01-01T00:00:00Z' }), 'LIVENESS_REQUIRED');
  assert.equal(publicFormCapabilityDenial({ ...recent, liveness_verified_at: null }), 'LIVENESS_REQUIRED');
});
