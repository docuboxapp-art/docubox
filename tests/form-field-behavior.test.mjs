import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import test from 'node:test';
import { normalizeFormTemplate } from '../src/lib/forms/schema.ts';

const cache = join(process.cwd(), 'node_modules/.cache/form-field-behavior-test');
await mkdir(cache, { recursive: true });
await build({
  entryPoints: ['src/lib/forms/field-behavior.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  outfile: join(cache, 'behavior.cjs'),
  logLevel: 'silent',
});
const { formatFormFieldValue, hasFormValue, isFormFieldRequired, isFormFieldVisible } =
  createRequire(import.meta.url)(join(cache, 'behavior.cjs'));

const field = (rule) => ({
  id: 'dependent',
  type: 'text',
  label: 'Dato dependiente',
  required: false,
  conditionalVisible: true,
  conditionalRule: { fieldId: 'choice', operator: 'eq', value: 'yes', ...rule },
});

test('conditional show, hide and require follow the configured answer', () => {
  assert.equal(isFormFieldVisible(field({ action: 'show' }), { choice: 'no' }), false);
  assert.equal(isFormFieldVisible(field({ action: 'show' }), { choice: 'yes' }), true);
  assert.equal(isFormFieldVisible(field({ action: 'hide' }), { choice: 'yes' }), false);
  assert.equal(isFormFieldVisible(field({ action: 'hide' }), { choice: 'no' }), true);
  assert.equal(isFormFieldVisible(field({ action: 'require' }), { choice: 'no' }), true);
  assert.equal(isFormFieldRequired(field({ action: 'require' }), { choice: 'no' }), false);
  assert.equal(isFormFieldRequired(field({ action: 'require' }), { choice: 'yes' }), true);
});

test('a mandatory signature stays visible despite a legacy condition', () => {
  const signature = { ...field({ action: 'show' }), type: 'signature_block', required: true };
  assert.equal(isFormFieldVisible(signature, { choice: 'no' }), true);
  assert.equal(isFormFieldRequired(signature, { choice: 'no' }), true);
});

test('multi-select conditions and empty values use field semantics', () => {
  assert.equal(isFormFieldVisible(field({ action: 'show' }), { choice: ['no', 'yes'] }), true);
  assert.equal(isFormFieldVisible(field({ operator: 'empty', action: 'show' }), { choice: [] }), true);
  assert.equal(hasFormValue({ street: '', city: '' }), false);
  assert.equal(hasFormValue({ street: 'Reforma', city: '' }), true);
});

test('domicilio is concatenated and options use labels in the PDF mirror', () => {
  assert.equal(formatFormFieldValue({ type: 'fiscal_address' }, {
    street: 'Reforma', exteriorNumber: '100', interiorNumber: '2',
    neighborhood: 'Centro', city: 'Chihuahua', state: 'Chihuahua',
  }), 'Reforma 100 Int. 2, Centro, Chihuahua, Chihuahua');
  assert.equal(formatFormFieldValue({ type: 'select', options: [{ value: 'mx', label: 'México' }] }, 'mx'), 'México');
  assert.equal(formatFormFieldValue({ type: 'currency' }, '12500'), '$12,500.00');
});

test('legacy field labels are updated without replacing custom labels', () => {
  const template = normalizeFormTemplate({
    schema: [
      { id: 'a', type: 'business_name', label: 'Razón social', sectionId: 'section-general' },
      { id: 'b', type: 'fiscal_address', label: 'Domicilio fiscal', sectionId: 'section-general' },
      { id: 'c', type: 'business_name', label: 'Empresa beneficiaria', sectionId: 'section-general' },
    ],
  });
  assert.deepEqual(template.schema.map(({ label }) => label), [
    'Nombre o denominación social', 'Domicilio', 'Empresa beneficiaria',
  ]);
});
