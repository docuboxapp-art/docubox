import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const routePath = new URL(
  '../src/app/api/internal/security/crypto-lifecycle-e2e/route.ts',
  import.meta.url
);
const route = await readFile(routePath, 'utf8');
const page = await readFile(
  new URL('../src/app/admin/security/crypto-e2e/page.tsx', import.meta.url),
  'utf8'
);
const access = await readFile(
  new URL('../src/lib/security/crypto-lifecycle-e2e-access.ts', import.meta.url),
  'utf8'
);
const card = await readFile(
  new URL('../src/app/admin/security/crypto-e2e/CryptoLifecycleRunnerCard.tsx', import.meta.url),
  'utf8'
);
const internalAdminMigration = await readFile(
  new URL(
    '../supabase/migrations/20260830201218_crypto_lifecycle_e2e_internal_admin_guard.sql',
    import.meta.url
  ),
  'utf8'
);
const auditChainDigestFix = await readFile(
  new URL(
    '../supabase/migrations/20260830210000_fix_organization_audit_chain_digest_schema.sql',
    import.meta.url
  ),
  'utf8'
);

test('lifecycle runner is disabled by default and POST-only', () => {
  assert.match(route, /lifecycleRunnerEnabled\(\)/);
  assert.match(access, /CRYPTO_LIFECYCLE_E2E_ENABLED/);
  assert.match(route, /export async function GET\(\)/);
  assert.match(route, /status: 404/);
  assert.match(route, /Allow: 'POST'/);
});

test('lifecycle runner requires same-origin authenticated internal-admin access', () => {
  assert.match(route, /passesSameOrigin/);
  assert.match(route, /requireApiUser/);
  assert.match(route, /requireCryptoLifecycleE2EAccess/);
  assert.match(access, /rpc\('is_internal_super_admin'/);
  assert.match(access, /is_super_admin/);
  assert.doesNotMatch(access, /user_metadata/);
  assert.doesNotMatch(access, /CRYPTO_LIFECYCLE_E2E_ALLOWED_USER_IDS/);
  assert.doesNotMatch(access, /CRYPTO_LIFECYCLE_E2E_ALLOW_WORKSPACE_OWNER/);
});

test('lifecycle runner does not accept provider, key, certificate, TSA, or file parameters', () => {
  assert.match(route, /El runner no acepta parámetros/);
  assert.doesNotMatch(route, /request\.json\(\)/);
  assert.doesNotMatch(route, /searchParams\.get\(['"](?:provider|key|certificate|tsa|file)/i);
});

test('lifecycle runner uses existing product integrations and encrypted storage', () => {
  assert.match(route, /integratePadesFinalDocument/);
  assert.match(route, /issueNom151ForVerifiedPadesBt/);
  assert.match(route, /encryptAndUploadDocumentObject/);
  assert.match(route, /readDocumentStorageObject/);
  assert.match(route, /requiredLevel: 'B-T'/);
});

test('lifecycle response and audit are sanitized', () => {
  assert.match(route, /CRYPTO_LIFECYCLE_E2E_STARTED/);
  assert.match(route, /CRYPTO_LIFECYCLE_E2E_COMPLETED/);
  assert.match(route, /CRYPTO_LIFECYCLE_E2E_FAILED/);
  assert.match(route, /error instanceof LifecycleE2eError \|\| error instanceof CertificationError/);
  assert.match(route, /provider_parameters: false/);
  assert.match(route, /audit_source: 'internal-security-runner'/);
  assert.match(route, /outcome: input\.outcome === 'failed' \? 'failed' : 'success'/);
  assert.match(route, /origin: 'system'/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(route, /private.?key|wrapped.?dek|authorization:/i);
});

test('temporary administrative page uses the normal browser session and shared internal-admin guard', () => {
  assert.match(page, /lifecycleRunnerEnabled\(\)/);
  assert.match(page, /getServerCookieUser\(\)/);
  assert.match(page, /requireCryptoLifecycleE2EAccess/);
  assert.match(page, /notFound\(\)/);
  assert.match(card, /credentials: ['"]same-origin['"]/);
  assert.doesNotMatch(card, /Authorization/);
  assert.doesNotMatch(
    card,
    /localStorage|document\.cookie|access_token|wrapped.?dek|private.?key/i
  );
});

test('shared guard denies tenant roles and distinguishes disabled runner from internal access', () => {
  assert.match(access, /CRYPTO_LIFECYCLE_E2E_DISABLED/);
  assert.match(access, /CRYPTO_LIFECYCLE_E2E_INTERNAL_ADMIN_REQUIRED/);
  assert.match(access, /CRYPTO_LIFECYCLE_E2E_WORKSPACE_CONTEXT_REQUIRED/);
  assert.match(access, /\.eq\('status', 'active'\)/);
  assert.doesNotMatch(access, /\.eq\('role', 'owner'\)/);
});

test('internal-admin lookup keeps auth.users private and grants no tenant access', () => {
  assert.match(internalAdminMigration, /FROM auth\.users/);
  assert.match(internalAdminMigration, /SECURITY DEFINER/);
  assert.match(internalAdminMigration, /SET search_path = ''/);
  assert.match(internalAdminMigration, /REVOKE ALL .* FROM PUBLIC/);
  assert.match(internalAdminMigration, /GRANT EXECUTE .* TO service_role/);
  assert.doesNotMatch(internalAdminMigration, /GRANT EXECUTE .* TO authenticated/);
  assert.doesNotMatch(internalAdminMigration, /GRANT EXECUTE .* TO anon/);
});

test('manual administrative trigger is audited separately from the lifecycle result', () => {
  assert.match(route, /CRYPTO_LIFECYCLE_E2E_MANUAL_TRIGGERED/);
  assert.match(route, /source: 'admin-ui'/);
  assert.match(route, /result: 'started'/);
});

test('audit-chain repair resolves pgcrypto from the extensions schema', () => {
  assert.match(auditChainDigestFix, /extensions\.digest\(material, 'sha256'\)/);
  assert.match(auditChainDigestFix, /SET search_path = public/);
});
