import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import JSZip from 'jszip';

const require = createRequire(import.meta.url);
await build({ entryPoints: ['src/lib/reporting/engine.ts'], outfile: 'node_modules/.cache/report-engine-test.cjs', bundle: true, platform: 'node', format: 'cjs' });
await build({ entryPoints: ['src/lib/reporting/export.ts'], outfile: 'node_modules/.cache/report-export-test.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['jszip', 'pdf-lib'] });
const { runReport, aggregate } = require('../node_modules/.cache/report-engine-test.cjs');
const { exportReport } = require('../node_modules/.cache/report-export-test.cjs');

const fields = [{ id: 'nombre', label: 'Nombre', type: 'text' }, { id: 'estado', label: 'Estado', type: 'text' }, { id: 'cantidad', label: 'Cantidad', type: 'number' }];
const rows = [{ nombre: 'B', estado: 'pendiente', cantidad: 2 }, { nombre: 'A', estado: 'completado', cantidad: 3 }, { nombre: 'C', estado: 'completado', cantidad: 4 }];
const base = { fields: fields.map(field => field.id), conditions: [], match: 'all', period: 'all', dateField: '', visualization: 'table', groupBy: 'estado', metric: '__count', sortBy: 'nombre', sortDirection: 'asc' };

test('conditions, sorting and aggregation use the configured fields', () => {
  const result = runReport(rows, { ...base, conditions: [{ field: 'estado', operator: 'eq', value: 'completado' }] }, fields);
  assert.deepEqual(result.map(row => row.nombre), ['A', 'C']);
  assert.deepEqual(aggregate(result, 'estado', '__count'), [{ label: 'completado', value: 2 }]);
  assert.deepEqual(aggregate(result, 'estado', 'cantidad'), [{ label: 'completado', value: 7 }]);
});

test('CSV, Excel, JSON and PDF exports contain real configured rows', async () => {
  let blob;
  let filename;
  URL.createObjectURL = value => { blob = value; return 'blob:report-test'; };
  URL.revokeObjectURL = () => {};
  globalThis.window = { setTimeout: () => 0 };
  globalThis.document = { body: { append: () => {} }, createElement: () => ({
    set href(value) { assert.equal(value, 'blob:report-test'); },
    set download(value) { filename = value; }, click: () => {}, remove: () => {},
  }) };

  await exportReport('Informe de prueba', fields, rows, 'csv');
  assert.equal(filename, 'informe-de-prueba.csv');
  assert.match(await blob.text(), /completado/);

  await exportReport('Informe de prueba', fields, rows, 'xlsx');
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const worksheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(worksheet, /Cantidad/);
  assert.match(worksheet, /completado/);

  await exportReport('Informe de prueba', fields, rows, 'json');
  assert.equal(JSON.parse(await blob.text())[0].nombre, 'B');

  await exportReport('Informe de prueba', fields, rows, 'pdf');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
});
