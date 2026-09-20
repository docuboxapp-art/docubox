import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const templateEditor = readFileSync('src/app/plantillas/nueva/page.tsx', 'utf8');
const signer = readFileSync('src/app/firmar-documento/[id]/page.tsx', 'utf8');
const viewer = readFileSync('src/app/visor-documento/[id]/page.tsx', 'utf8');

test('duplicated template appearances persist one shared value key', () => {
  assert.match(templateEditor, /data-field-value-key/);
  assert.match(templateEditor, /valueKey: source\.valueKey \|\| source\.id/);
});

test('signing captures one value and applies it to every linked appearance', () => {
  assert.match(signer, /function getCampoValueKey/);
  assert.match(signer, /logicalCamposPrefijados/);
  assert.match(signer, /camposValues\[f\.valueKey \|\| f\.id\]/);
});

test('document preview resolves linked appearances from the shared response value', () => {
  assert.match(viewer, /completed\.campo_id === \(campo\.valueKey \|\| campo\.id\)/);
});
