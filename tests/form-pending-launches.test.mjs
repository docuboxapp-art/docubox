import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
await build({
  entryPoints: ['src/lib/forms/pending-launches.ts'],
  outfile: 'node_modules/.cache/form-pending-launches-test.cjs',
  bundle: true, platform: 'node', format: 'cjs',
});
const { summarizeFormLaunches } = require('../node_modules/.cache/form-pending-launches-test.cjs');

const formId = 'form-1';
const now = Date.parse('2026-10-13T12:00:00Z');
const token = (id, email, created_at, extras = {}) => ({
  id, template_id: formId, access_mode: 'private', recipient_name: null,
  recipient_email: email, created_at, expires_at: null, used_at: null, ...extras,
});
const invite = (email, invited_at) => ({
  form_id: formId, recipient_name: null, recipient_email: email, invited_at,
});
const response = (id, email, submitted_at) => ({
  template_id: formId, token_id: id, respondent_email: email, submitted_at,
});

test('a newer invitation stays pending even when that person answered an older one', () => {
  const summary = summarizeFormLaunches(
    [token('old', 'one@example.com', '2026-10-08T10:00:00Z', { used_at: '2026-10-09T10:00:00Z' })],
    [invite('one@example.com', '2026-10-12T10:00:00Z'), invite('two@example.com', '2026-10-12T11:00:00Z')],
    [response('old', 'one@example.com', '2026-10-09T10:00:00Z')],
    new Set(), now,
  );
  assert.equal(summary.pendingPublicInvitees.length, 2);
  assert.equal(summary.launchedCount, 3);
});

test('opening a code invitation replaces its pending invite with the public token', () => {
  const summary = summarizeFormLaunches(
    [token('public', 'one@example.com', '2026-10-12T11:00:00Z', { access_mode: 'public' })],
    [invite('one@example.com', '2026-10-12T10:00:00Z')], [], new Set(), now,
  );
  assert.equal(summary.pendingPublicInvitees.length, 0);
  assert.equal(summary.tokenLaunches.length, 1);
  assert.equal(summary.launchedCount, 1);
});

test('a response after invitation removes it from pending', () => {
  const summary = summarizeFormLaunches(
    [], [invite('one@example.com', '2026-10-12T10:00:00Z')],
    [response('public', 'one@example.com', '2026-10-12T11:00:00Z')], new Set(), now,
  );
  assert.equal(summary.pendingPublicInvitees.length, 0);
});

test('scheduled, answered, and expired links do not count as pending', () => {
  const summary = summarizeFormLaunches([
    token('scheduled', 'one@example.com', '2026-10-12T10:00:00Z'),
    token('answered', 'two@example.com', '2026-10-12T10:00:00Z'),
    token('expired', 'three@example.com', '2026-10-12T10:00:00Z', { expires_at: '2026-10-13T11:00:00Z' }),
  ], [], [response('answered', 'two@example.com', '2026-10-12T11:00:00Z')], new Set(['scheduled']), now);
  assert.equal(summary.tokenLaunches.length, 0);
});
