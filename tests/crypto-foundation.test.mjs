import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { canonicalSha256, sha256Hex } from '../src/lib/certification/canonical.ts';
import {
  DEVELOPMENT_PROVIDER_CAPABILITIES,
  EVIDENCE_SCHEMA_VERSION,
  FOUNDATION_CAPABILITIES,
} from '../src/lib/certification/capabilities.ts';

const migrationPath = new URL(
  '../supabase/migrations/20260817192825_crypto_foundation_truthful_certification.sql',
  import.meta.url,
);
const sealPdfPath = new URL('../supabase/functions/seal-pdf/index.ts', import.meta.url);
const certificationRoutePath = new URL(
  '../src/app/api/documents/[documentId]/certifications/route.ts',
  import.meta.url,
);
const enginePath = new URL('../src/lib/certification/engine.ts', import.meta.url);
const foundationPath = new URL('../src/lib/certification/foundation.ts', import.meta.url);
const capabilityMigrationPath = new URL(
  '../supabase/migrations/20260821100000_wp_crypto_01_capability_statuses.sql',
  import.meta.url,
);
const legacyProviderPath = new URL(
  '../supabase/functions/_shared/legacy-local-pem-signing-provider.ts',
  import.meta.url,
);
const legacySigningRoutePath = new URL('../supabase/functions/sign-pdf-vps/index.ts', import.meta.url);
const legacyPanelPath = new URL('../src/components/signing/VPSSignaturePanel.tsx', import.meta.url);
const acrobatBadgePath = new URL('../src/components/signing/AcrobatSignatureBadge.tsx', import.meta.url);
const participantCertificatePath = new URL(
  '../src/app/firmar-documento/[id]/page.tsx',
  import.meta.url,
);
const emailFunctionPath = new URL(
  '../supabase/functions/send-email-notifications/index.ts',
  import.meta.url,
);

test('SHA-256 is stable for the same exact Storage bytes', () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
  assert.equal(sha256Hex(bytes), sha256Hex(bytes.slice()));
});

test('changing one byte changes the source SHA-256', () => {
  const original = new Uint8Array([1, 2, 3, 4]);
  const changed = new Uint8Array([1, 2, 3, 5]);
  assert.notEqual(sha256Hex(original), sha256Hex(changed));
});

test('canonical evidence hash does not depend on object key order', () => {
  const left = canonicalSha256({ document: 'doc', version: 2, events: ['a', 'b'] });
  const right = canonicalSha256({ events: ['a', 'b'], version: 2, document: 'doc' });
  assert.equal(left.canonical, right.canonical);
  assert.equal(left.sha256, right.sha256);
});

test('foundation state never reports unavailable providers as valid', () => {
  assert.equal(EVIDENCE_SCHEMA_VERSION, 'docubox-evidence-v1');
  assert.deepEqual(FOUNDATION_CAPABILITIES, {
    integrityStatus: 'valid',
    pdfSignatureStatus: 'not_configured',
    certificateStatus: 'not_configured',
    timestampStatus: 'not_configured',
    verificationStatus: 'pending',
    nom151Status: 'not_configured',
  });
  assert.deepEqual(DEVELOPMENT_PROVIDER_CAPABILITIES, {
    integrityStatus: 'valid',
    pdfSignatureStatus: 'manual_review',
    certificateStatus: 'manual_review',
    timestampStatus: 'not_configured',
    verificationStatus: 'manual_review',
    nom151Status: 'not_configured',
  });
});

test('migration binds a certification to an exact immutable version', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /document_version_id UUID/);
  assert.match(sql, /REFERENCES public\.document_versions\(id\)/);
  assert.match(sql, /prevent_frozen_document_version_delete/);
  assert.match(sql, /prevent_certification_source_mutation/);
  assert.match(sql, /uq_certification_version_idempotency/);
  assert.match(sql, /source_document_hash_algorithm = 'SHA-256'/);
});

test('seal-pdf is a visual renderer and makes no positive PAdES, TSA or CA claim', async () => {
  const source = await readFile(sealPdfPath, 'utf8');
  assert.doesNotMatch(source, /CERTIFICADO DE FIRMA DIGITAL/);
  assert.doesNotMatch(source, /DigiCert RFC 3161/);
  assert.doesNotMatch(source, /PAdES — Fase 1/);
  assert.doesNotMatch(source, /Docubox CA/);
  assert.match(source, /Firma PDF criptográfica', 'No aplicada'/);
  assert.match(source, /X-Certificate': 'not-configured'/);
});

test('certification endpoint stays authenticated and uses exact-version idempotency', async () => {
  const [route, engine] = await Promise.all([
    readFile(certificationRoutePath, 'utf8'),
    readFile(enginePath, 'utf8'),
  ]);
  assert.match(route, /requireApiUser\(request\)/);
  assert.match(engine, /\.eq\('document_version_id', source\.versionId\)/);
  assert.match(engine, /\.eq\('idempotency_key', idempotencyKey\)/);
  assert.match(engine, /verifyFrozenCertificationSource\(supabase, source\)/);
});

test('foundation guards a requested version against a foreign tenant or document', async () => {
  const source = await readFile(foundationPath, 'utf8');
  assert.match(source, /function assertVersionScope/);
  assert.match(source, /version\.document_id !== documentId \|\| version\.workspace_id !== workspaceId/);
  assert.match(source, /DOCUMENT_VERSION_SCOPE_MISMATCH/);
  assert.match(source, /assertVersionScope\(version, document\.id, document\.workspace_id\)/);
});

test('foundation fails closed when Storage cannot provide source or immutable bytes', async () => {
  const source = await readFile(foundationPath, 'utf8');
  assert.match(source, /DOCUMENT_BYTES_UNAVAILABLE/);
  assert.match(source, /DOCUMENT_VERSION_BYTES_UNAVAILABLE/);
  assert.match(source, /IMMUTABLE_SOURCE_READ_FAILED/);
  assert.match(source, /assertSourceHash\(downloaded\.bytes, version\.sha256\)/);
});

test('capability migration adds explicit processing, manual review and NOM-151 states', async () => {
  const migration = await readFile(capabilityMigrationPath, 'utf8');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS nom151_status/);
  assert.match(migration, /'processing'/);
  assert.match(migration, /'manual_review'/);
  assert.match(migration, /NOM-151 lifecycle state/);
});

test('legacy PEM signing is explicitly isolated and cannot assert PAdES or TSA', async () => {
  const [provider, route, panel, badge, participantCertificate, email] = await Promise.all([
    readFile(legacyProviderPath, 'utf8'),
    readFile(legacySigningRoutePath, 'utf8'),
    readFile(legacyPanelPath, 'utf8'),
    readFile(acrobatBadgePath, 'utf8'),
    readFile(participantCertificatePath, 'utf8'),
    readFile(emailFunctionPath, 'utf8'),
  ]);

  assert.match(provider, /class LegacyLocalPemSigningProvider/);
  assert.match(provider, /status = 'deprecated'/);
  assert.match(route, /LegacyLocalPemSigningProvider/);
  assert.match(route, /LEGACY_PEM_SIGNATURE_PROCESSED/);
  assert.match(route, /verification_status: "manual_review"/);
  assert.doesNotMatch(route, /certificate:\s*"CN=Docubox CA/);
  assert.doesNotMatch(route, /tsa:\s*"DigiCert RFC 3161/);
  assert.match(panel, /Proveedor de firma legado/);
  assert.match(panel, /No verificado por Docubox/);
  assert.doesNotMatch(panel, /Firma PAdES Aplicada/);
  assert.match(badge, /pendiente de verificación independiente/);
  assert.doesNotMatch(badge, /Firma verificable en Adobe Acrobat/);
  assert.doesNotMatch(participantCertificate, /DigiCert RFC 3161/);
  assert.doesNotMatch(participantCertificate, /Docubox CA/);
  assert.doesNotMatch(participantCertificate, /PAdES - Fase 1/);
  assert.doesNotMatch(email, /Documento PAdES Firmado/);
});

test('PAdES raises capability status only after ByteRange, CMS, certificate and optional RFC 3161 verification', async () => {
  const source = await readFile(enginePath, 'utf8');
  assert.match(source, /DEVELOPMENT_PROVIDER_CAPABILITIES/);
  assert.match(source, /profile: signedPdf\.profile/);
  assert.match(source, /providers\.pdfSignature\.verifyPdf/);
  assert.match(source, /requestedPadesProfile = timestampHealth\.ready \? 'PAdES-B-T' : 'PAdES-B-B'/);
  assert.match(source, /PADES_TIMESTAMP_VERIFICATION_FAILED/);
  assert.match(source, /pdf_signature_status: \(signedPdf\.profile === 'PAdES-B-T' \? PADES_BT_CAPABILITIES : PADES_BB_CAPABILITIES\)\.pdfSignatureStatus/);
  assert.match(source, /timestamp_status: \(signedPdf\.profile === 'PAdES-B-T' \? PADES_BT_CAPABILITIES : PADES_BB_CAPABILITIES\)\.timestampStatus/);
  assert.match(source, /timestamp_token_sha256: null/);
  assert.match(source, /profile: signedPdf\.profile/);
});
