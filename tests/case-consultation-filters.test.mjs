import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const actor = '11111111-1111-4111-8111-111111111111';
const workspace = '22222222-2222-4222-8222-222222222222';
const otherWorkspace = '33333333-3333-4333-8333-333333333333';
const completed = '44444444-4444-4444-8444-444444444444';
const open = '55555555-5555-4555-8555-555555555555';
const template = '66666666-6666-4666-8666-666666666666';
let filters = [];
let allowMembership = true;
let reviewerFixture = [];
const fixture = [
  {
    id: completed,
    workspace_id: workspace,
    case_type: 'Clientes',
    case_subtype: 'Alta de cliente',
    title: 'Expediente cerrado',
    folio: 'QA-1',
    template_id: template,
    owner_user_id: actor,
    status: 'sealed',
    tags: ['Fiscal'],
    priority: 'high',
    closed_at: '2026-11-12T13:00:00Z',
    created_at: '2026-10-01T00:00:00Z',
  },
  {
    id: open,
    workspace_id: workspace,
    case_type: 'Proveedores',
    case_subtype: 'Alta de proveedor',
    title: 'Expediente abierto',
    folio: 'QA-2',
    template_id: template,
    owner_user_id: actor,
    status: 'open',
    tags: [],
    priority: 'normal',
    closed_at: null,
    created_at: '2026-11-10T00:00:00Z',
  },
  {
    id: '77777777-7777-4777-8777-777777777777',
    workspace_id: otherWorkspace,
    title: 'No accesible',
    status: 'sealed',
    tags: ['Fiscal'],
    priority: 'high',
  },
];
globalThis.__caseConsultationService = {
  from(table) {
    let data =
      table === 'case_file_requirements' || table === 'case_file_forms' ? reviewerFixture : table === 'case_files'
        ? fixture
        : table === 'workspace_members'
          ? allowMembership
            ? [{ user_id: actor, workspace_id: workspace, role: 'owner', status: 'active' }]
            : []
          : table === 'user_view_preferences'
            ? [
                {
                  user_id: actor,
                  view_key: `mis_expedientes_carpetas_v1:${workspace}`,
                  custom_filters: [
                    { id: template, name: 'Carpeta', description: '', caseIds: [open] },
                  ],
                },
              ]
            : table === 'user_favorites'
              ? [{ user_id: actor, storage_key: `expedientes:${workspace}`, item_id: completed }]
              : [];
    let single = false;
    const orderBy = [];
    let pagination;
    const query = {
      select() {
        return this;
      },
      eq(key, value) {
        filters.push([table, 'eq', key, value]);
        data = data.filter((r) => r[key] === value);
        return this;
      },
      in(key, values) {
        filters.push([table, 'in', key, values]);
        data = data.filter((r) => values.includes(r[key]));
        return this;
      },
      contains(key, values) {
        data = data.filter((r) => values.every((v) => r[key]?.includes(v)));
        return this;
      },
      not(key, op, value) {
        if (op === 'in') data = data.filter((r) => !value.slice(1, -1).split(',').includes(r[key]));
        return this;
      },
      gte(key, value) {
        data = data.filter((r) => r[key] && r[key] >= value);
        return this;
      },
      lte(key, value) {
        data = data.filter((r) => r[key] && r[key] <= value);
        return this;
      },
      gt() {
        return this;
      },
      or(expression) {
        filters.push([table, 'or', expression]);
        if (expression.includes('owner_user_id.eq.')) {
          const alternatives = expression.split(/,(?![^()]*\))/);
          data = data.filter((row) => alternatives.some((alternative) => {
            const [field, op, ...rest] = alternative.split('.');
            const value = rest.join('.');
            const [base, nested] = field.split('->>');
            const actual = nested ? row[base]?.[nested] : row[field];
            return op === 'eq' ? actual === value : op === 'in' && value.slice(1, -1).split(',').includes(actual);
          }));
        }
        return this;
      },
      order(key, { ascending = true } = {}) {
        orderBy.push({ key, ascending });
        filters.push([table, 'order', key, ascending]);
        return this;
      },
      range(from, to) {
        pagination = [from, to + 1];
        filters.push([table, 'range', from, to]);
        return this;
      },
      maybeSingle() {
        single = true;
        return this;
      },
      then(resolve) {
        const sorted = data.toSorted((left, right) => {
          for (const { key, ascending } of orderBy) {
            if (left[key] == null && right[key] == null) continue;
            if (left[key] == null) return 1;
            if (right[key] == null) return -1;
            const comparison = left[key] < right[key] ? -1 : Number(left[key] > right[key]);
            if (comparison) return ascending ? comparison : -comparison;
          }
          return 0;
        });
        return Promise.resolve({
          data: single ? sorted[0] || null : pagination ? sorted.slice(...pagination) : sorted,
          error: null,
          count: data.length,
        }).then(resolve);
      },
    };
    return query;
  },
};
const bundle = await build({
  entryPoints: ['src/app/api/expedientes/consultar/route.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'isolated-case-api',
      setup(b) {
        b.onResolve(
          { filter: /^next\/server$|^server-only$|supabase\/server$|runtime\.server$/ },
          (args) => ({ path: args.path, namespace: 'case-mock' })
        );
        b.onLoad({ filter: /.*/, namespace: 'case-mock' }, (args) => ({
          contents:
            args.path === 'next/server'
              ? 'export class NextResponse { static json(body, init) { return Response.json(body,init); } }'
              : args.path === 'server-only'
                ? ''
                : args.path.endsWith('supabase/server')
                  ? 'export const createServiceClient = () => globalThis.__caseConsultationService;'
                  : `export class CaseRuntimeError extends Error { constructor(code,message,status){super(message);this.code=code;this.status=status;} }
           export const caseIdentity = async () => ({id:'${actor}'});
           export const isUuid = v => typeof v==='string' && /^[a-f0-9-]{36}$/.test(v);
           export const runtimeHeaders = {};
           export const runtimeFailure = e => ({status:e.status || 500,body:{error:e.message}});`,
          loader: 'js',
        }));
      },
    },
  ],
});
const { GET } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
async function request(extra = '') {
  filters = [];
  const response = await GET({
    nextUrl: new URL(
      `http://localhost/api/expedientes/consultar?workspaceId=${workspace}&${extra}`
    ),
  });
  return { status: response.status, body: await response.json() };
}
test('completed results are sealed instances of the selected type and workspace', async () => {
  const result = await request(`estado=sealed&tipo=${template}`);
  assert.equal(result.status, 200);
  assert.deepEqual(
    result.body.data.items.map((r) => r.id),
    [completed]
  );
  assert.ok(
    filters.some(
      ([table, , key, value]) =>
        table === 'case_files' && key === 'workspace_id' && value === workspace
    )
  );
});
test('choosing a case list header orders the authorized results before slicing pages', async () => {
  const first = await request('orden=name');
  assert.deepEqual(first.body.data.items.map(({ id }) => id), [open, completed]);
  assert.deepEqual(filters.filter(([table, operation]) => table === 'case_files' && ['order', 'range'].includes(operation)), [
    ['case_files', 'order', 'title', true],
    ['case_files', 'order', 'id', true],
    ['case_files', 'range', 0, 49],
  ]);
  const reverse = await request('orden=name_desc');
  assert.deepEqual(reverse.body.data.items.map(({ id }) => id), [completed, open]);
});
test('the requested case page size is bounded and is applied to the server range', async () => {
  const result = await request('page=3&size=100');
  assert.equal(result.status, 200);
  assert.equal(result.body.data.page, 3);
  assert.equal(result.body.data.pageSize, 100);
  assert.ok(filters.some(([table, operation, from, to]) =>
    table === 'case_files' && operation === 'range' && from === 200 && to === 299
  ));

  const invalid = await request('size=10000');
  assert.equal(invalid.body.data.pageSize, 50);
});
test('favorites are scoped to the actor and this workspace, with empty-safe filtering', async () => {
  const result = await request('vista=favorites');
  assert.deepEqual(
    result.body.data.items.map((r) => r.id),
    [completed]
  );
  assert.ok(
    filters.some(
      ([table, , key, value]) => table === 'user_favorites' && key === 'user_id' && value === actor
    )
  );
  assert.equal(result.body.data.items[0].favorite, true);
});
test('tag and priority are applied before pagination', async () => {
  const result = await request('etiqueta=Fiscal&prioridad=high');
  assert.deepEqual(
    result.body.data.items.map((r) => r.id),
    [completed]
  );
});
test('active view excludes sealed and cancelled instances', async () => {
  const result = await request('vista=active');
  assert.deepEqual(
    result.body.data.items.map((r) => r.id),
    [open]
  );
});

test('filter previews return only the matching count without loading case details', async () => {
  const result = await request('conteo=1&estado=sealed');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, { total: 1 });
  assert.ok(!filters.some(([table]) => table === 'case_file_participants'));
});
test('completed date range uses the closure date instead of the creation date', async () => {
  const result = await request('estado=sealed&fecha=cierre&desde=2026-11-12&hasta=2026-11-12');
  assert.deepEqual(
    result.body.data.items.map((r) => r.id),
    [completed]
  );
});
test('invalid status, priority, access, date and reversed ranges fail before the list query', async () => {
  for (const value of [
    'estado=approved',
    'prioridad=admin',
    'acceso=anonymous',
    'desde=2026-02-30',
    'desde=2026-11-12&hasta=2026-11-01',
    'vista=other',
  ]) {
    const result = await request(value);
    assert.equal(result.status, 422, value);
    assert.ok(!filters.some(([table]) => table === 'case_files'));
  }
});
test('expired or missing workspace membership prevents service-role list access', async () => {
  allowMembership = false;
  try {
    const result = await request();
    assert.equal(result.status, 403);
    assert.ok(!filters.some(([table]) => table === 'case_files'));
  } finally {
    allowMembership = true;
  }
});

test('category, subtype and responsible criteria combine before pagination', async () => {
  const result = await request('categoria=Clientes&subtipo=Alta%20de%20cliente&responsable=me');
  assert.equal(result.status, 200);
  assert.deepEqual(
    result.body.data.items.map((r) => r.id),
    [completed]
  );
  assert.ok(
    filters.some(
      ([table, op, expression]) =>
        table === 'case_files' && op === 'or' && expression.includes(`owner_user_id.eq.${actor}`)
    )
  );
  assert.equal(
    (await request('categoria=Clientes&subtipo=Alta%20de%20proveedor')).body.data.total,
    0
  );
  assert.equal((await request('responsable=other')).status, 422);
});

test('responsible filter includes current reviewers, approvers and closers, excluding former assignments', async () => {
  const record = fixture[1];
  const original = { ...record };
  try {
    record.owner_user_id = otherWorkspace;
    for (const role of ['approver', 'closer']) {
      record.runtime_assignments = { [role]: actor };
      assert.ok((await request('responsable=me')).body.data.items.some(row => row.id === open));
    }
    record.runtime_assignments = { reviewers: { stale: actor } };
    assert.ok(!(await request('responsable=me')).body.data.items.some(row => row.id === open));
    reviewerFixture = [{ workspace_id: workspace, case_file_id: open, reviewer_user_id: actor }];
    assert.ok((await request('responsable=me')).body.data.items.some(row => row.id === open));
    assert.ok(filters.some(([table, , key, value]) => table === 'case_file_requirements' && key === 'workspace_id' && value === workspace));
    assert.ok(filters.some(([table, , key, value]) => table === 'case_file_forms' && key === 'reviewer_user_id' && value === actor));
  } finally {
    delete record.runtime_assignments;
    Object.assign(record, original);
    reviewerFixture = [];
  }
});
test('folder membership is scoped to the actor and workspace before list pagination', async () => {
  const result = await request('carpeta=' + template);
  assert.equal(result.status, 200);
  assert.deepEqual(
    result.body.data.items.map((r) => r.id),
    [open]
  );
  assert.ok(
    filters.some(
      ([table, , key, value]) =>
        table === 'user_view_preferences' && key === 'user_id' && value === actor
    )
  );
  assert.equal((await request('carpeta=' + completed)).status, 422);
});
