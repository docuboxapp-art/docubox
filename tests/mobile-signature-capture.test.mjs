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

test('autograph identity verification is retained behind a disabled-by-default capability', () => {
  const source = read('src/app/firmar-documento/[id]/AutographSignatureFlow.tsx');
  const capability = read('src/lib/signatures/autographSignatureCapabilities.ts');

  assert.match(capability, /NEXT_PUBLIC_AUTOGRAPH_IDENTITY_VERIFICATION_ENABLED === 'true'/);
  assert.match(source, /autographSignatureCapabilities\.identityVerification/);
  assert.doesNotMatch(capability, /NEXT_PUBLIC_AUTOGRAPH_LIVENESS_ENABLED/);
  assert.match(source, /setFlowStep\('sending'\);\s*framesRef\.current\.frame3 = await captureFrame\('confirmation'\);\s*await sendAll\(\);/);
  assert.match(source, /otpEvidenceVerified = autographSignatureCapabilities\.identityVerification && otpVerified/);
  assert.match(source, /sendOtp\(\);\s*setFlowStep\('otp'\);/);
  assert.match(source, /continueAfterSignature\(\);/);
});

test('mobile signing page captures vector strokes and submits them through the temporary session', () => {
  const source = read('src/app/firma-movil/[token]/page.tsx');
  assert.match(source, /import\('signature_pad'\)/);
  assert.match(source, /mobile-signature\/submit/);
  assert.match(source, /strokes: pad\.toData\(\)/);
  assert.match(source, /useState<StrokeSize>\('thin'\)/);
  assert.match(read('src/middleware.ts'), /'\/firma-movil\/'/);
});

test('mobile signing preserves strokes and uses a horizontal pad in every orientation', () => {
  const source = read('src/app/firma-movil/[token]/page.tsx');
  assert.match(source, /orientation\.lock\('landscape'\)/);
  assert.match(source, /requestFullscreen\?\.\(\)/);
  assert.match(source, /Gira el teléfono para firmar en horizontal/);
  assert.match(source, /window\.visualViewport\?\.addEventListener\('resize'/);
  assert.match(source, /x: \(point\.x \* nextWidth\) \/ priorWidth/);
  assert.match(source, /aspect-\[2\/1\]/);
  assert.match(source, /flex flex-col gap-2 landscape:flex-row/);
  assert.match(source, /landscape:h-\[calc\(100dvh-185px\)\]/);
});

test('mobile signing confirmation counts down and closes its temporary QR page', () => {
  const source = read('src/app/firma-movil/[token]/page.tsx');
  assert.match(source, /useState\(3\)/);
  assert.match(source, /window\.setTimeout\(closePage, 3_000\)/);
  assert.match(source, /window\.close\(\)/);
  assert.match(source, /window\.location\.replace\('about:blank'\)/);
  assert.match(source, /Esta página se cerrará en \{secondsUntilClose\} segundos\./);
  assert.match(source, /Cerrar ahora/);
});
