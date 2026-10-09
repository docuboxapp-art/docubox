import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import test from 'node:test';
import { createDefaultFormTemplate, normalizeFormTemplate } from '../src/lib/forms/schema.ts';

const cache = join(process.cwd(), 'node_modules/.cache/form-web-header-test');
await mkdir(cache, { recursive: true });
await build({
  entryPoints: ['src/lib/forms/web-header.ts', 'src/lib/forms/appearance-defaults.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  outdir: cache,
  logLevel: 'silent',
});
const require = createRequire(import.meta.url);
const { resolveFormWebHeader } = require(join(cache, 'web-header.js'));
const { reusableFormAppearance } = require(join(cache, 'appearance-defaults.js'));

test('the web header inherits General metadata until its text is customized', () => {
  const form = createDefaultFormTemplate();
  form.name = 'Solicitud de crédito';
  form.description = 'Completa tus datos';
  form.settings.documentNumber = 'FORM-001';
  form.settings.documentTypeName = 'Solicitud';
  assert.deepEqual(resolveFormWebHeader(form), {
    title: 'Solicitud de crédito',
    description: 'Completa tus datos',
    documentNumber: 'FORM-001',
    documentType: 'Solicitud',
  });

  form.settings.appearance.headerText = 'Título público';
  form.settings.appearance.headerDescription = 'Instrucciones visibles';
  assert.equal(resolveFormWebHeader(form).title, 'Título público');
  assert.equal(resolveFormWebHeader(form).description, 'Instrucciones visibles');
  assert.equal(form.name, 'Solicitud de crédito');
  assert.equal(form.description, 'Completa tus datos');
});

test('visibility options persist while identity overrides do not become new-form defaults', () => {
  const form = createDefaultFormTemplate();
  form.settings.appearance = {
    ...form.settings.appearance,
    headerText: 'Título público',
    headerDescription: 'Texto público',
    showDescription: false,
    showDocumentNumber: false,
  };
  assert.equal(resolveFormWebHeader(form).description, '');
  assert.equal(resolveFormWebHeader(form).documentNumber, '');

  const defaults = reusableFormAppearance(form.settings.appearance);
  assert.equal(defaults.headerText, '');
  assert.equal(defaults.headerDescription, '');
  assert.equal(defaults.headerDocumentNumber, '');
  assert.equal(defaults.headerDocumentTypeName, '');
  assert.equal(defaults.showDescription, false);
  assert.equal(defaults.showDocumentNumber, false);
});

test('public forms can show code and catalog type from the saved appearance snapshot', () => {
  const form = normalizeFormTemplate({
    name: 'Solicitud pública',
    settings: { appearance: {
      headerDocumentNumber: 'FORM-001',
      headerDocumentTypeName: 'Solicitud',
    } },
  });
  assert.equal(form.settings.documentNumber, '');
  assert.equal(form.settings.documentTypeName, '');
  assert.equal(resolveFormWebHeader(form).documentNumber, 'FORM-001');
  assert.equal(resolveFormWebHeader(form).documentType, 'Solicitud');
});

test('saved forms restore header options and old placeholder text falls back to the name', () => {
  const saved = normalizeFormTemplate({
    name: 'Formulario existente',
    description: 'Descripción general',
    settings: { appearance: { headerText: 'Formulario firmable', showDocumentType: false } },
  });
  assert.equal(resolveFormWebHeader(saved).title, 'Formulario existente');
  assert.equal(resolveFormWebHeader(saved).documentType, '');
});
