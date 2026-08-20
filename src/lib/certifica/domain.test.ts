import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanonicalManifest, CERTIFICATION_SERVICES, stableStringify } from './domain.ts';

test('stableStringify produces the same canonical representation regardless of key order', () => {
  assert.equal(stableStringify({ b: 2, a: { d: 4, c: 3 } }), stableStringify({ a: { c: 3, d: 4 }, b: 2 }));
});

test('sandbox PSC manifest is explicitly marked as a demonstration', () => {
  const manifest = buildCanonicalManifest({
    certificationId: 'cert-1', publicId: 'public-1', folio: 'DBX-CERT-2026-TEST',
    workspaceId: 'workspace-1', title: 'Contrato', serviceKey: 'nom151',
    originalSha256: 'a'.repeat(64), originalFilename: 'contrato.pdf', originalSizeBytes: 100,
    createdAt: '2026-08-16T00:00:00.000Z', issuedAt: '2026-08-16T00:01:00.000Z', providerMode: 'sandbox',
  });
  assert.equal(manifest.legal_validity, false);
  assert.equal(manifest.warning, 'NO VALIDO / DEMOSTRACION');
});

test('integrity product does not require a PSC', () => {
  assert.equal(CERTIFICATION_SERVICES.integrity.requiresPsc, false);
  assert.equal(CERTIFICATION_SERVICES.nom151.requiresPsc, true);
});

test('Docubox integrity remains technically verifiable without claiming PSC legal validity', () => {
  const manifest = buildCanonicalManifest({ certificationId: 'cert-2', publicId: 'public-2', folio: 'DBX-CERT-2026-INT', workspaceId: 'workspace-1', title: 'Anexo', serviceKey: 'integrity', originalSha256: 'c'.repeat(64), originalFilename: 'anexo.pdf', originalSizeBytes: 50, createdAt: '2026-08-16T00:00:00.000Z', issuedAt: '2026-08-16T00:01:00.000Z', providerMode: 'sandbox' });
  assert.equal(manifest.legal_validity, false);
  assert.equal(manifest.warning, null);
});
