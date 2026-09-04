import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const component = await readFile(
  new URL('../src/app/mis-documentos/components/ActivityAuditLog.tsx', import.meta.url),
  'utf8'
);

test('activity audit log defaults to ten rows and supports configurable pagination', () => {
  assert.match(component, /useState<10 \| 30 \| 50 \| 100>\(10\)/);
  assert.match(component, /const visibleAuditLog = filteredAuditLog\.slice/);
  assert.match(component, /\[10, 30, 50, 100\]/);
  assert.match(component, /Registros por página/);
  assert.match(component, /Mostrando \{auditPageStart \+ 1\}/);
  assert.match(component, /Página anterior/);
  assert.match(component, /Página siguiente/);
});

test('activity audit pagination resets when the result set changes', () => {
  assert.match(component, /setSearchQuery\(e\.target\.value\);\s*setAuditPage\(1\)/);
  assert.match(component, /setTimeFilter\(key\);\s*setAuditPage\(1\)/);
  assert.match(component, /setActiveTab\(tab\.key\);\s*setAuditPage\(1\)/);
});
