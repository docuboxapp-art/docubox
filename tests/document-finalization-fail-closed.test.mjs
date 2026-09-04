import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const sealRoute = await read('../src/app/api/documentos/[documentId]/seal-signatures/route.ts');
const signingPage = await read('../src/app/firmar-documento/[id]/page.tsx');
const viewerPage = await read('../src/app/visor-documento/[id]/page.tsx');
const viewerRoute = await read('../src/app/api/documentos/[documentId]/viewer-file/route.ts');
const storage = await read('../src/lib/crypto/document-encryption/storage.ts');
const notificationService = await read('../src/lib/notifications/document-completion.ts');
const emailService = await read('../src/lib/emailNotifications.ts');
const emailFunction = await read('../supabase/functions/send-email-notifications/index.ts');
const migration = await read(
  '../supabase/migrations/20260901201701_document_completion_email_deliveries.sql'
);

test('KMS or PAdES failure cannot reach TSA, NOM-151 or completion email', () => {
  const pades = sealRoute.indexOf('await integratePadesFinalDocument');
  const finalization = sealRoute.indexOf('await finalizeAfterVerifiedPadesBt', pades);
  assert.ok(pades >= 0 && finalization > pades);
  assert.match(sealRoute, /if \(pades\.profile !== 'PAdES-B-T' \|\| !pades\.timestamp\)/);
  assert.match(sealRoute, /PADES_BT_VERIFICATION_REQUIRED/);
  assert.doesNotMatch(signingPage, /\/api\/nom151\/generate/);
});

test('NOM-151 is issued only after persisted and verified PAdES-B-T', () => {
  assert.match(sealRoute, /FINAL_CERTIFICATION_REQUIRES_PADES_BT/);
  assert.match(sealRoute, /action: 'pades_bt_verified'/);
  const padesVerified = sealRoute.indexOf("action: 'pades_bt_verified'");
  const nomRequested = sealRoute.indexOf("action: 'nom151_requested'");
  const nomIssued = sealRoute.indexOf('await issueNom151ForVerifiedPadesBt');
  const nomVerified = sealRoute.indexOf("action: 'nom151_verified'");
  assert.ok(padesVerified < nomRequested && nomRequested < nomIssued && nomIssued < nomVerified);
});

test('NOM-151 failure cannot declare certification completed', () => {
  const nomIssued = sealRoute.indexOf('await issueNom151ForVerifiedPadesBt');
  const emailQueued = sealRoute.indexOf('await queueVerifiedDocumentCompletionEmails');
  const completed = sealRoute.indexOf("action: 'certification_completed'");
  assert.ok(nomIssued < emailQueued && emailQueued < completed);
  assert.match(notificationService, /DOCUMENT_COMPLETION_NOM151_REQUIRED/);
  assert.match(notificationService, /\.eq\('verification_status', 'verified'\)/);
});

test('service role email code is server-only and absent from client components', () => {
  assert.match(emailService, /^import 'server-only';/);
  assert.doesNotMatch(signingPage, /emailNotifications|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(viewerPage, /emailNotifications|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(notificationService, /^import 'server-only';/);
  assert.match(notificationService, /\.from\('user_profiles'\)/);
  assert.doesNotMatch(notificationService, /\.from\('profiles'\)/);
});

test('DOCUMENT_COMPLETED delivery is durable and idempotent', () => {
  assert.match(migration, /idempotency_key TEXT NOT NULL UNIQUE/);
  assert.match(migration, /'queued', 'processing', 'sent', 'delivered', 'failed', 'bounced'/);
  assert.match(migration, /REVOKE ALL .* anon, authenticated/);
  assert.match(notificationService, /document-completed\/\$\{input\.certificationUuid\}/);
  assert.match(notificationService, /insert\(\{/);
  assert.match(notificationService, /inserted\.error\.code !== '23505'/);
  assert.match(emailFunction, /"Idempotency-Key": idempotencyKey/);
});

test('legacy plaintext remains blocked with a typed 409 instead of a generic 500', () => {
  assert.match(storage, /DOCUMENT_LEGACY_PLAINTEXT_BLOCKED/);
  assert.match(viewerRoute, /error\.code === 'DOCUMENT_LEGACY_PLAINTEXT_BLOCKED'/);
  assert.match(viewerRoute, /status: 409/);
  assert.match(viewerRoute, /DOCUMENT_STORAGE_OBJECT_MISSING/);
  assert.match(viewerRoute, /status: 404/);
  assert.match(viewerRoute, /status: 422/);
});

test('viewer file variants expose a structured pending PAdES state', () => {
  assert.match(viewerRoute, /PADES_CERTIFICATION_IN_PROGRESS/);
  assert.match(viewerRoute, /PADES_CERTIFICATION_REQUIRED/);
  assert.match(viewerRoute, /PADES_CONFIGURATION_ERROR/);
  assert.match(viewerRoute, /DOCUMENT_VARIANT_UNSUPPORTED/);
  assert.match(viewerRoute, /Estamos preparando la versión firmada y certificada/);
});

test('authorized viewer still reads valid encrypted documents through verified decryption', () => {
  assert.match(viewerRoute, /await readDocumentStorageObject\(\{/);
  assert.match(viewerRoute, /expectedPlaintextSha256:/);
  assert.match(viewerRoute, /DOCUMENT_VIEWED/);
  assert.doesNotMatch(viewerRoute, /legacyAllowed:\s*true/);
});

test('final viewer delivery is bound to the persisted and reverified PAdES-B-T artifact', () => {
  assert.match(viewerRoute, /\.eq\('pades_profile', 'PAdES-B-T'\)/);
  assert.match(viewerRoute, /\.eq\('timestamp_status', 'valid'\)/);
  assert.match(viewerRoute, /product_integration\?\.pades_bt\?\.final_pdf_path/);
  assert.match(viewerRoute, /PADES_BT_FINAL_ARTIFACT_MISMATCH/);
  assert.match(viewerRoute, /providers\.pdfSignature\.verifyPdf/);
  assert.match(viewerRoute, /providers\.independentVerification\.verifyPdf/);
  assert.match(viewerRoute, /result\.profile === 'PAdES-B-T'/);
  assert.match(viewerRoute, /result\.timestamp\.messageImprintValid/);
  assert.match(viewerRoute, /PADES_BT_FINAL_ARTIFACT_VERIFICATION_FAILED/);
});

test('final viewer delivery cannot be cached as an older signed artifact', () => {
  assert.match(viewerRoute, /export const dynamic = 'force-dynamic'/);
  assert.match(viewerRoute, /export const revalidate = 0/);
  assert.match(viewerRoute, /'Vercel-CDN-Cache-Control', 'no-store'/);
  assert.match(viewerRoute, /'Surrogate-Control', 'no-store'/);
  assert.match(viewerRoute, /'Vary', 'Authorization, Cookie'/);
  assert.match(viewerRoute, /response\.headers\.set\('ETag', `"sha256-\$\{responseSha256\}"`\)/);
  assert.match(viewerRoute, /_firmado_PAdES-B-T\.pdf/);
  assert.match(viewerPage, /a\.download = `\$\{safeName\}_firmado_PAdES-B-T\.pdf`/);
});
