import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  stdin: {
    contents:
      "export * from './src/lib/case-files/saved-filters';export * from './src/lib/case-files/saved-filters-client';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const {
  EMPTY_CASE_FILTERS,
  buildSavedCaseFilter,
  readSavedCaseFilters,
  sameCaseFilters,
  caseFilterViewKey,
  loadSavedCaseFilters,
  persistSavedCaseFilters,
  configuredCaseCriteria,
  removeCaseCriterion,
  reorderCaseCriteria,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const workspace = '11111111-1111-4111-8111-111111111111',
  otherWorkspace = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const fixture = () => ({
  id,
  name: 'Privados en seguimiento',
  description: 'Revisión diaria',
  icon: 'folder',
  filters: { ...EMPTY_CASE_FILTERS, scope: 'active', access: 'private', query: ' Contrato ' },
});
test('saved filters round-trip every supported criterion and normalize search whitespace', () => {
  const filter = buildSavedCaseFilter(
    {
      ...fixture(),
      filters: {
        type: id,
        status: 'open',
        scope: 'mine',
        query: ' Folio ',
        priority: 'high',
        tag: 'Fiscal',
        access: 'private',
        from: '2026-11-01',
        to: '2026-11-14',
        scheduled: true,
        sort: 'name',
      },
    },
    []
  );
  assert.equal(filter.filters.query, 'Folio');
  assert.deepEqual(readSavedCaseFilters(JSON.parse(JSON.stringify([filter]))), [filter]);
  assert.ok(sameCaseFilters(filter.filters, { ...filter.filters, query: ' Folio ' }));
  assert.ok(!sameCaseFilters(filter.filters, { ...filter.filters, access: 'public' }));
});
test('empty filters, duplicate names, invalid dates and unsupported values cannot be saved', () => {
  const existing = buildSavedCaseFilter(fixture(), []);
  assert.throws(() => buildSavedCaseFilter({ ...fixture(), name: ' ' }, []), /nombre/);
  assert.throws(
    () => buildSavedCaseFilter({ ...fixture(), filters: EMPTY_CASE_FILTERS }, []),
    /criterio/
  );
  assert.throws(
    () =>
      buildSavedCaseFilter({ ...fixture(), id: workspace, name: 'PRIVADOS EN SEGUIMIENTO' }, [
        existing,
      ]),
    /nombre/
  );
  for (const patch of [
    { status: 'approved' },
    { scope: 'admin' },
    { access: 'anonymous' },
    { priority: 'none' },
    { type: 'not-a-uuid' },
    { from: '2026-02-30' },
    { from: '2026-11-14', to: '2026-11-01' },
  ])
    assert.throws(() =>
      buildSavedCaseFilter({ ...fixture(), filters: { ...fixture().filters, ...patch } }, [])
    );
  assert.doesNotThrow(() =>
    buildSavedCaseFilter({ ...existing, name: 'Nombre actualizado' }, [existing])
  );
});
test('malformed stored criteria are ignored rather than applied as an unfiltered list', () => {
  const good = buildSavedCaseFilter(fixture(), []);
  assert.deepEqual(
    readSavedCaseFilters([
      good,
      null,
      { ...good, id: workspace, filters: { status: 'obsolete' } },
      { ...good, name: 'Duplicado' },
    ]),
    [good]
  );
  assert.deepEqual(readSavedCaseFilters({ filters: [good] }), []);
});

test('emoji and criterion order persist while existing icon filters remain compatible', () => {
  const legacy = buildSavedCaseFilter(fixture(), []);
  assert.deepEqual(readSavedCaseFilters([legacy]), [legacy]);
  const custom = buildSavedCaseFilter(
    { ...fixture(), emoji: '🔥', criteria: ['access', 'scope', 'query'] },
    []
  );
  assert.deepEqual(readSavedCaseFilters(JSON.parse(JSON.stringify([custom]))), [custom]);
  assert.deepEqual(configuredCaseCriteria(custom.filters, custom.criteria), [
    'access',
    'scope',
    'query',
  ]);
});
test('removing and reordering criterion rows preserves the remaining values and original list', () => {
  const values = { ...fixture().filters, from: '2026-11-01', to: '2026-11-14' };
  assert.deepEqual(removeCaseCriterion(values, 'dates'), { ...values, from: '', to: '' });
  assert.equal(removeCaseCriterion(values, 'access').scope, 'active');
  assert.equal(removeCaseCriterion(values, 'access').access, '');
  const order = ['scope', 'access', 'dates'];
  assert.deepEqual(reorderCaseCriteria(order, 0, 2), ['access', 'dates', 'scope']);
  assert.deepEqual(order, ['scope', 'access', 'dates']);
  assert.deepEqual(reorderCaseCriteria(order, 0, -1), order);
});
function preferencesClient() {
  const records = new Map();
  let fail = false;
  const client = {
    from(table) {
      assert.equal(table, 'user_view_preferences');
      let user, key;
      return {
        select() {
          return this;
        },
        eq(field, value) {
          if (field === 'user_id') user = value;
          if (field === 'view_key') key = value;
          return this;
        },
        upsert(payload, options) {
          assert.equal(options.onConflict, 'user_id,view_key');
          user = payload.user_id;
          key = payload.view_key;
          if (!fail)
            records.set(`${user}:${key}`, {
              ...(records.get(`${user}:${key}`) || {}),
              ...structuredClone(payload),
            });
          return this;
        },
        async maybeSingle() {
          return {
            data: records.get(`${user}:${key}`) || null,
            error: fail ? new Error('offline') : null,
          };
        },
        async single() {
          return this.maybeSingle();
        },
      };
    },
  };
  return {
    client,
    records,
    setFailure(value) {
      fail = value;
    },
  };
}
test('persistence survives a new client read and stays separate by user, workspace and document preferences', async () => {
  const f = preferencesClient(),
    filter = buildSavedCaseFilter(fixture(), []);
  f.records.set('alice:mi_espacio_v1', {
    custom_filters: [{ id: 'document-filter' }],
    columns_config: ['name'],
  });
  assert.deepEqual(await loadSavedCaseFilters(f.client, 'alice', workspace), []);
  await persistSavedCaseFilters(f.client, 'alice', workspace, [filter]);
  assert.deepEqual(await loadSavedCaseFilters(f.client, 'alice', workspace), [filter]);
  assert.deepEqual(await loadSavedCaseFilters(f.client, 'bob', workspace), []);
  assert.deepEqual(await loadSavedCaseFilters(f.client, 'alice', otherWorkspace), []);
  assert.deepEqual(f.records.get('alice:mi_espacio_v1').custom_filters, [
    { id: 'document-filter' },
  ]);
  assert.notEqual(caseFilterViewKey(workspace), caseFilterViewKey(otherWorkspace));
});
test('edits and removal preserve the other filters and report storage failures', async () => {
  const f = preferencesClient(),
    first = buildSavedCaseFilter(fixture(), []),
    second = buildSavedCaseFilter({ ...fixture(), id: workspace, name: 'Otro filtro' }, []);
  await persistSavedCaseFilters(f.client, 'alice', workspace, [first, second]);
  await persistSavedCaseFilters(f.client, 'alice', workspace, [
    { ...first, name: 'Renombrado' },
    second,
  ]);
  assert.equal((await loadSavedCaseFilters(f.client, 'alice', workspace))[0].name, 'Renombrado');
  await persistSavedCaseFilters(f.client, 'alice', workspace, [second]);
  assert.deepEqual(await loadSavedCaseFilters(f.client, 'alice', workspace), [second]);
  f.setFailure(true);
  await assert.rejects(persistSavedCaseFilters(f.client, 'alice', workspace, []), /guardar/);
  await assert.rejects(loadSavedCaseFilters(f.client, 'alice', workspace), /cargar/);
  f.setFailure(false);
  assert.deepEqual(await loadSavedCaseFilters(f.client, 'alice', workspace), [second]);
});

test('category, subtype and responsible criteria persist with urgency independently of sidebar scope', () => {
  const filter = buildSavedCaseFilter(
    {
      ...fixture(),
      filters: {
        ...EMPTY_CASE_FILTERS,
        category: 'Clientes',
        subtype: 'Alta de cliente',
        responsible: 'me',
        priority: 'urgent',
        scope: 'active',
      },
    },
    []
  );
  assert.deepEqual(readSavedCaseFilters(JSON.parse(JSON.stringify([filter]))), [filter]);
  assert.ok(configuredCaseCriteria(filter.filters).includes('responsible'));
  assert.equal(removeCaseCriterion(filter.filters, 'responsible').scope, 'active');
});
