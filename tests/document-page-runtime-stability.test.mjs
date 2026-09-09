import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('document signing and viewing defer PDF rendering until after React commits', () => {
  for (const file of [
    'src/app/firmar-documento/[id]/page.tsx',
    'src/app/visor-documento/[id]/page.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /requestAnimationFrame\(\(\) => \{\s*void renderPage\(\);/);
    assert.match(source, /cancelAnimationFrame\(renderFrame\)/);
  }
});

test('viewer callbacks observe the current document and certification state', () => {
  const source = read('src/app/visor-documento/[id]/page.tsx');
  assert.match(source, /\[cryptographicCertification, docId, document, logActivity\]/);
  assert.match(source, /\[xmlEvidenceData, docId, document\]/);
  assert.match(source, /const renderPaginationBar = \(modal = false\)/);
  assert.doesNotMatch(source, /const PaginationBar =/);
});

test('autograph evidence capture is declared before signature pad listeners use it', () => {
  const source = read('src/app/firmar-documento/[id]/AutographSignatureFlow.tsx');
  const declaration = source.indexOf('const captureFrame = useCallback');
  const listener = source.indexOf("captureFrame('stroke_start')");
  assert.ok(declaration >= 0, 'captureFrame declaration is missing');
  assert.ok(listener > declaration, 'captureFrame must be declared before stroke listeners');
});

test('standard autograph signing skips proof-of-life frame rendering', () => {
  const source = read('src/app/firmar-documento/[id]/AutographSignatureFlow.tsx');
  assert.match(source, /autographSignatureCapabilities\.identityVerification &&\s*!framesRef\.current\.strokeStartCaptured/);
  assert.match(source, /if \(autographSignatureCapabilities\.identityVerification\) \{\s*framesRef\.current\.frame2/);
  assert.match(source, /if \(!autographSignatureCapabilities\.identityVerification\) return;/);
});

test('required browser location evidence blocks signing when unavailable', () => {
  const source = read('src/app/firmar-documento/[id]/page.tsx');
  const autographSource = read('src/app/firmar-documento/[id]/AutographSignatureFlow.tsx');
  const evidenceRoute = read('src/app/api/firma/persist-evidence/route.ts');
  const captureSignature = read('supabase/functions/capture-signature/index.ts');
  const efirmaFunction = read('supabase/functions/sign-efirma/index.ts');
  assert.match(source, /const ipRef = useRef<string \| null>\(null\)/);
  assert.match(source, /controller\.abort\(\), 1500/);
  assert.match(source, /ipAddress = ipRef\.current \|\| '—';/);
  assert.match(source, /coordinates = geoRef\.current;/);
  assert.doesNotMatch(source, /const ipRes = await fetch\('https:\/\/api\.ipify\.org/);
  assert.doesNotMatch(source, /timeout: 10000, maximumAge: 60000/);
  assert.match(source, /if \(geoLoading \|\| geoBlocked\) return;/);
  assert.match(source, /disabled=\{!terminosAceptados \|\| geoBlocked \|\| geoLoading\}/);
  assert.match(source, /disabled=\{!allCamposCompleted \|\| geoBlocked \|\| geoLoading\}/);
  assert.match(source, /Debes permitir el acceso a ubicación/);
  assert.match(autographSource, /disabled=\{geoDenied\}/);
  assert.match(autographSource, /if \(!persistRes\?\.ok\)/);
  assert.match(evidenceRoute, /code: 'GEOLOCATION_REQUIRED'/);
  assert.match(captureSignature, /validBrowserGeolocation\(session_evidence\?\.geo\)/);
  assert.match(captureSignature, /code: 'GEOLOCATION_REQUIRED'/);
  assert.match(efirmaFunction, /validBrowserGeolocation\(body\.session_evidence\?\.geo\)/);
  assert.match(efirmaFunction, /geo_latitude: geoLatitude/);
});
