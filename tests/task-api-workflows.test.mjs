import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const taskId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const ownerId = '33333333-3333-4333-8333-333333333333';
const memberId = '44444444-4444-4444-8444-444444444444';
const documentId = '66666666-6666-4666-8666-666666666666';

const authPlugin = {
  name: 'task-test-auth',
  setup(plugin) {
    plugin.onResolve({ filter: /^@\/lib\/tasks\/server$/ }, () => ({ path: 'task-test-auth', namespace: 'task-test' }));
    plugin.onLoad({ filter: /.*/, namespace: 'task-test' }, () => ({
      contents: 'export const authorizeTaskRequest = async () => globalThis.__taskTestAuth;',
      loader: 'js',
    }));
    plugin.onResolve({ filter: /^@\// }, args => ({ path: path.resolve('src', args.path.slice(2)) + '.ts' }));
  },
};

await Promise.all([
  ['src/app/api/tareas/route.ts', 'task-create-route-test.cjs'],
  ['src/app/api/tareas/[taskId]/action/route.ts', 'task-action-route-test.cjs'],
].map(([entry, output]) => build({
  entryPoints: [entry], outfile: `node_modules/.cache/${output}`, bundle: true,
  platform: 'node', format: 'cjs', plugins: [authPlugin],
})));
const createRoute = require('../node_modules/.cache/task-create-route-test.cjs');
const actionRoute = require('../node_modules/.cache/task-action-route-test.cjs');

function database(seed = {}) {
  const rows = Object.fromEntries(Object.entries(seed).map(([table, records]) =>
    [table, records.map(record => ({ ...record }))]));
  let sequence = 0;
  function from(table) {
    let operation = 'select';
    let payload;
    const filters = [];
    let maximum = Infinity;
    const query = {
      select() { return query; },
      eq(key, value) { filters.push(row => row[key] === value); return query; },
      neq(key, value) { filters.push(row => row[key] !== value); return query; },
      gte(key, value) { filters.push(row => row[key] >= value); return query; },
      in(key, values) { filters.push(row => values.includes(row[key])); return query; },
      not(key, operator, value) {
        assert.equal(operator, 'is');
        filters.push(row => row[key] !== value);
        return query;
      },
      limit(value) { maximum = value; return query; },
      insert(value) { operation = 'insert'; payload = value; return query; },
      update(value) { operation = 'update'; payload = value; return query; },
      maybeSingle() { return Promise.resolve(execute(true)); },
      single() { return Promise.resolve(execute(true)); },
      then(resolve, reject) { return Promise.resolve(execute(false)).then(resolve, reject); },
    };
    function execute(single) {
      rows[table] ||= [];
      if (operation === 'insert') {
        const inserted = { id: `99999999-9999-4999-8999-${String(++sequence).padStart(12, '0')}`,
          created_at: new Date().toISOString(), ...payload };
        rows[table].push(inserted);
        return { data: single ? inserted : [inserted], error: null };
      }
      const matching = rows[table].filter(row => filters.every(filter => filter(row))).slice(0, maximum);
      if (operation === 'update') matching.forEach(row => Object.assign(row, payload));
      return { data: single ? matching[0] || null : matching, error: null };
    }
    return query;
  }
  return { rows, from };
}

function setup({ role = 'owner', actor = ownerId, organization = false, task = {} } = {}) {
  const service = database({
    tareas: [{ id: taskId, workspace_id: workspaceId, created_by: ownerId,
      assigned_to: memberId, title: 'Revisar contrato', tipo: 'revisar_documento',
      estado: 'pendiente', prioridad: 'media', origin: 'manual', source_type: 'document',
      source_id: documentId, document_id: documentId, created_at: '2026-10-01T00:00:00Z', ...task }],
    workspaces: [{ id: workspaceId, organization_enabled: organization, workspace_type: organization ? 'organization' : 'personal', owner_id: ownerId }],
    workspace_members: [ownerId, memberId].map(user_id => ({ workspace_id: workspaceId, user_id, status: 'active' })),
    user_profiles: [{ id: ownerId, full_name: 'Propietaria', email: 'owner@example.com' },
      { id: memberId, full_name: 'Integrante', email: 'member@example.com' }],
    documentos: [{ id: documentId, workspace_id: workspaceId, nombre: 'Contrato', estado: 'en_proceso' }],
  });
  globalThis.__taskTestAuth = { service, scoped: service, user: { id: actor, email: 'owner@example.com' }, role };
  return service.rows;
}

function action(actionName, extra = {}) {
  return actionRoute.POST(new Request('http://localhost/api/tareas/action', {
    method: 'POST', body: JSON.stringify({ workspaceId, action: actionName, ...extra }),
  }), { params: Promise.resolve({ taskId }) });
}

test('a personal workspace cannot reassign, even when the actor owns the task', async () => {
  const rows = setup();
  const response = await action('reassign', { assigneeId: ownerId });
  assert.equal(response.status, 403);
  assert.equal(rows.tareas[0].assigned_to, memberId);
});

test('an organization admin reassigns to an active member and records the change', async () => {
  const rows = setup({ organization: true, role: 'admin' });
  const response = await action('reassign', { assigneeId: ownerId });
  assert.equal(response.status, 200);
  assert.equal(rows.tareas[0].assigned_to, ownerId);
  assert.equal(rows.notifications[0].user_id, ownerId);
  assert.match(rows.task_history[0].action, /reasignada/);
});

test('an unrelated organization member cannot act on another person’s task', async () => {
  setup({ organization: true, role: 'member', actor: memberId,
    task: { assigned_to: ownerId } });
  assert.equal((await action('remind')).status, 403);
});

test('a reminder is delivered once and rate-limited for 24 hours', async () => {
  const rows = setup({ actor: memberId, role: 'member' });
  assert.equal((await action('remind')).status, 200);
  assert.equal(rows.notifications.length, 1);
  assert.equal(rows.notifications[0].user_id, memberId);
  assert.equal((await action('remind')).status, 429);
  assert.equal(rows.notifications.length, 1);
});

test('manual review requires a recorded result before closing', async () => {
  const rows = setup({ actor: memberId, role: 'member' });
  assert.equal((await action('complete')).status, 400);
  assert.equal(rows.tareas[0].estado, 'pendiente');
  assert.equal((await action('complete', { reason: 'Revisé el contrato y confirmé sus datos.' })).status, 200);
  assert.equal(rows.tareas[0].estado, 'completada');
  assert.match(rows.tareas[0].resolution_note, /Revisé el contrato/);
});

test('a system-generated task cannot be closed without resolving its source', async () => {
  const rows = setup({ task: { origin: 'sistema', automation_key: 'draft_stale' } });
  assert.equal((await action('complete')).status, 409);
  assert.equal(rows.tareas[0].estado, 'pendiente');
});

test('a draft task closes only after the linked document leaves draft', async () => {
  const rows = setup({ actor: memberId, role: 'member',
    task: { tipo: 'retomar_borrador' } });
  rows.documentos[0].estado = 'borrador';
  assert.equal((await action('complete')).status, 409);
  rows.documentos[0].estado = 'en_proceso';
  assert.equal((await action('complete')).status, 200);
  assert.equal(rows.tareas[0].estado, 'completada');
});

test('cancellation requires a manager and an auditable reason', async () => {
  const rows = setup({ actor: memberId, role: 'member' });
  assert.equal((await action('cancel', { reason: 'Ya no se necesita.' })).status, 400);
  assert.equal(rows.tareas[0].estado, 'pendiente');
  globalThis.__taskTestAuth.role = 'owner';
  globalThis.__taskTestAuth.user.id = ownerId;
  assert.equal((await action('cancel', { reason: 'Ya no se necesita.' })).status, 200);
  assert.equal(rows.tareas[0].estado, 'cancelada');
  assert.match(rows.task_history[0].action, /Ya no se necesita/);
});

test('task creation uses an accessible resource and rejects cross-role assignment', async () => {
  const rows = setup({ role: 'member', actor: memberId, organization: true });
  const input = { workspaceId, sourceKind: 'document', sourceId: documentId,
    workKind: 'actividad', type: 'revisar_documento', assigneeId: ownerId };
  const post = body => createRoute.POST(new Request('http://localhost/api/tareas', {
    method: 'POST', body: JSON.stringify(body),
  }));
  assert.equal((await post(input)).status, 403);
  assert.equal(rows.tareas.length, 1);
  assert.equal((await post({ ...input, assigneeId: memberId })).status, 200);
  assert.equal(rows.tareas.length, 2);
  assert.equal(rows.tareas[1].source_id, documentId);
  assert.equal(rows.tareas[1].assigned_to, memberId);
});
