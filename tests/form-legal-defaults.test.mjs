import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDefaultFormLegalDefaults,
  normalizeFormLegalDefaults,
  defaultLegalFieldContent,
} from '../src/lib/forms/legal-field-content.ts';

test('the current consent and declaration wording remains the default', () => {
  const defaults = createDefaultFormLegalDefaults();
  assert.deepEqual(defaults.consentimiento, defaultLegalFieldContent('consentimiento'));
  assert.deepEqual(defaults.declaration, defaultLegalFieldContent('declaration'));
});

test('saved legal defaults normalize independently for each field type', () => {
  const saved = normalizeFormLegalDefaults({
    consentimiento: { description: '  Texto nuevo  ', acceptanceLabel: ' Acepto ' },
    declaration: { description: '', acceptanceLabel: '' },
  });
  assert.equal(saved.consentimiento.description, 'Texto nuevo');
  assert.equal(saved.consentimiento.acceptanceLabel, 'Acepto');
  assert.deepEqual(saved.declaration, defaultLegalFieldContent('declaration'));
});
