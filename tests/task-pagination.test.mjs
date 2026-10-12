import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
await build({
  entryPoints: ['src/lib/tasks/pagination.ts'],
  outfile: 'node_modules/.cache/task-pagination-test.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
});
const { fetchAllPages } = require('../node_modules/.cache/task-pagination-test.cjs');

test('reads tasks beyond the former 500-row cap without skipping a boundary', async () => {
  const tasks = Array.from({ length: 503 }, (_, index) => ({ id: `task-${index}` }));
  const calls = [];
  const result = await fetchAllPages((from, to) => {
    calls.push([from, to]);
    return Promise.resolve({ data: tasks.slice(from, to + 1), error: null });
  });
  assert.equal(result.length, 503);
  assert.equal(result[500].id, 'task-500');
  assert.deepEqual(calls, [
    [0, 199],
    [200, 399],
    [400, 599],
  ]);
});

test('a backend error stops loading instead of displaying a misleading partial list', async () => {
  await assert.rejects(
    fetchAllPages((from) =>
      Promise.resolve(
        from === 0
          ? { data: Array.from({ length: 200 }, (_, index) => ({ id: index })), error: null }
          : { data: null, error: { message: 'No se pudo consultar la página' } }
      )
    ),
    /No se pudo consultar la página/
  );
});
