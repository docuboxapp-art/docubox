import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [creationSource, panelSource] = await Promise.all([
  readFile('src/app/crear-documento/components/StepSubir.tsx', 'utf8'),
  readFile('src/components/documents/LegalHoldPanel.tsx', 'utf8'),
]);

for (const [surface, source] of [
  ['creación', creationSource],
  ['gestión', panelSource],
]) {
  test(`Legal Hold muestra Información adicional colapsable en ${surface}`, () => {
    assert.match(source, />Información adicional</);
    assert.match(source, /aria-expanded=/);
    assert.match(source, /ChevronDown/);
  });

  test(`los campos adicionales conservan su propósito en ${surface}`, () => {
    assert.match(source, /Referencia \/ expediente/);
    assert.match(source, /Fecha de revisión/);
    assert.match(source, /Observaciones/);
  });
}
