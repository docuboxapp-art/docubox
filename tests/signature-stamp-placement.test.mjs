import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const stampPath = new URL('../src/lib/signatures/pdf-stamp.ts', import.meta.url);
const routePath = new URL(
  '../src/app/api/documentos/[documentId]/seal-signatures/route.ts',
  import.meta.url,
);
const viewerPath = new URL('../src/app/visor-documento/[id]/page.tsx', import.meta.url);
const nom151RoutePath = new URL('../src/app/api/nom151/generate/route.ts', import.meta.url);
const nom151ServicePath = new URL('../src/lib/nom151/service.ts', import.meta.url);
const signingPagePath = new URL('../src/app/firmar-documento/[id]/page.tsx', import.meta.url);

test('signature renderer never invents a fallback evidence page', async () => {
  const source = await readFile(stampPath, 'utf8');
  assert.doesNotMatch(source, /EVIDENCIA DE FIRMAS/);
  assert.doesNotMatch(source, /pdf\.addPage/);
  assert.match(source, /stampsApplied \+= 1/);
});

test('signature endpoint rejects documents without configured signature fields', async () => {
  const source = await readFile(routePath, 'utf8');
  assert.match(source, /signatureFields\.length === 0/);
  assert.match(source, /no tiene campos de firma configurados para estampar/);
  assert.match(source, /stampsApplied === 0/);
});

test('signature endpoint resolves the historic current-user field to the owner UUID', async () => {
  const source = await readFile(routePath, 'utf8');
  assert.match(source, /normalize\(field\.participantId\) === 'current-user'/);
  assert.match(source, /participantId: document\.owner_id/);
  assert.match(source, /fields: resolvedSignatureFields/);
});

test('signature stamps require an explicit field type or an exact legacy signature label', async () => {
  const [stampSource, viewerSource] = await Promise.all([
    readFile(stampPath, 'utf8'),
    readFile(viewerPath, 'utf8'),
  ]);

  assert.match(stampSource, /legacySignatureLabels/);
  assert.match(stampSource, /return !type && legacySignatureLabels\.has/);
  assert.doesNotMatch(stampSource, /\/firma\/i/);
  assert.match(viewerSource, /return !type && \['firma', 'firma digital'/);
  assert.doesNotMatch(viewerSource, /\/firma\/i\.test/);
});

test('viewer downloads are proxied through the authorized document endpoint', async () => {
  const source = await readFile(viewerPath, 'utf8');
  assert.match(source, /viewer-file\?variant=original/);
  assert.match(source, /viewer-file\?variant=\$\{requestedFileVariant\}/);
  assert.doesNotMatch(source, /functions\/v1\/seal-pdf/);
});

test('viewer only requests a derived stamped PDF when a signature field exists', async () => {
  const source = await readFile(viewerPath, 'utf8');
  assert.match(source, /hasConfiguredSignatureFields/);
  assert.match(source, /!hasConfiguredSignatureFields/);
  assert.match(source, /document\?\.estado !== 'completado'/);
  assert.match(source, /hasConfiguredSignatureFields &&[\s\S]*?!document\.sealed_pdf_path/);
});

test('NOM-151 waits for the exact final PDF when signature fields are configured', async () => {
  const [viewerSource, serviceSource] = await Promise.all([
    readFile(viewerPath, 'utf8'),
    readFile(nom151ServicePath, 'utf8'),
  ]);

  assert.match(viewerSource, /await stampGenPromise;[\s\S]*?fetch\('\/api\/nom151\/generate'/);
  // Automatic issuance now waits for persisted PAdES-B-T readiness instead of
  // trusting the former local finalPdfReady flag.
  assert.match(
    viewerSource,
    /hasConfiguredSignatureFields &&[\s\S]*?!document\.sealed_pdf_path[\s\S]*?void ensureFinalSignedPdf\(\);[\s\S]*?return;/,
  );
  assert.match(
    viewerSource,
    /padesBtVerified &&[\s\S]*?nom151Ready &&[\s\S]*?nom151LookupComplete &&[\s\S]*?void generateNom151\(\{ silent: true \}\)/,
  );
  assert.match(serviceSource, /async function verifiedPadesBt/);
  assert.match(serviceSource, /\.eq\('pades_profile', 'PAdES-B-T'\)/);
  assert.match(serviceSource, /\.eq\('pdf_signature_status', 'valid'\)/);
  assert.match(serviceSource, /\.eq\('timestamp_status', 'valid'\)/);
  assert.match(serviceSource, /\.eq\('verification_status', 'valid'\)/);
  assert.match(
    serviceSource,
    /row\.certified_pdf_sha256\.toLowerCase\(\) !==[\s\S]*?row\.pades_pdf_hash_after_signature/,
  );
});

test('the final participant automatically requests NOM-151 after PDF sealing', async () => {
  const [signingSource, routeSource] = await Promise.all([
    readFile(signingPagePath, 'utf8'),
    readFile(nom151RoutePath, 'utf8'),
  ]);

  const sealPosition = signingSource.indexOf('/seal-signatures');
  const nom151Position = signingSource.indexOf("fetch('/api/nom151/generate'");
  assert.ok(sealPosition >= 0 && nom151Position > sealPosition);
  assert.match(signingSource, /if \(documentoEstado === 'completado'\)/);
  assert.match(routeSource, /access\.role === 'AUTHORIZED'/);
  assert.match(routeSource, /PARTICIPATION_NOT_COMPLETED/);
});

test('NOM-151 generation is automatic and does not require opening downloads', async () => {
  const viewerSource = await readFile(viewerPath, 'utf8');
  const nom151Card = viewerSource.slice(
    viewerSource.indexOf('Constancia NOM-151'),
    viewerSource.indexOf('XML de Evidencia'),
  );

  assert.doesNotMatch(viewerSource, /activeTab !== 'descargas'/);
  assert.match(viewerSource, /void generateNom151\(\{ silent: true \}\)/);
  assert.match(viewerSource, /void ensureFinalSignedPdf\(\)/);
  assert.doesNotMatch(nom151Card, /Generar ahora|Reintentar generaci[oó]n/);
});

test('NOM-151 status keeps polling until issuance or a terminal failure', async () => {
  const source = await readFile(viewerPath, 'utf8');

  assert.match(source, /cache: 'no-store'/);
  assert.match(source, /const maxPollAttempts = 24/);
  // A persisted but unverified row is not terminal; polling stops only after
  // verified evidence or an explicit terminal failure.
  assert.match(source, /return Boolean\(\(json\.data && json\.verified\) \|\| json\.failed\)/);
  assert.match(source, /pollAttempts < maxPollAttempts/);
  assert.doesNotMatch(source, /if \(nom151Generating\) fetchNom151\(\)/);
});
