import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../src/app/mis-documentos/page.tsx', import.meta.url),
  'utf8'
);

test('document tables use medium-weight supporting headers', () => {
  const tableHeaders = source.match(/<thead className="\[&_th\]:font-500">/g) || [];
  assert.equal(tableHeaders.length, 5);
});

test('document hierarchy keeps emphasis only on primary information', () => {
  assert.match(source, /text-2xl font-700 text-slate-950">Mi Espacio/);
  assert.match(source, /text-2xl font-800 tabular-nums/);
  assert.match(source, /bg-primary\/10 font-600 text-primary/);
  assert.match(source, /truncate text-sm font-600 text-slate-900/);
  assert.doesNotMatch(source, /bg-primary\/10 font-700 text-primary/);
});
