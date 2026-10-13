import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
await build({
  entryPoints: ['src/lib/tasks/view-state.ts'],
  outfile: 'node_modules/.cache/task-view-state-test.cjs',
  bundle: true, platform: 'node', format: 'cjs',
});
const { matchesTaskStatus, taskStatusAtTime, visibleTaskStatus } =
  require('../node_modules/.cache/task-view-state-test.cjs');

test('scheduled work appears in Programadas only before its start', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  const task = { status: 'pendiente', scheduledFor: '2026-10-14T12:00:00Z' };
  assert.equal(taskStatusAtTime(task, now), 'programada');
  assert.equal(matchesTaskStatus({ ...task, status: taskStatusAtTime(task, now) }, 'programada'), true);
  assert.equal(taskStatusAtTime({ status: 'programada', scheduledFor: task.scheduledFor }, now + 2 * 86400000), 'pendiente');
});

test('expired and blocked signals agree across state filters and board', () => {
  const overdue = { status: 'pendiente', isOverdue: true };
  assert.equal(visibleTaskStatus(overdue), 'vencida');
  assert.equal(matchesTaskStatus(overdue, 'vencida'), true);
  assert.equal(matchesTaskStatus(overdue, 'pendiente'), false);

  const blocked = { status: 'en_proceso', isBlocked: true, isOverdue: true };
  assert.equal(visibleTaskStatus(blocked), 'bloqueada');
  assert.equal(matchesTaskStatus(blocked, 'bloqueada'), true);
  assert.equal(matchesTaskStatus(blocked, 'vencida'), true);
});

test('finished tasks stay finished despite old risk flags', () => {
  const finished = { status: 'completada', isBlocked: true, isOverdue: true };
  assert.equal(visibleTaskStatus(finished), 'completada');
  assert.equal(matchesTaskStatus(finished, 'active'), false);
  assert.equal(matchesTaskStatus(finished, 'vencida'), false);
  assert.equal(matchesTaskStatus(finished, 'all'), true);
});
