import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { requiresFormSignature } from '../supabase/functions/_shared/form-signature-policy.ts';

test('every form launch requires a signature, including legacy forms', () => {
  assert.equal(
    requiresFormSignature({ requiresSignature: false }, [
      { type: 'signature_block', required: true },
    ]),
    true
  );
  assert.equal(
    requiresFormSignature({ requiresSignature: true }, [
      { type: 'signature_block', required: true },
    ]),
    true
  );
  assert.equal(
    requiresFormSignature({ requiresSignature: true }, [
      { type: 'signature_block', required: false },
    ]),
    true
  );
  assert.equal(requiresFormSignature({ requiresSignature: true }, []), true);
});

test('builder does not choose the signature method or OTP', async () => {
  const settings = await readFile('src/app/formularios/components/WizardSettings.tsx', 'utf8');
  const properties = await readFile('src/app/formularios/components/FieldProperties.tsx', 'utf8');
  const renderer = await readFile('src/app/formularios/components/FieldRenderer.tsx', 'utf8');
  assert.match(settings, /Firma obligatoria/);
  assert.doesNotMatch(settings, /SET_SETTINGS', payload: \{ requiresSignature: value \}/);
  assert.doesNotMatch(settings, /Métodos permitidos|Confirmación OTP/);
  assert.doesNotMatch(properties, /Métodos permitidos en este bloque/);
  assert.doesNotMatch(renderer, /Selecciona el mecanismo de firma/);
});

test('submission and PDF use the same signature requirement', async () => {
  const submit = await readFile('supabase/functions/form-submit/index.ts', 'utf8');
  const pdf = await readFile('supabase/functions/generate-form-pdf/index.ts', 'utf8');
  assert.match(submit, /requiresFormSignature\(/);
  assert.match(pdf, /requiresFormSignature\(/);
});

test('publication guard defers method selection without removing approval checks', async () => {
  const migration = await readFile(
    'supabase/migrations/20261006222253_defer_form_signature_method_selection.sql',
    'utf8'
  );
  assert.doesNotMatch(migration, /Select at least one signature method/);
  assert.match(migration, /Approval decision required for review transition/);
  assert.match(migration, /Form identity is immutable/);
});
