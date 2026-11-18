import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const output = await build({
  entryPoints: ['src/lib/case-files/folders.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { addCaseFolder, moveCaseToFolder, caseFolderKey, loadCaseFolders, saveCaseFolders } =
  await import(
    `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`
  );
const a = '11111111-1111-4111-8111-111111111111',
  b = '22222222-2222-4222-8222-222222222222',
  c = '33333333-3333-4333-8333-333333333333';
test('folders validate duplicate names and move a case without duplicating its membership', () => {
  const first = addCaseFolder([], {
    id: a,
    name: ' Contratos ',
    description: '2026',
    caseIds: [c],
  });
  const both = addCaseFolder(first, { id: b, name: 'Proveedores', description: '', caseIds: [] });
  const moved = moveCaseToFolder(both, c, b);
  assert.deepEqual(first[0].caseIds, [c]);
  assert.deepEqual(
    moved.map((f) => f.caseIds),
    [[], [c]]
  );
  assert.deepEqual(
    moveCaseToFolder(moved, c, '').map((f) => f.caseIds),
    [[], []]
  );
  assert.throws(() =>
    addCaseFolder(both, { id: c, name: 'CONTRATOS', description: '', caseIds: [] })
  );
  assert.throws(() => moveCaseToFolder(both, c, c));
  assert.throws(() => addCaseFolder([], { id: a, name: ' ', description: '', caseIds: [] }));
});
test('folder persistence isolates users and workspaces and preserves document/filter preferences', async () => {
  const rows = new Map();
  const client = {
    from(table) {
      assert.equal(table, 'user_view_preferences');
      let user, key, payload;
      return {
        select() {
          return this;
        },
        eq(k, v) {
          if (k === 'user_id') user = v;
          else if (k === 'view_key') key = v;
          return this;
        },
        upsert(p) {
          payload = p;
          return this;
        },
        async single() {
          rows.set(`${payload.user_id}:${payload.view_key}`, payload);
          return { data: payload, error: null };
        },
        async maybeSingle() {
          return { data: rows.get(`${user}:${key}`) || null, error: null };
        },
      };
    },
  };
  const value = [{ id: c, name: 'Contratos', description: '2026', caseIds: [a] }];
  await saveCaseFolders(client, a, b, value);
  assert.deepEqual(await loadCaseFolders(client, a, b), value);
  assert.deepEqual(await loadCaseFolders(client, b, b), []);
  assert.deepEqual(await loadCaseFolders(client, a, c), []);
  assert.equal(rows.size, 1);
  assert.notEqual(caseFolderKey(b), `mis_expedientes_v1:${b}`);
  assert.throws(() => caseFolderKey('invalid'));
});
