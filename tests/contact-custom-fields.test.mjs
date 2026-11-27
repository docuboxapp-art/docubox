import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/lib/contacts/detail.ts'],
  write: false,
  bundle: true,
  platform: 'node',
  format: 'esm',
});
const {
  CONTACT_FIELD,
  canKeepContactFieldValue,
  getContactFieldValue,
  normalizeContactFieldValue,
  readContactField,
} = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
);

const contacts = new Set(['contact-1', 'contact-2']);
const definition = (type, options = {}) => ({
  sectionId: 'section',
  label: 'Dato',
  type,
  ...options,
});
const fromStorage = (field) =>
  readContactField({ field_name: CONTACT_FIELD, field_value: JSON.stringify(field) });

test('existing field values still load and a saved empty value overrides the default', () => {
  const field = definition('text', { defaultValue: 'Inicial' });
  assert.equal(getContactFieldValue(fromStorage({ ...field, value: 'Capturado' })), 'Capturado');
  assert.equal(getContactFieldValue(fromStorage({ ...field, value: '' })), 'Inicial');
  assert.equal(getContactFieldValue(fromStorage({ ...field, value: '', captured: true })), '');
  assert.equal(
    getContactFieldValue(
      fromStorage({ ...field, defaultValue: 'Otro', value: 'Capturado', captured: true })
    ),
    'Capturado'
  );
  assert.equal(fromStorage({ ...field, type: 'unknown', value: '' }), null);
});

test('configured lists and contact fields store valid choices while a combobox accepts custom text', () => {
  const options = ['Primera', 'Segunda'];
  const normalize = (type, value) =>
    normalizeContactFieldValue(definition(type, { options }), value, contacts);
  assert.equal(normalize('select', 'Primera'), 'Primera');
  assert.throws(() => normalize('select', 'Otra'), /lista/);
  assert.equal(normalize('combobox', 'Otra'), 'Otra');
  assert.equal(
    normalize('multiselect', '["Segunda","Primera","Segunda"]'),
    '["Segunda","Primera"]'
  );
  assert.equal(normalize('multiselect', '[]'), '');
  assert.throws(() => normalize('multiselect', '["Fuera de lista"]'), /disponibles/);
  assert.equal(normalize('related', 'contact-1'), 'contact-1');
  assert.equal(normalize('related_multiple', '["contact-2"]'), '["contact-2"]');
  assert.throws(() => normalize('related', 'otro-contacto'), /agenda/);
  assert.throws(() => normalize('related_multiple', '["otro-contacto"]'), /disponibles/);
});

test('data controls preserve decimals, explicit no, postal codes and local dates', () => {
  const normalize = (type, value, settings) =>
    normalizeContactFieldValue(definition(type, settings), value, contacts);
  assert.equal(normalize('currency', '99990000,50', { currency: 'USD' }), '99990000.50');
  assert.throws(() => normalize('currency', '100.25', { currency: 'JPY' }), /decimales/);
  assert.equal(normalize('number', '2e3'), '2e3');
  assert.throws(() => normalize('number', '2 000'), /número/);
  assert.equal(normalize('boolean', 'false'), 'false');
  assert.equal(normalize('postal_code', '01234'), '01234');
  assert.equal(normalize('datetime', '2028-02-29T13:25'), '2028-02-29T13:25');
  assert.throws(() => normalize('date', '2026-02-29'), /fecha/);
  assert.throws(() => normalize('url', 'javascript:alert(0)'), /dirección web/);
});

test('a settings edit accepts compatible data and prevents losing or reinterpreting saved data', () => {
  const keep = (current, next) => canKeepContactFieldValue(fromStorage(current), next, contacts);
  assert.ok(keep({ ...definition('text'), value: '12' }, definition('number')));
  assert.ok(!keep({ ...definition('text'), value: 'Texto' }, definition('number')));
  assert.ok(!keep({ ...definition('text'), value: '+12' }, definition('number')));
  assert.ok(keep({ ...definition('text'), value: '', captured: true }, definition('number')));
  assert.ok(
    !keep(
      { ...definition('select', { options: ['A', 'B'] }), value: 'B' },
      definition('select', { options: ['A'] })
    )
  );
  assert.ok(!keep({ ...definition('related'), value: 'contact-1' }, definition('text')));
  assert.ok(
    !keep(
      { ...definition('currency', { currency: 'MXN' }), value: '12.00' },
      definition('currency', { currency: 'USD' })
    )
  );
});
