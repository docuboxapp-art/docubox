import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageSource = await readFile('src/app/plantillas/nueva/page.tsx', 'utf8');
const settingsSource = await readFile(
  'src/components/templates/TemplateDocumentSettingsPanel.tsx',
  'utf8'
);

test('new-template panels use the same plain heading treatment as new-document', () => {
  const propertiesHeading = pageSource.slice(
    pageSource.indexOf('Propiedades de la plantilla') - 350,
    pageSource.indexOf('Propiedades de la plantilla') + 250
  );

  assert.doesNotMatch(propertiesHeading, /<FileText/);
  assert.match(propertiesHeading, /<div className="mb-5">/);
  assert.doesNotMatch(settingsSource, /\bRuler\b/);
  assert.match(settingsSource, /<h2 className="text-base font-600 leading-5 text-slate-950">/);
});
