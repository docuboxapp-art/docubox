import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

async function moduleFrom(path) {
  const built = await build({
    entryPoints: [path],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
  );
}
const {
  normalizeDocumentColumns,
  normalizeDocumentView,
  loadDocumentView,
  saveDocumentView,
  DEFAULT_DOCUMENT_VIEW,
  DOCUMENT_VIEW_KEY,
} = await moduleFrom('src/app/mis-documentos/components/view-config.ts');
const { normalizeCaseView } = await moduleFrom('src/lib/case-files/view-preferences.ts');
const { caseResponsibleIds, casePeopleNames } = await moduleFrom(
  'src/lib/case-files/list-people.ts'
);
const { compareCatalogRows, compareListDates, compareTableValues, DEFAULT_CATALOG_SORT } = await moduleFrom(
  'src/lib/workspaces/list-order.ts'
);
const { caseListOrder, caseOrderOptions } = await moduleFrom('src/lib/case-files/consultation-order.ts');
const { moveViewColumn } = await moduleFrom('src/lib/workspaces/view-order.ts');

test('new and existing accounts with untouched document defaults receive the requested table', () => {
  const oldOrder = [
    'numeroDocumento',
    'folioInterno',
    'estado',
    'estadoParticipacion',
    'etiquetas',
    'tamano',
    'ultimaModificacion',
    'propietario',
    'fechaCreacion',
    'fechaCompletado',
    'tipoDocumento',
    'fechaVencimiento',
    'rutaGuardado',
    'prioridad',
  ];
  const oldVisible = [
    'numeroDocumento',
    'estado',
    'etiquetas',
    'tamano',
    'ultimaModificacion',
    'propietario',
  ];
  const old = oldOrder.map((id) => ({ id, visible: oldVisible.includes(id) }));
  const expected = [
    'propietario',
    'estado',
    'estadoParticipacion',
    'fechaCreacion',
    'fechaCompletado',
  ];
  for (const raw of [undefined, [], old]) {
    assert.deepEqual(
      normalizeDocumentColumns(raw)
        .filter((c) => c.visible)
        .map((c) => c.id),
      expected
    );
  }
  const customized = old.map((c) => (c.id === 'tamano' ? { ...c, visible: false } : c));
  assert.equal(
    normalizeDocumentColumns(customized).find((c) => c.id === 'fechaCreacion').visible,
    false
  );
  assert.deepEqual(
    normalizeDocumentColumns(normalizeDocumentColumns(old)),
    normalizeDocumentColumns(old)
  );
});

test('case defaults include both people columns and upgrade only the untouched old layout', () => {
  const oldOrder = [
    'type',
    'participant',
    'status',
    'progress',
    'updated',
    'category',
    'priority',
    'folio',
    'owner',
    'created',
    'due',
    'access',
    'tags',
  ];
  const old = oldOrder.map((id, index) => ({ id, visible: index < 5 }));
  const expected = [
    'type',
    'participant',
    'responsible',
    'issuer',
    'status',
    'progress',
    'updated',
  ];
  for (const raw of [null, { columns: old }]) {
    assert.deepEqual(
      normalizeCaseView(raw)
        .columns.filter((c) => c.visible)
        .map((c) => c.id),
      expected
    );
  }
  const custom = normalizeCaseView({
    columns: [
      { id: 'owner', visible: false },
      { id: 'priority', visible: true },
    ],
  });
  assert.equal(custom.columns[0].id, 'issuer');
  assert.equal(custom.columns[0].visible, false);
  assert.equal(custom.columns[1].id, 'priority');
  assert.deepEqual(normalizeCaseView(custom), custom);
});

test('issuer stays distinct from delegated responsible people and reassigned reviewers', () => {
  const ids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
  ];
  const source = {
    owner_user_id: ids[0],
    created_by: ids[1],
    runtime_assignments: {
      approver: ids[2],
      closer: ids[2],
      reviewers: { old: ids[1] },
      untrusted: 'not-an-id',
    },
  };
  assert.deepEqual(caseResponsibleIds(source, [ids[3], ids[3], null]), [ids[0], ids[2], ids[3]]);
  const names = casePeopleNames(
    source,
    [ids[3]],
    ids.map((id, index) => ({
      id,
      full_name: ['Administrador', 'Emisor', 'Aprobador', 'Revisor actual'][index],
    }))
  );
  assert.equal(names.issuerName, 'Emisor');
  assert.deepEqual(names.responsibleNames, ['Administrador', 'Aprobador', 'Revisor actual']);
  assert.equal(
    casePeopleNames({ ...source, created_by: null }, [], []).issuerName,
    'Sin especificar'
  );
});

test('a missing or partially configured document view uses defaults only for unspecified fields', () => {
  assert.deepEqual(normalizeDocumentView(null), DEFAULT_DOCUMENT_VIEW);
  const view = normalizeDocumentView({
    columns: [
      { id: 'prioridad', visible: true },
      { id: 'propietario', visible: false },
    ],
    filters: [
      { id: 'prioridad', label: 'Untrusted label', visible: true },
      { id: 'estado', visible: false },
      { id: 'prioridad', visible: false },
      { id: 'unknown', visible: true },
    ],
    gridColumns: [
      { id: 'estado', selected: false, order: 2 },
      { id: 'prioridad', selected: true, order: 1 },
    ],
  });
  assert.deepEqual(
    view.columns.slice(0, 2).map(({ id, visible }) => [id, visible]),
    [
      ['prioridad', true],
      ['propietario', false],
    ]
  );
  assert.deepEqual(view.filters.slice(0, 2), [
    { id: 'prioridad', label: 'Prioridad', visible: true },
    { id: 'estado', label: 'Estado', visible: false },
  ]);
  assert.equal(view.filters.length, DEFAULT_DOCUMENT_VIEW.filters.length);
  assert.deepEqual(
    view.gridColumns.slice(0, 2).map(({ id, order, selected }) => [id, order, selected]),
    [
      ['prioridad', 1, true],
      ['estado', 2, false],
    ]
  );
  assert.deepEqual(normalizeDocumentView(view), view);
});

test('document view saves columns, filters and grid together and keeps filters saved separately', async () => {
  const savedFilter = { id: 'private-filter', nombre: 'Mis contratos' };
  const rows = new Map([['existing', { custom_filters: [savedFilter] }]]);
  let writes = 0;
  let unavailable = false;
  const client = {
    from(table) {
      assert.equal(table, 'user_view_preferences');
      let user;
      let payload;
      return {
        select() {
          return this;
        },
        eq(key, value) {
          if (key === 'user_id') user = value;
          else assert.deepEqual([key, value], ['view_key', DOCUMENT_VIEW_KEY]);
          return this;
        },
        upsert(value, options) {
          assert.equal(options.onConflict, 'user_id,view_key');
          assert.equal(value.view_key, DOCUMENT_VIEW_KEY);
          payload = value;
          return this;
        },
        async maybeSingle() {
          return unavailable ? { error: { code: 'DOWN' } } : { data: rows.get(user) ?? null };
        },
        async single() {
          if (unavailable) return { error: { code: 'DOWN' } };
          const data = { ...rows.get(payload.user_id), ...payload };
          rows.set(payload.user_id, data);
          writes++;
          return { data };
        },
      };
    },
  };
  assert.deepEqual(await loadDocumentView(client, 'new'), {
    view: DEFAULT_DOCUMENT_VIEW,
    customFilters: [],
  });
  assert.deepEqual(await loadDocumentView(client, 'existing'), {
    view: DEFAULT_DOCUMENT_VIEW,
    customFilters: [savedFilter],
  });
  const custom = normalizeDocumentView({
    columns: [{ id: 'prioridad', visible: true }],
    filters: [{ id: 'etiquetas', visible: true }],
    gridColumns: [{ id: 'etiquetas', order: 1, selected: false }],
  });
  assert.deepEqual(await saveDocumentView(client, 'existing', custom), custom);
  assert.equal(writes, 1);
  assert.deepEqual(await loadDocumentView(client, 'existing'), {
    view: custom,
    customFilters: [savedFilter],
  });
  assert.deepEqual((await loadDocumentView(client, 'new')).view, DEFAULT_DOCUMENT_VIEW);
  await saveDocumentView(client, 'existing', DEFAULT_DOCUMENT_VIEW);
  assert.deepEqual(await loadDocumentView(client, 'existing'), {
    view: DEFAULT_DOCUMENT_VIEW,
    customFilters: [savedFilter],
  });
  unavailable = true;
  await assert.rejects(loadDocumentView(client, 'existing'), /cargar/);
  await assert.rejects(saveDocumentView(client, 'existing', custom), /guardar/);
  assert.equal(writes, 2);
});

test('catalogs explicitly start with recent records, resolve ties and place missing dates last', () => {
  const immediate = '2026-11-24T12:00:00Z';
  const records = [
    { id: 'b', name: 'Acta', updated_at: immediate },
    { id: 'd', name: 'Convenio', updated_at: '2026-11-12T12:00:00Z' },
    { id: 'e', name: 'Aviso', updated_at: 'invalid' },
    { id: 'c', name: 'Contrato', updated_at: '2026-11-24T05:00:00-07:00' },
    { id: 'a', name: 'Acta', updated_at: immediate },
  ];
  const order = (sort) =>
    records
      .toSorted((a, b) => compareCatalogRows(a, b, sort, (item) => item.name))
      .map((row) => row.id);
  assert.deepEqual(order(DEFAULT_CATALOG_SORT), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(order('updated_asc'), ['d', 'a', 'b', 'c', 'e']);
  assert.deepEqual(order('name_desc'), ['d', 'c', 'e', 'a', 'b']);
  assert.ok(compareListDates(null, immediate, 'asc') > 0);
  assert.ok(compareListDates(null, immediate, 'desc') > 0);
});

test('sortable catalog columns compare numbers and keep unavailable values last', () => {
  const rows = [
    { id: 'a', name: 'Sin datos', responses: null },
    { id: 'b', name: 'Formulario 10', responses: 10 },
    { id: 'c', name: 'Formulario 2', responses: 2 },
  ];
  const sorted = (sort) => rows.toSorted((left, right) =>
    compareCatalogRows(left, right, sort, (row) => row.name, { responses: (row) => row.responses })
  ).map((row) => row.id);
  assert.deepEqual(sorted('responses_asc'), ['c', 'b', 'a']);
  assert.deepEqual(sorted('responses_desc'), ['b', 'c', 'a']);
  assert.ok(compareTableValues('Expediente 2', 'Expediente 10', 'asc') < 0);
  assert.ok(compareTableValues(Number.NaN, 0, 'desc') > 0);
});

test('case sort keeps the contextual date and resolves only catalogued server columns', () => {
  assert.deepEqual(caseListOrder('oldest', 'closed_at'), { field: 'closed_at', ascending: true });
  assert.deepEqual(caseListOrder('recent', 'created_at'), { field: 'created_at', ascending: false });
  assert.deepEqual(caseListOrder('name_desc', 'created_at'), { field: 'title', ascending: false });
  assert.deepEqual(caseListOrder('progress_asc', 'created_at'), { field: 'progress', ascending: true });
  assert.deepEqual(caseListOrder('unexpected', 'created_at'), { field: 'created_at', ascending: false });
  assert.equal(new Set(caseOrderOptions.map((option) => option.id)).size, caseOrderOptions.length);
});

test('moving visible columns preserves hidden fields and never inserts a fixed action column', () => {
  const columns = [
    { id: 'type', visible: true },
    { id: 'folio', visible: false },
    { id: 'status', visible: true },
    { id: 'updated', visible: true },
  ];
  const moved = moveViewColumn(columns, 'updated', 'type');
  assert.deepEqual(moved.map(({ id }) => id), ['updated', 'type', 'folio', 'status']);
  assert.equal(moved.find(({ id }) => id === 'folio').visible, false);
  assert.equal(moveViewColumn(moved, 'type', 'actions'), null);
  assert.equal(moveViewColumn(moved, 'title', 'type'), null);
  assert.deepEqual(columns.map(({ id }) => id), ['type', 'folio', 'status', 'updated']);
});
