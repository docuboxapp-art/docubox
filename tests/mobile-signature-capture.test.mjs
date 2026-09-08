import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('mobile signature sessions use an expiring hashed capability token', () => {
  const source = read('src/app/api/firma/mobile-signature/create/route.ts');
  assert.match(source, /requireDocumentAccess\(request, documentId\)/);
  assert.match(source, /randomBytes\(32\)/);
  assert.match(source, /hashCapabilityToken\(token\)/);
  assert.match(source, /10 \* 60 \* 1000/);
  assert.match(source, /mode: 'signature_capture'/);
});

test('mobile signature payload is validated and encrypted before persistence', () => {
  const source = read('src/app/api/firma/mobile-signature/submit/route.ts');
  assert.match(source, /validImageBase64/);
  assert.match(source, /MAX_STROKES_SIZE/);
  assert.match(source, /encryptCapture\(JSON.stringify\(capture\), key\)/);
  assert.match(source, /\.eq\('status', 'pending'\)/);
  assert.match(source, /\.gt\('expires_at'/);
});

test('only the authenticated initiator can recover the mobile signature result', () => {
  const source = read('src/app/api/firma/mobile-signature/result/route.ts');
  assert.match(source, /requireDocumentAccess\(request, documentId\)/);
  assert.match(source, /session\.user_id !== user\.id/);
  assert.match(source, /decryptCapture/);
});

test('desktop flow opens the inline pad directly and keeps expanded and mobile signing optional', () => {
  const source = read('src/app/firmar-documento/[id]/AutographSignatureFlow.tsx');
  assert.doesNotMatch(source, /flowStep === 'signature_method'/);
  assert.doesNotMatch(source, /¿Dónde deseas plasmar tu firma\?/);
  assert.match(source, /onNoticeAccepted\?\.\(\);\s*setFlowStep\('pad'\);/);
  assert.match(source, /const \[padExpanded, setPadExpanded\] = useState\(false\)/);
  assert.match(source, /aria-label=\{padExpanded \? 'Reducir firma' : 'Expandir firma'\}/);
  assert.match(source, /height: padExpanded \? 'min\(52dvh, 420px\)' : '200px'/);
  assert.match(source, /useState<'thin' \| 'medium' \| 'thick'>\('thin'\)/);
  assert.match(source, /aria-label="Firmar desde el móvil"/);
  assert.match(source, /MobileSignatureModal/);
});

test('mobile signing page captures vector strokes and submits them through the temporary session', () => {
  const source = read('src/app/firma-movil/[token]/page.tsx');
  assert.match(source, /import\('signature_pad'\)/);
  assert.match(source, /mobile-signature\/submit/);
  assert.match(source, /strokes: pad\.toData\(\)/);
  assert.match(source, /useState<StrokeSize>\('thin'\)/);
  assert.match(read('src/middleware.ts'), /'\/firma-movil\/'/);
});
