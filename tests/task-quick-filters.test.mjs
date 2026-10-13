import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
await build({
  entryPoints: ['src/lib/tasks/quick-filters.ts'],
  outfile: 'node_modules/.cache/task-quick-filters-test.cjs',
  bundle: true, platform: 'node', format: 'cjs',
});
const { matchesQuickTaskFilters } = require('../node_modules/.cache/task-quick-filters-test.cjs');
const now = new Date(2026, 9, 13, 12).getTime();
const baseTask = {
  assignedTo: 'user-a', createdBy: 'user-b', origin: 'manual',
  status: 'pendiente', dueDate: new Date(2026, 9, 13, 18).toISOString(),
  isOverdue: false, isCritical: false, priority: 'media',
};
const filters = { owner: 'all', attention: 'all', origin: 'all', userId: 'user-a', now };

test('responsibility filters are mutually exclusive and include system-created tasks', () => {
  assert.equal(matchesQuickTaskFilters(baseTask, { ...filters, owner: 'assigned' }), true);
  assert.equal(matchesQuickTaskFilters(baseTask, { ...filters, owner: 'created' }), false);
  const generated = { ...baseTask, createdBy: 'user-a', origin: 'sistema' };
  assert.equal(matchesQuickTaskFilters(generated, { ...filters, owner: 'created' }), true);
  assert.equal(matchesQuickTaskFilters(generated, { ...filters, owner: 'created', origin: 'manual' }), false);
  assert.equal(matchesQuickTaskFilters(baseTask, { ...filters, owner: 'assigned', userId: null }), false);
});

test('attention filters distinguish overdue, due today and high priority', () => {
  assert.equal(matchesQuickTaskFilters(baseTask, { ...filters, attention: 'today' }), true);
  assert.equal(matchesQuickTaskFilters({ ...baseTask, isOverdue: true }, { ...filters, attention: 'today' }), false);
  assert.equal(matchesQuickTaskFilters({ ...baseTask, isOverdue: true }, { ...filters, attention: 'overdue' }), true);
  assert.equal(matchesQuickTaskFilters({ ...baseTask, priority: 'alta' }, { ...filters, attention: 'priority' }), true);
  assert.equal(matchesQuickTaskFilters({ ...baseTask, isCritical: true }, { ...filters, attention: 'priority' }), true);
  assert.equal(matchesQuickTaskFilters({ ...baseTask, status: 'completada', isOverdue: true }, { ...filters, attention: 'overdue' }), false);
});
