import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const built = await build({ entryPoints: ['src/lib/documents/signature-methods.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { signatureMethodList, signatureMethodLabel } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
test('historical single signature methods can be rendered with the same list contract', () => {
  assert.deepEqual(signatureMethodList('click_sign'), ['click_sign']);
  assert.equal(signatureMethodList('Firma con clic').join(', '), 'Firma con clic');
  assert.deepEqual(signatureMethodList(['autografa_digital', 'efirma_sat']), ['autografa_digital', 'efirma_sat']);
  assert.equal(signatureMethodList('autografa_digital').map(signatureMethodLabel).join(', '), 'Firma autógrafa digital');
});
test('missing, duplicated and malformed signature methods do not crash participation details', () => {
  for (const value of [null, undefined, {}, false, 123, '  ']) assert.deepEqual(signatureMethodList(value), []);
  assert.deepEqual(signatureMethodList([' click_sign ', null, {}, 'click_sign', '']), ['click_sign']);
});
