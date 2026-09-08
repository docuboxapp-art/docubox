import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const gateway = await read('../src/lib/public-verification/gateway.ts');
const legacyVerification = await read('../src/app/api/verify/[verificationUuid]/route.ts');
const documentVerification = await read(
  '../src/app/api/verificacion/documentos/[identifier]/route.ts'
);
const emailService = await read('../src/lib/emailNotifications.ts');
const sendDocument = await read('../src/app/api/documentos/enviar/route.ts');
const advanceParticipation = await read('../src/app/api/documentos/advance-participation/route.ts');
const migration = await read(
  '../supabase/migrations/20260908195414_fase5_distributed_concurrency.sql'
);
const housekeepingMigration = await read(
  '../supabase/migrations/20260908200813_fase5_rate_limit_housekeeping.sql'
);
const verificationInvokerMigration = await read(
  '../supabase/migrations/20260908202127_fase5_verification_bundle_invoker.sql'
);

test('public verification limits are distributed and fail closed', () => {
  assert.match(gateway, /rpc\('consume_server_rate_limit'/);
  assert.match(gateway, /p_window_seconds: 60/);
  assert.match(gateway, /throw new PublicRateLimitUnavailableError/);
  assert.doesNotMatch(gateway, /new Map/);
  assert.doesNotMatch(legacyVerification, /new Map/);
  assert.match(legacyVerification, /await enforcePublicRateLimit/);
  assert.match(documentVerification, /await enforcePublicRateLimit/);
  assert.match(housekeepingMigration, /idx_ai_rate_limit_buckets_expires_at/);
  assert.match(housekeepingMigration, /FOR UPDATE SKIP LOCKED/);
  assert.match(housekeepingMigration, /LIMIT 256/);
});

test('completed-document verification uses one database bundle request', () => {
  assert.match(documentVerification, /rpc\('get_public_document_verification_bundle'/);
  assert.doesNotMatch(documentVerification, /\.from\('profiles'\)/);
  assert.doesNotMatch(documentVerification, /\.from\('signature_evidence'\)/);
  assert.match(migration, /RETURNS JSONB/);
  assert.match(migration, /document\.estado = 'completado'/);
  assert.match(migration, /evidence\.is_voided = FALSE/);
  assert.match(migration, /FROM public\.user_profiles profile/);
  assert.doesNotMatch(migration, /FROM public\.profiles profile/);
});

test('server coordination functions remain service-only', () => {
  assert.match(migration, /consume_server_rate_limit[\s\S]*TO service_role/);
  assert.match(migration, /get_public_document_verification_bundle[\s\S]*TO service_role/);
  assert.match(migration, /claim_crypto_lifecycle_e2e_run[\s\S]*TO service_role/);
  assert.match(migration, /finish_crypto_lifecycle_e2e_run[\s\S]*TO service_role/);
  assert.match(migration, /SET search_path = ''/);
  assert.doesNotMatch(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.(?:consume_server_rate_limit|get_public_document_verification_bundle|claim_crypto_lifecycle_e2e_run|finish_crypto_lifecycle_e2e_run)[\s\S]{0,180}TO (?:anon|authenticated)/
  );
  assert.match(verificationInvokerMigration, /SECURITY INVOKER/);
  assert.match(
    verificationInvokerMigration,
    /get_public_document_verification_bundle[\s\S]*TO service_role/
  );
});

test('participant invitation delivery carries a stable provider idempotency key', () => {
  assert.match(emailService, /documentId: string/);
  assert.match(emailService, /recipientHash = createHash\('sha256'\)/);
  assert.match(
    emailService,
    /idempotencyKey: `\$\{emailType\}\/\$\{documentId\}\/\$\{recipientHash\}`/
  );
  assert.match(sendDocument, /documentId: dbDocumentId/);
  assert.match(advanceParticipation, /documentId: documentoId/);
});

test('new private documents use the authenticated viewer instead of long-lived storage URLs', () => {
  assert.doesNotMatch(sendDocument, /createSignedUrl\([^)]*,\s*60 \* 60 \* 24 \* 365/);
  assert.doesNotMatch(sendDocument, /\/\/ 1 year/);
  assert.match(
    sendDocument,
    /uploadedFileUrl = `\/api\/documentos\/\$\{dbDocumentId\}\/viewer-file`/
  );
});
