import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['src/app/mis-documentos/components/custom-filter-sort.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { availableCustomSortFields, compareCustomDocuments, compareCustomFolders } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

const older = {
  id: '1',
  name: 'Archivo 2',
  estado: 'Borrador',
  updatedAt: '2026-10-11T10:00:00Z',
  createdAt: '2026-10-10T10:00:00Z',
  completedAt: null,
  fechaVencimiento: null,
};
const newer = {
  id: '2',
  name: 'Archivo 10',
  estado: 'Completado',
  updatedAt: '2026-10-14T10:00:00Z',
  createdAt: '2026-10-13T10:00:00Z',
  completedAt: '2026-10-14T12:00:00Z',
  fechaVencimiento: null,
};

test('custom sort choices follow visible columns or active criteria', () => {
  assert.deepEqual(availableCustomSortFields(['estado'], ['fechaVencimiento'], false), [
    'nombre',
    'fechaVencimiento',
    'estado',
  ]);
  assert.deepEqual(availableCustomSortFields([], [], true), [
    'nombre',
    'ultimaModificacion',
    'fechaCreacion',
  ]);
});

test('custom document dates sort chronologically and keep missing dates last', () => {
  assert.ok(compareCustomDocuments(older, newer, 'ultimaModificacion', 'desc') > 0);
  assert.ok(compareCustomDocuments(older, newer, 'fechaCreacion', 'asc') < 0);
  assert.ok(compareCustomDocuments(older, newer, 'fechaCompletado', 'desc') > 0);
  const displayed = { ...older, updatedAt: null, ultimaModificacion: '11/10/2026 10:00 a.m.' };
  assert.ok(compareCustomDocuments(displayed, newer, 'ultimaModificacion', 'asc') < 0);
});

test('custom name, status and priority use the requested direction', () => {
  assert.ok(compareCustomDocuments(older, newer, 'nombre', 'asc') < 0);
  assert.ok(compareCustomDocuments(older, newer, 'estado', 'desc') > 0);
  const urgent = { ...older, esUrgente: true };
  assert.ok(compareCustomDocuments(urgent, newer, 'operativo', 'desc') < 0);
});

test('folder views can sort by creation and modification dates', () => {
  const first = { id: '1', name: 'Carpeta 2', createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z' };
  const second = { id: '2', name: 'Carpeta 10', createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z' };
  assert.ok(compareCustomFolders(first, second, 'nombre', 'asc') < 0);
  assert.ok(compareCustomFolders(first, second, 'fechaCreacion', 'asc') < 0);
  assert.ok(compareCustomFolders(first, second, 'ultimaModificacion', 'desc') < 0);
});
