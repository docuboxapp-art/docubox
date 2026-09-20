import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getTemplateSignatureCapacity } from '../src/lib/templates/field-capacity.ts';

const page = readFileSync('src/app/crear-documento/page.tsx', 'utf8');
const participantsStep = readFileSync(
  'src/app/crear-documento/components/StepParticipantes.tsx',
  'utf8'
);
const capacityHelper = readFileSync('src/lib/templates/field-capacity.ts', 'utf8');

test('template signature capacity counts every visible signature placement', () => {
  assert.match(capacityHelper, /campos_insertados\.reduce/);
  assert.match(capacityHelper, /fieldType === 'signature'/);
  assert.match(capacityHelper, /isSignature \? capacity \+ 1 : capacity/);

  assert.equal(
    getTemplateSignatureCapacity({
      campos_insertados: [
        { fieldType: 'signature', label: 'Firma', valueKey: 'shared-signature' },
        { fieldType: 'signature', label: 'Firma', valueKey: 'shared-signature' },
        { fieldType: 'text', label: 'Nombre completo', valueKey: 'full-name' },
      ],
    }),
    2
  );
  assert.equal(
    getTemplateSignatureCapacity({
      campos_insertados: [
        { fieldType: 'signature', label: 'Firma', valueKey: 'signature-1' },
        { fieldType: 'signature', label: 'Firma', valueKey: 'signature-2' },
      ],
    }),
    2
  );
});

test('a template requires exactly one configured signer per signature placement', () => {
  assert.match(participantsStep, /configuredSignerCount > templateSignatureCapacity/);
  assert.match(participantsStep, /onSignatureCapacityExceeded\?\.\(templateSignatureCapacity\)/);
  assert.match(participantsStep, /if \(saved !== false\) onClose\(\)/);
  assert.match(page, /configuredSignerCount !== templateSignatureCapacity/);
  assert.match(page, /!templateSignerCapacityMismatch/);
});

test('a template without signature fields rejects signer participants', () => {
  assert.equal(
    getTemplateSignatureCapacity({
      campos_insertados: [
        { fieldType: 'text', label: 'Nombre completo', valueKey: 'full-name' },
        { fieldType: 'date', label: 'Fecha', valueKey: 'date' },
      ],
    }),
    0
  );
  assert.match(
    participantsStep,
    /templateSignatureCapacity !== null && configuredSignerCount > templateSignatureCapacity/
  );
  assert.match(participantsStep, /return false/);
  assert.match(
    page,
    /Esta plantilla no contiene espacios de firma\. No es posible configurar firmantes\./
  );
  assert.match(page, /configuredSignerCount === templateSignatureCapacity/);
});

test('the capacity restriction is communicated as a transient indicator', () => {
  assert.match(page, /Esta plantilla solo tiene un espacio de firma/);
  assert.match(page, /Esta plantilla contiene \$\{capacity\} espacios de firma/);
  assert.match(page, /Debes configurar \$\{capacity\} firmantes antes de continuar/);
  assert.match(page, /toast\.warning\(/);
  assert.match(page, /toast\.warning\(\s*getTemplateSignatureCapacityMessage/);
  assert.match(page, /<Toaster position="bottom-right" richColors/);
});
