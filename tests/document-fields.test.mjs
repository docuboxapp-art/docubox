import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/lib/documentFields.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { format: 'cjs', loader: 'ts', target: 'node20' });
const module = { exports: {} };
new Function('module', 'exports', code)(module, module.exports);

const { isDocumentGeneratedCryptographicField } = module.exports;

test('document cryptographic fields are excluded from participant input', () => {
  assert.equal(
    isDocumentGeneratedCryptographicField({
      label: 'Cadena original',
      placementKind: 'cryptographic',
      cryptographicType: 'document_chain',
    }),
    true
  );
  assert.equal(
    isDocumentGeneratedCryptographicField({
      label: 'Sello digital',
      cryptographicType: 'document_seal',
    }),
    true
  );
});

test('legacy cryptographic labels are excluded without hiding participant fields', () => {
  assert.equal(isDocumentGeneratedCryptographicField({ label: '  SELLO DIGITAL  ' }), true);
  assert.equal(isDocumentGeneratedCryptographicField({ label: 'Nombre completo' }), false);
  assert.equal(isDocumentGeneratedCryptographicField({ label: 'Firma' }), false);
});
