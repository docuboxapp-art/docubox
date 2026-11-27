import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
await build({
  entryPoints: ['src/app/api/reportes/datos/route.ts'],
  bundle: true, platform: 'node', format: 'cjs', outfile: 'node_modules/.cache/report-data-route-qa.cjs',
  plugins: [{
    name: 'isolated-report-data',
    setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/supabase\/server$/ }, () => ({ path: 'fixture', namespace: 'reports-qa' }));
      builder.onLoad({ filter: /.*/, namespace: 'reports-qa' }, () => ({
        contents: "module.exports = { createAnonClient: () => globalThis.reportFixtures.scoped, createServiceClient: () => globalThis.reportFixtures.service };",
      }));
    },
  }],
});
const { GET } = require('../node_modules/.cache/report-data-route-qa.cjs');

test('reports validate the session and workspace before querying data, then read protected modules with the user token', async () => {
  const [actor, workspace, other, template, token] = Array.from({ length: 5 }, randomUUID);
  const now = new Date().toISOString();
  const touched = [];
  const submitted = {
    id: randomUUID(), template_id: template, token_id: token, workspace_id: workspace, status: 'signed',
    submitted_at: now, folio: 'QA', respondent_name: 'Persona sintética',
    response_data: { amount: 30, attachment: 'private-location', stray: 'unused-value' },
  };
  const storage = {
    workspace_members: [{ id: randomUUID(), workspace_id: workspace, user_id: actor, role: 'owner', status: 'active', access_expires_at: null }],
    workspaces: [{ id: workspace, owner_id: actor, workspace_type: 'personal' }],
    form_templates: [{ id: template, workspace_id: workspace, name: 'Cuestionario QA', created_by: actor,
      status: 'published', created_at: now, form_schema: { fields: [
        { id: 'amount', label: 'Importe', type: 'number' }, { id: 'attachment', label: 'Comprobante', type: 'documento' },
      ] } }],
    form_responses: [submitted, { ...submitted, id: randomUUID(), status: 'draft' },
      { ...submitted, id: randomUUID(), workspace_id: other }],
    form_tokens: [{ id: token, template_id: template, access_mode: 'private' }],
    tareas: [{ id: 'fixture', workspace_id: workspace, title: 'Tarea de prueba', estado: 'pendiente', created_at: now }],
  };
  function from(role, table) {
    touched.push({ role, table });
    let rows = storage[table] || [];
    let head = false;
    const result = () => ({ data: head ? null : rows, count: rows.length, error: null });
    return {
      select(_columns, options) { head = Boolean(options?.head); return this; },
      eq(field, value) { rows = rows.filter(row => row[field] === value); return this; },
      in(field, values) { rows = rows.filter(row => values.includes(row[field])); return this; },
      is(field, value) { rows = rows.filter(row => (row[field] ?? null) === value); return this; },
      not(field, operator, value) {
        if (operator === 'is') rows = rows.filter(row => row[field] !== value);
        if (operator === 'in') rows = rows.filter(row => !value.slice(1, -1).split(',').includes(row[field]));
        return this;
      },
      or(expression) {
        if (expression === 'status.is.null,status.neq.draft') rows = rows.filter(row => row.status !== 'draft');
        return this;
      },
      order() { return this; },
      range(start, end) { return Promise.resolve({ data: rows.slice(start, end + 1), error: null }); },
      maybeSingle() { return Promise.resolve({ data: rows[0] || null, error: null }); },
      single() { return this.maybeSingle(); },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    };
  }
  globalThis.reportFixtures = {
    scoped: {
      auth: { getUser: async () => ({ data: { user: { id: actor, email_confirmed_at: now } }, error: null }) },
      from: table => from('user', table),
    },
    service: { from: table => from('service', table) },
  };
  const request = (dataset, extra = {}, workspaceId = workspace) => GET(new Request(
    'http://localhost/api/reportes/datos?' + new URLSearchParams({ dataset, workspaceId, ...extra }),
    { headers: { Authorization: 'Bearer qa-session' } }
  ));
  try {
    assert.equal((await request('documentos', {}, other)).status, 403);
    assert.deepEqual(touched, [{ role: 'service', table: 'workspace_members' }]);
    storage.workspace_members[0].access_expires_at = '2020-01-01';
    assert.equal((await request('tareas', { summary: '1' })).status, 403);
    assert.equal(touched.some(({ table }) => table === 'tareas'), false);
    storage.workspace_members[0].access_expires_at = null;

    const result = await request('respuestas', { formId: template });
    assert.equal(result.status, 200);
    assert.match(result.headers.get('cache-control'), /no-store/);
    const data = await result.json();
    assert.equal(data.total, 1);
    assert.equal(data.rows[0]['respuesta.' + template + '.amount'], 30);
    assert.equal(data.rows[0]['respuesta.' + template + '.attachment'], true);
    assert.doesNotMatch(JSON.stringify(data), /private-location|unused-value/);
    assert.equal((await request('respuestas', { formId: randomUUID() })).status, 404);

    const count = await request('tareas', { summary: '1' });
    assert.deepEqual(await count.json(), { dataset: 'tareas', total: 1 });
    for (const dataset of ['tareas','colaboracion','certificaciones','firmas_masivas']) {
      assert.equal((await request(dataset)).status, 200);
    }
    for (const table of ['tareas','collaboration_spaces','certification_cases','bulk_signature_campaigns']) {
      assert.equal(touched.some(entry => entry.table === table && entry.role === 'user'), true);
      assert.equal(touched.some(entry => entry.table === table && entry.role === 'service'), false);
    }
  } finally {
    delete globalThis.reportFixtures;
  }
});
