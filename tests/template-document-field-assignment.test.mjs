import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('src/app/crear-documento/page.tsx', 'utf8');
const settingsStep = readFileSync('src/app/crear-documento/components/StepAjustes.tsx', 'utf8');
const preview = readFileSync('src/components/templates/TemplateHtmlPreview.tsx', 'utf8');

test('template fields are preloaded into the canonical placed-field model', () => {
  assert.match(settingsStep, /template\.campos_insertados/);
  assert.match(settingsStep, /createTemplatePlacedFields\(templateSource, participants\)/);
  assert.match(settingsStep, /templateField: true/);
  assert.match(settingsStep, /tipo: field\.fieldType/);
  assert.match(settingsStep, /page: field\.pageIndex \+ 1/);
  assert.match(settingsStep, /valueKey: field\.valueKey/);
});

test('duplicated template field appearances share one assignment', () => {
  assert.match(settingsStep, /templateFieldGroups/);
  assert.match(settingsStep, /templateAssignmentFields/);
  assert.match(settingsStep, /hydrateTemplatePlacedFieldValueKeys/);
  assert.match(settingsStep, /\(field\.valueKey \|\| field\.id\) === targetValueKey/);
  assert.match(settingsStep, /apariciones/);
});

test('a single participant receives every unassigned template field automatically', () => {
  assert.match(settingsStep, /participants\.length === 1 \? participants\[0\] : null/);
  assert.match(settingsStep, /participantId: assignedParticipant\?\.id/);
});

test('multiple participants receive fields through drag and drop', () => {
  assert.match(settingsStep, /application\/x-docubox-template-field/);
  assert.match(settingsStep, /assignTemplateField\(fieldId, participant\.id\)/);
  assert.match(settingsStep, /Arrastra aquí los campos de esta persona/);
  assert.match(settingsStep, /Campos sin asignar/);
});

test('template field assignment is mandatory before leaving settings', () => {
  assert.match(page, /if \(!templateFieldsReady\) return false/);
  assert.match(settingsStep, /onTemplateFieldAssignmentChange\?\./);
  assert.match(settingsStep, /Asigna todos los campos para habilitar el siguiente paso/);
});

test('template preview measures real field coordinates without duplicating field widgets', () => {
  assert.match(preview, /querySelectorAll<HTMLElement>\('\[data-field-id\]'\)/);
  assert.match(preview, /onFieldsMeasured/);
  assert.match(settingsStep, /handleTemplateFieldsMeasured/);
  assert.match(settingsStep, /filter\(\(field\) => !field\.templateField\)/);
});
