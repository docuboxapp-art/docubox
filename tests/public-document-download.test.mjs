import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const publicFileRoute = await read(
  '../src/app/api/verificacion/documentos/[identifier]/archivo/route.ts'
);
const publicGateway = await read('../src/lib/public-verification/gateway.ts');
const verificationRoute = await read('../src/app/api/public/v1/verifications/[token]/route.ts');
const verificationView = await read(
  '../src/app/verificar-documento/components/VerificationResultView.tsx'
);

test('public document delivery requires an active document-level verification link', () => {
  assert.match(publicFileRoute, /searchParams\.get\('token'\)/);
  assert.match(publicFileRoute, /findActivePublicLink\(service, token\)/);
  assert.match(publicFileRoute, /publicLink\.document_id !== identifier/);
  assert.match(publicFileRoute, /publicLink\.visibility_level !== 'document'/);
  assert.match(publicFileRoute, /\.eq\('es_publico', true\)/);
});

test('public delivery only returns the sealed final PDF', () => {
  assert.match(publicFileRoute, /sealed_pdf_path,sealed_pdf_hash/);
  assert.match(publicFileRoute, /!finalPath \|\| !document\.sealed_pdf_hash/);
  assert.match(publicFileRoute, /storagePath: finalPath/);
  assert.match(publicFileRoute, /expectedPlaintextSha256: document\.sealed_pdf_hash/);
  assert.doesNotMatch(publicFileRoute, /resolveLegacyDocumentStoragePath/);
});

test('the verifier binds viewing and downloading URLs to the public token', () => {
  assert.match(publicGateway, /!document\.publicLinkId/);
  assert.match(publicGateway, /!document\.sealedPdfPath/);
  assert.match(publicGateway, /token=\$\{accessToken\}/);
  assert.match(verificationRoute, /attachTemporaryDocumentUrl\(supabase, document, result, token\)/);
  assert.match(verificationView, /download=1/);
});
