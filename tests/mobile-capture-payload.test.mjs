import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
await build({
  entryPoints: ['src/lib/identity/mobile-capture-payload.ts'],
  outfile: 'node_modules/.cache/mobile-capture-payload-test.cjs',
  bundle: true, platform: 'node', format: 'cjs',
});
const { createMobileCapturePayload, MAX_MOBILE_CAPTURE_PAYLOAD_CHARS } =
  require('../node_modules/.cache/mobile-capture-payload-test.cjs');

test('stored identification stays on the server while selfie and liveness video are submitted', () => {
  const payload = JSON.parse(createMobileCapturePayload({
    token: 'token', anverso: 'large-stored-front', reverso: 'large-stored-back',
    selfiePhoto: 'selfie', selfieVideo: 'video', curp: 'CURP',
    nombre: 'Ana', apellidoPaterno: 'Pérez', apellidoMaterno: 'López',
    profileCurp: 'CURP', usingStoredId: true,
  }));
  assert.equal(payload.anversoData, null);
  assert.equal(payload.reversoData, null);
  assert.equal(payload.selfieData, 'selfie');
  assert.equal(payload.selfieVideo, 'video');
  assert.equal(payload.nombreExtracted, 'Ana Pérez López');
  assert.ok(MAX_MOBILE_CAPTURE_PAYLOAD_CHARS < 4_500_000);
});

test('new identification is submitted for server-side verification', () => {
  const payload = JSON.parse(createMobileCapturePayload({
    token: 'token', anverso: 'front', reverso: 'back',
    selfiePhoto: 'selfie', selfieVideo: null, curp: null,
    nombre: null, apellidoPaterno: null, apellidoMaterno: null,
    profileCurp: null, usingStoredId: false,
  }));
  assert.equal(payload.anversoData, 'front');
  assert.equal(payload.reversoData, 'back');
});
