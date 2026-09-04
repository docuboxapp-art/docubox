import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const route = read('src/app/api/admin/approvals/route.ts');
const authorization = read('src/lib/platform-admin/authorization.ts');
const migration = read(
  'supabase/migrations/20260901013553_core_superadmin_permissions_and_actions.sql'
);

test('approval requests require same-origin and the combined current step-up proof', () => {
  assert.match(route, /new URL\(origin\)\.origin !== new URL\(request\.url\)\.origin/);
  assert.match(route, /sec-fetch-site/);
  assert.match(route, /verifyPlatformMfaProof/);
  assert.match(route, /requirePasskey: access\.passkeyRequired/);
  assert.match(route, /ADMIN_STEP_UP_REQUIRED/);
});

test('approval actions are allow-listed and authorized centrally', () => {
  assert.match(route, /const ACTIONS =/);
  assert.match(route, /authorizePlatformAction/);
  assert.match(route, /approvalRequest: true/);
  assert.doesNotMatch(route, /body\?\.permission|body\.permission/);
  assert.match(authorization, /context\.approvalRequest !== true/);
});

test('approval persistence and audit are atomic and service-only', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.request_platform_admin_approval/);
  assert.match(migration, /INSERT INTO public\.platform_admin_approvals/);
  assert.match(migration, /INSERT INTO public\.platform_audit_events/);
  assert.match(migration, /payload_digest_sha256/);
  assert.match(migration, /'APPROVAL_REQUESTED'/);
  assert.match(migration, /idx_platform_approval_request_idempotency/);
  assert.match(migration, /PLATFORM_APPROVAL_RATE_LIMITED/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.request_platform_admin_approval[\s\S]*FROM PUBLIC, anon, authenticated/
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.request_platform_admin_approval[\s\S]*TO service_role/
  );
});

test('approval API returns only identifiers and sanitized errors', () => {
  assert.match(route, /payloadDigest/);
  assert.match(route, /approvalId: result\.data/);
  assert.match(route, /correlationId/);
  assert.match(route, /x-idempotency-key/);
  assert.match(route, /ADMIN_RATE_LIMITED/);
  assert.doesNotMatch(route, /service_role|access_token|private_key|authorization:/i);
});
