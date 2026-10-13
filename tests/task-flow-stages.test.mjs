import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
await build({ entryPoints: ['src/lib/tasks/flow-stages.ts'],
  outfile: 'node_modules/.cache/task-flow-stages-test.cjs', bundle: true,
  platform: 'node', format: 'cjs' });
const { flowStagesError, newFlowStage } = require('../node_modules/.cache/task-flow-stages-test.cjs');

test('a decision may branch forward to a later stage', () => {
  const first = { ...newFlowStage(), nextTrue: 2, nextFalse: 3 };
  const second = { ...newFlowStage(), field: 'priority', value: 'alta', onTrue: ['raise_priority'], onFalse: [] };
  const third = { ...newFlowStage(), field: 'overdue', value: 'true', onTrue: ['create_followup'], onFalse: [] };
  assert.equal(flowStagesError([first, second, third], 'task'), null);
});

test('cycles, unsupported resource actions and invalid thresholds are rejected', () => {
  assert.match(flowStagesError([{ ...newFlowStage(), nextTrue: 1 }], 'task'), /posterior/);
  assert.match(flowStagesError([{ ...newFlowStage(), onTrue: ['raise_priority'] }], 'document'), /prioridad/);
  assert.match(flowStagesError([{ ...newFlowStage(), field: 'inactive_days', operator: 'gte', value: '0' }], 'task'), /1 y 90/);
});
