import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import JSZip from 'jszip';

const require = createRequire(import.meta.url);
await build({ entryPoints: ['src/lib/reporting/engine.ts'], outfile: 'node_modules/.cache/report-engine-test.cjs', bundle: true, platform: 'node', format: 'cjs' });
await build({ entryPoints: ['src/lib/reporting/export.ts'], outfile: 'node_modules/.cache/report-export-test.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['jszip', 'pdf-lib'] });
await build({ entryPoints: ['src/lib/reporting/form-fields.ts'], outfile: 'node_modules/.cache/report-form-fields-test.cjs', bundle: true, platform: 'node', format: 'cjs' });
const { runReport, aggregate, reportCategoryLabel, safeConfig, buildReportSeries, selectedReportFields, reportConfigIssue } = require('../node_modules/.cache/report-engine-test.cjs');
const { responseColumns } = require('../node_modules/.cache/report-form-fields-test.cjs');
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

test('period excludes invalid, old and future dates, and keeps a valid date reference', () => {
  const datedFields = [{ id: 'creado', label: 'Creado', type: 'date' }];
  const daysAgo = days => new Date(Date.now() - days * 86400000).toISOString();
  const datedRows = [{ creado: daysAgo(2) }, { creado: daysAgo(10) },
    { creado: new Date(Date.now() + 86400000).toISOString() }, { creado: 'fecha inválida' }];
  const config = { ...base, period: '7d', dateField: 'creado', sortBy: '' };
  assert.deepEqual(runReport(datedRows, config, datedFields), [datedRows[0]]);
  assert.equal(safeConfig({ period: '7d', dateField: '' }, 'documentos').dateField, 'creado');
});

test('technical states have readable labels without changing the source value', () => {
  assert.equal(reportCategoryLabel('en_proceso', 'estado'), 'En proceso');
  assert.equal(reportCategoryLabel('accion', 'clase'), 'Acción');
});

test('conditions accept visible status names, calendar dates, booleans and numbers', () => {
  const allFields = [...fields, { id: 'fecha', label: 'Fecha', type: 'date' }, { id: 'urgente', label: 'Urgente', type: 'boolean' }];
  const item = { nombre: 'A', estado: 'en_proceso', cantidad: 3, fecha: '2026-10-13T18:00:00Z', urgente: true };
  for (const condition of [
    { field: 'estado', operator: 'eq', value: 'En proceso' },
    { field: 'fecha', operator: 'eq', value: '2026-10-13' },
    { field: 'urgente', operator: 'eq', value: 'Sí' },
    { field: 'cantidad', operator: 'eq', value: '3.0' },
  ]) assert.deepEqual(runReport([item], { ...base, conditions: [condition] }, allFields), [item]);
});

test('report ordering keeps ties stable and keeps empty cells last in both directions', () => {
  const withDates = [...fields, { id: 'fecha', label: 'Fecha', type: 'date' }];
  const input = [
    { nombre: 'Documento 10', fecha: '2026-11-10T06:00:00Z' },
    { nombre: 'Documento 2', fecha: '2026-11-10T00:00:00-06:00' },
    { nombre: '', fecha: '' },
    { nombre: 'Documento 1', fecha: '2026-11-09' },
    { nombre: null, fecha: null },
  ];
  assert.deepEqual(runReport(input, { ...base, sortBy: 'fecha' }, withDates), [input[3], input[0], input[1], input[2], input[4]]);
  assert.deepEqual(runReport(input, { ...base, sortBy: 'fecha', sortDirection: 'desc' }, withDates), [input[0], input[1], input[3], input[2], input[4]]);
  assert.deepEqual(runReport(input, base, withDates), [input[3], input[1], input[0], input[2], input[4]]);
});

test('reports use the configured presentation and order, and reject conditions with stale fields', () => {
  const config = safeConfig({ ...base, visualization: 'kpi', groupBy: '', fields: ['estado', 'nombre'], sortBy: '' }, 'expedientes');
  assert.equal(config.visualization, 'kpi');
  assert.equal(config.groupBy, '');
  assert.equal(config.sortBy, '');
  assert.deepEqual(selectedReportFields(config, fields).map(({ id }) => id), ['estado', 'nombre']);
  assert.equal(reportConfigIssue(config, fields), '');
  assert.match(reportConfigIssue({ ...config, visualization: 'bar' }, fields), /agrupación/);
  assert.match(reportConfigIssue({
    ...config, conditions: [{ field: 'retirado', operator: 'eq', value: 'a' }],
  }, fields), /operadores/);
  assert.equal(reportCategoryLabel('ready_to_sign', 'estado'), 'Listo para firma');
});

test('date conditions and monthly series keep the final date, sort in time and exclude unreported values from averages', () => {
  const byDate = [...fields, { id: 'fecha', label: 'Fecha', type: 'date' }];
  const raw = [
    { fecha: '2026-11-20', cantidad: 6 },
    { fecha: '2026-10-12', cantidad: 10 },
    { fecha: '2026-10-13', cantidad: null },
  ];
  const filter = { ...base, conditions: [{ field: 'fecha', operator: 'lte', value: '2026-10-12' }], sortBy: '' };
  assert.deepEqual(runReport(raw, filter, byDate), [raw[1]]);
  const series = buildReportSeries(raw, {
    groupBy: 'fecha', visualization: 'line', metric: 'cantidad', metricOperation: 'average', dateBucket: 'month',
  }, byDate);
  assert.deepEqual(series.items.map(({ label, value }) => [label, value]), [['2026-10', 10], ['2026-11', 6]]);
});

test('response fields use the published schema, separate reused field IDs and keep attachment contents out of reports', () => {
  const forms = [
    { id: 'first', name: 'Primero', schema: [{ id: 'legacy', label: 'Legado', type: 'text' }],
      form_schema: { fields: [{ id: 'shared', label: 'Monto', type: 'currency' }, { id: 'pdf', label: 'Anexo', type: 'documento' }] } },
    { id: 'second', name: 'Segundo', schema: [{ id: 'shared', label: 'Referencia', type: 'text' }] },
  ];
  const lookup = responseColumns(forms);
  assert.deepEqual(lookup.project('first', { shared: '12.5', pdf: 'private-path', unknown: 'secret' }), {
    'respuesta.first.shared': 12.5, 'respuesta.first.pdf': true, 'respuesta.pdf': true,
  });
  assert.deepEqual(lookup.project('second', { shared: 'A-1' }), { 'respuesta.second.shared': 'A-1' });
  assert.equal(lookup.fields.some(field => field.id === 'respuesta.shared'), false);
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
