import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { canonicalSha256, sha256Hex } from '../src/lib/certification/canonical.ts';
import {
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
