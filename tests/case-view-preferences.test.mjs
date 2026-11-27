import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const built = await build({
  entryPoints: ['src/lib/case-files/view-preferences.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const {
  normalizeCaseView,
  caseViewKey,
  loadCaseView,
  saveCaseColumnWidths,
  saveCaseView,
  CASE_VIEW_COLUMNS,
  CASE_VIEW_FILTERS,
} = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
);
const user = '11111111-1111-4111-8111-111111111111',
  workspace = '22222222-2222-4222-8222-222222222222',
  other = '33333333-3333-4333-8333-333333333333';
const clientFixture = () => {
  const rows = new Map();
  let fail = false;
  return {
    rows,
    fail: () => {
      fail = true;
    },
    client: {
      from(table) {
        assert.equal(table, 'user_view_preferences');
        let id, key, payload;
        const save = async () => {
          if (fail) return { data: null, error: {} };
          const rowKey = payload.user_id + ':' + payload.view_key;
          const updated = { ...rows.get(rowKey), ...payload };
          rows.set(rowKey, updated);
          return { data: updated, error: null };
        };
        return {
          select() {
            return this;
          },
          eq(k, v) {
            if (k === 'user_id') id = v;
            else if (k === 'view_key') key = v;
            return this;
          },
          upsert(p, options) {
            assert.equal(options.onConflict, 'user_id,view_key');
            assert.equal(options.defaultToNull, false);
            payload = p;
            return this;
          },
          async maybeSingle() {
            return { data: rows.get(id + ':' + key) || null, error: fail ? {} : null };
          },
          single: save,
          then(resolve, reject) {
            return save().then(resolve, reject);
          },
        };
      },
    },
  };
};
test('case view preserves the saved order and visibility while rejecting obsolete ids and user labels', () => {
  const view = normalizeCaseView({
    columns: [
      { id: 'priority', label: 'Wrong label', visible: true },
      { id: 'participant', visible: false },
      { id: 'priority', visible: false },
      { id: 'nombre', visible: false },
    ],
    filters: [
      { id: 'priority', visible: true },
      { id: 'scheduled', visible: false },
    ],
  });
  assert.deepEqual(view.columns.slice(0, 2), [
    { id: 'priority', label: 'Prioridad', visible: true },
    { id: 'participant', label: 'Participante', visible: false },
  ]);
  assert.equal(view.columns.length, CASE_VIEW_COLUMNS.length);
  assert.equal(
    view.columns.some((c) => c.id === 'nombre'),
    false
  );
  assert.equal(view.filters[0].id, 'priority');
  assert.equal(view.filters[1].visible, false);
  assert.equal(view.filters.length, CASE_VIEW_FILTERS.length);
  assert.equal(normalizeCaseView(null).columns[0].id, 'type');
  assert.ok(CASE_VIEW_COLUMNS.every((c) => c.id !== 'nombre'));
});
test('grid selection keeps order and never exceeds five optional rows', () => {
  const view = normalizeCaseView({
    gridColumns: ['priority', 'status', 'type', 'participant', 'folio', 'category', 'owner'].map(
      (id) => ({ id, selected: true })
    ),
  });
  assert.deepEqual(
    view.gridColumns.filter((c) => c.selected).map((c) => c.id),
    ['priority', 'status', 'type', 'participant', 'folio']
  );
  assert.deepEqual(
    view.gridColumns.map((c) => c.order),
    view.gridColumns.map((_, index) => index)
  );
});
test('personalization round-trips across clients and isolates users, workspaces, saved filters and documents', async () => {
  const { rows, client } = clientFixture();
  rows.set(user + ':mi_espacio_v1', { custom_filters: ['document filter'] });
  rows.set(user + ':mis_expedientes_v1:' + workspace, { custom_filters: ['saved case filter'] });
  const view = normalizeCaseView({
    columns: [
      { id: 'priority', visible: true },
      { id: 'participant', visible: false },
    ],
    filters: [
      { id: 'priority', visible: true },
      { id: 'scheduled', visible: false },
    ],
  });
  await saveCaseView(client, user, workspace, view);
  assert.deepEqual(await loadCaseView(client, user, workspace), { view, widths: {} });
  const defaults = { view: normalizeCaseView(null), widths: {} };
  assert.deepEqual(await loadCaseView(client, other, workspace), defaults);
  assert.deepEqual(await loadCaseView(client, user, other), defaults);
  assert.deepEqual(rows.get(user + ':mi_espacio_v1').custom_filters, ['document filter']);
  assert.deepEqual(rows.get(user + ':mis_expedientes_v1:' + workspace).custom_filters, [
    'saved case filter',
  ]);
  assert.throws(() => caseViewKey('invalid'));
});
test('column widths preserve layout settings and are limited to the current user and workspace', async () => {
  const { client } = clientFixture();
  const view = normalizeCaseView({ columns: [{ id: 'participant', visible: false }] });
  await saveCaseView(client, user, workspace, view);
  await saveCaseColumnWidths(client, user, workspace, {
    title: 140,
    responsible: 265.8,
    type: 820,
    status: Infinity,
    actions: 200,
  });
  const widths = { title: 168, responsible: 266, type: 720 };
  assert.deepEqual(await loadCaseView(client, user, workspace), { view, widths });
  assert.deepEqual((await loadCaseView(client, other, workspace)).widths, {});
  assert.deepEqual((await loadCaseView(client, user, other)).widths, {});

  const restored = normalizeCaseView(null);
  await saveCaseView(client, user, workspace, restored);
  assert.deepEqual(await loadCaseView(client, user, workspace), { view: restored, widths });
});
test('all optional columns and filters can be hidden and defaults can be restored without stale settings', async () => {
  const { client } = clientFixture();
  const hidden = normalizeCaseView({
    columns: CASE_VIEW_COLUMNS.map((c) => ({ ...c, visible: false })),
    filters: CASE_VIEW_FILTERS.map((c) => ({ ...c, visible: false })),
  });
  await saveCaseView(client, user, workspace, hidden);
  assert.equal(
    (await loadCaseView(client, user, workspace)).view.columns.filter((c) => c.visible).length,
    0
  );
  assert.equal(
    (await loadCaseView(client, user, workspace)).view.filters.filter((c) => c.visible).length,
    0
  );
  await saveCaseView(client, user, workspace, normalizeCaseView(null));
  assert.deepEqual((await loadCaseView(client, user, workspace)).view, normalizeCaseView(null));
});
test('failed reads and saves report an error instead of accepting an unsaved personalization', async () => {
  const fixture = clientFixture();
  fixture.fail();
  await assert.rejects(() => loadCaseView(fixture.client, user, workspace), /cargar/);
  await assert.rejects(
    () => saveCaseView(fixture.client, user, workspace, normalizeCaseView(null)),
    /guardar/
  );
  await assert.rejects(() => saveCaseColumnWidths(fixture.client, user, workspace, {}), /guardar/);
});
