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
const appLayout = readFileSync('src/app/layout.tsx', 'utf8');
const appToaster = readFileSync('src/components/ui/AppToaster.tsx', 'utf8');

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

test('the template keeps its signature assignments while allowing additional signers', () => {
  assert.doesNotMatch(participantsStep, /configuredSignerCount > templateSignatureCapacity/);
  assert.match(participantsStep, /if \(saved !== false\) onClose\(\)/);
  assert.match(page, /configuredSignerCount < templateSignatureCapacity/);
  assert.match(page, /!templateMissingSigners/);
  assert.match(page, /if \(templateSource && !templateFieldsReady\) return false/);
});

test('a template without signature fields allows signer participants', () => {
  assert.equal(
    getTemplateSignatureCapacity({
      campos_insertados: [
        { fieldType: 'text', label: 'Nombre completo', valueKey: 'full-name' },
        { fieldType: 'date', label: 'Fecha', valueKey: 'date' },
      ],
    }),
    0
  );
  assert.doesNotMatch(page, /No es posible configurar firmantes/);
});

test('the capacity restriction is communicated as a transient indicator', () => {
  assert.match(page, /Esta plantilla contiene un espacio de firma/);
  assert.match(page, /Esta plantilla contiene \$\{capacity\} espacios de firma/);
  assert.match(page, /Debes configurar al menos \$\{capacity\} firmantes antes de continuar/);
  assert.match(page, /toast\.warning\(/);
  assert.match(page, /toast\.warning\(\s*getTemplateSignatureCapacityMessage/);
  assert.match(appLayout, /<AppToaster\s*\/>/);
  assert.match(appToaster, /<Toaster\s+position="bottom-center"/);
});
