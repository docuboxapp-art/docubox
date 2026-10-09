import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import test from 'node:test';
import { createDefaultFormTemplate, normalizeFormTemplate } from '../src/lib/forms/schema.ts';

const cache = join(process.cwd(), 'node_modules/.cache/form-pdf-defaults-test');
await mkdir(cache, { recursive: true });
await build({
  entryPoints: ['src/lib/forms/pdf-defaults.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  outfile: join(cache, 'defaults.cjs'),
  logLevel: 'silent',
});
const { createDefaultFormPdfDefaults, normalizeFormPdfDefaults } = createRequire(import.meta.url)(
  join(cache, 'defaults.cjs')
);

test('new forms omit PDF details while legacy saved forms keep their former step', () => {
  assert.equal(createDefaultFormTemplate().settings.configurePdfDetails, false);
  assert.equal(normalizeFormTemplate({ id: 'legacy-form' }).settings.configurePdfDetails, true);
  assert.equal(
    normalizeFormTemplate({ id: 'current-form', settings: { configurePdfDetails: false } }).settings
      .configurePdfDetails,
    false
  );
});

test('form PDF defaults validate local values and preserve explicit choices', () => {
  const defaults = createDefaultFormPdfDefaults();
  assert.equal(defaults.configurePdfDetails, false);
  const configured = normalizeFormPdfDefaults({
    configurePdfDetails: true,
    pdfSchema: {
      header: 'Formulario de prueba',
      pageSize: 'a4',
      primaryColor: '#1E6BFF',
      typography: 'Poppins',
      showQr: false,
    },
  });
  assert.equal(configured.configurePdfDetails, true);
  assert.equal(configured.pdfSchema.header, 'Formulario de prueba');
  assert.equal(configured.pdfSchema.pageSize, 'a4');
  assert.equal(configured.pdfSchema.typography, 'Poppins');
  assert.equal(configured.pdfSchema.showQr, false);
  assert.equal(normalizeFormPdfDefaults({ pdfSchema: { typography: 'fuente-inválida' } }).pdfSchema.typography, 'sans');
  assert.equal(
    normalizeFormPdfDefaults({ pdfSchema: { primaryColor: 'invalid' } }).pdfSchema.primaryColor,
    defaults.pdfSchema.primaryColor
  );
});
