import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { XMLValidator } from 'fast-xml-parser';
const require = createRequire(import.meta.url),
  key = '__organizationCompletionQA';
const stubs = {
  '@/lib/notificationsInApp.server': `export const createNotificationServer=async()=>{globalThis.${key}.effects++;};`,
  '@/lib/organization/server': `export class OrganizationApiError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code}}export const organizationApiFailure=e=>Response.json({code:e.code},{status:e.status||422});`,
  '@/lib/collaboration/server': `import {OrganizationApiError} from '@/lib/organization/server';export const authorizeCollaborationRequest=async(r,ws,p,w)=>{const h=globalThis.${key};h.auth.push({ws,p,w});if(h.denied)throw new OrganizationApiError(403,'permission_denied','Denegado');return {service:h.client,userClient:h.client,user:{id:h.actor},access:{}}};export const recordCollaborationAudit=async()=>{};export const requireCollaborationEntitlement=()=>{};`,
  '@/lib/collaboration/entitlements-server':
    'export const hasCurrentCollaborationEntitlement=async()=>true;',
  '@/lib/notifications/service': `export const emitDomainEvent=async()=>{globalThis.${key}.effects++;return {deduplicated:[]}};`,
  '@/lib/nom151/service': `export const issueNom151ForVerifiedPadesBt=async()=>{throw Error('No real signing or issuance allowed')};`,
  '@/lib/organization/webhook-dispatcher': `export const queueWebhookDeliveriesForEvent=async()=>{throw Error('No real webhook allowed')};`,
  '@/lib/ai/documentIntelligence': `export const analyzeContractualDocument=async()=>{throw Error('No real AI request allowed')};`,
};
async function bundle(entry, name) {
  const outfile = `.tmp/${name}.cjs`;
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    plugins: [
      {
        name: 'completion-qa',
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) =>
            Object.hasOwn(stubs, a.path) ? { path: a.path, namespace: 'qa' } : undefined
          );
          b.onLoad({ filter: /.*/, namespace: 'qa' }, (a) => ({
            contents: stubs[a.path],
            loader: 'js',
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  return require(`../${outfile}`);
}
const reports = await bundle('src/app/api/colabora/reports/route.ts', 'completion-reports');
const exporter = await bundle('src/lib/collaboration/report-export.ts', 'completion-report-export');
const bulk = await bundle('src/app/api/colabora/tasks/bulk/route.ts', 'completion-bulk');
const automation = await bundle('src/lib/collaboration/automation.ts', 'completion-automation');
const ws = '11111111-1111-4111-8111-111111111111',
  actor = '22222222-2222-4222-8222-222222222222',
  id = '33333333-3333-4333-8333-333333333333';
function setup() {
  const h = {
    actor,
    auth: [],
    queries: 0,
    rpcs: [],
    effects: 0,
    denied: false,
    scopeAllowed: true,
  };
  h.client = {
    from() {
      h.queries++;
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        not() {
          return q;
        },
        lt() {
          return q;
        },
        or() {
          return q;
        },
        then(resolve, reject) {
          return Promise.resolve({ count: 4, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
    rpc: async (name, args) => {
      h.rpcs.push({ name, args });
      return {
        data:
          name === 'organization_authorize_automation_action'
            ? { allowed: h.scopeAllowed, principal_id: actor, workspace_id: ws }
            : [{ id, success: true }],
        error: h.scopeUnavailable ? { code: 'PGRST202' } : null,
      };
    },
  };
  globalThis[key] = h;
  return h;
}
test.after(() => delete globalThis[key]);
const sample = [
  { metric: 'Trabajo abierto', value: 8 },
  { metric: 'Fuera de plazo', value: 2 },
  { metric: 'Tareas bloqueadas', value: 1 },
  { metric: 'Revisiones abiertas', value: 3 },
  { metric: 'Espacios activos', value: 5 },
  { metric: 'Solicitudes abiertas', value: 6 },
  { metric: 'Cumplimiento SLA (%)', value: 75 },
  { metric: 'Salas activas', value: 2 },
];
test('PDF and XLSX are real, readable files with scoped report values', async () => {
  await mkdir('.tmp/colabora-exports', { recursive: true });
  const pdf = await exporter.exportCollaborationReport(
    sample,
    'pdf',
    '2026-11-18T06:00:00Z',
    'advanced'
  );
  assert.equal((await PDFDocument.load(pdf.bytes)).getPageCount(), 1);
  assert.equal(pdf.contentType, 'application/pdf');
  await writeFile('.tmp/colabora-exports/report.pdf', pdf.bytes);
  const xlsx = await exporter.exportCollaborationReport(
    [...sample, { metric: '=1+1 <control>', value: 9 }],
    'xlsx',
    '2026-11-18T06:00:00Z',
    'advanced'
  );
  const zip = await JSZip.loadAsync(xlsx.bytes);
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.equal(XMLValidator.validate(sheet), true);
  assert.ok(sheet.includes('&lt;control&gt;'));
  assert.ok(sheet.includes('<v>75</v>'));
  assert.ok(!sheet.includes('<f>'));
  assert.ok(zip.file('[Content_Types].xml'));
  await writeFile('.tmp/colabora-exports/report.xlsx', xlsx.bytes);
});
test('every report download requires export permission before data queries', async () => {
  for (const format of ['csv', 'pdf', 'xlsx']) {
    const h = setup();
    const response = await reports.GET(
      new Request(`http://localhost/api/colabora/reports?workspace_id=${ws}&format=${format}`)
    );
    assert.equal(response.status, 200);
    assert.equal(h.auth[0].p, 'reports.export');
    assert.equal(h.auth[0].w, true);
    assert.ok(response.headers.get('content-disposition').endsWith(`.${format}"`));
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.ok((await response.arrayBuffer()).byteLength > 100);
  }
  const h = setup();
  h.denied = true;
  const response = await reports.GET(
    new Request(`http://localhost/api/colabora/reports?workspace_id=${ws}&format=xlsx`)
  );
  assert.equal(response.status, 403);
  assert.equal(h.queries, 0);
});
test('CSV neutralizes spreadsheet formulas and XLSX preserves them as literal strings', async () => {
  const csv = await exporter.exportCollaborationReport(
    [{ metric: '=HYPERLINK("x")', value: 1 }],
    'csv',
    '2026-11-18T00:00:00Z',
    'basic'
  );
  assert.ok(new TextDecoder().decode(csv.bytes).includes('"\'=HYPERLINK'));
  await assert.rejects(
    exporter.exportCollaborationReport(
      [{ metric: 'Invalid', value: NaN }],
      'xlsx',
      '2026-11-18T00:00:00Z',
      'basic'
    )
  );
});
test('worker denial and unavailable policies prevent provider side effects', async () => {
  const h = setup();
  h.scopeAllowed = false;
  const args = [
    h.client,
    { id, workspace_id: ws, created_by: actor },
    { id, actions: [{ type: 'notify' }] },
    actor,
  ];
  await assert.rejects(
    automation.executeConfiguredAutomation(...args),
    (error) => error.code === 'organization_worker_access_denied' && error.retryable === false
  );
  assert.equal(h.effects, 0);
  h.scopeUnavailable = true;
  await assert.rejects(
    automation.executeConfiguredAutomation(...args),
    (error) => error.code === 'organization_worker_access_unavailable' && error.retryable === true
  );
  assert.equal(h.effects, 0);
});
test('workers revalidate each action instead of retaining a permission from an earlier action', async () => {
  const h = setup(),
    original = h.client.rpc;
  h.client.rpc = async (name, args) => {
    if (h.rpcs.length === 1) h.scopeAllowed = false;
    return original(name, args);
  };
  await assert.rejects(
    automation.executeConfiguredAutomation(
      h.client,
      { id, workspace_id: ws, created_by: actor },
      { id, actions: [{ type: 'notify' }, { type: 'notify' }] },
      actor
    )
  );
  assert.equal(h.effects, 1);
  assert.equal(h.rpcs.length, 2);
});
test('bulk endpoint authenticates once and sends verified actor, versions and criteria to its transaction', async () => {
  const h = setup();
  const response = await bulk.POST(
    new Request('http://localhost/api/colabora/tasks/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspace_id: ws,
        action: 'update',
        items: [{ id, optimistic_version: 2 }],
        prioridad: 'alta',
        actor: 'forged',
      }),
    })
  );
  assert.equal(response.status, 200);
  assert.equal(h.auth.length, 1);
  assert.equal(h.rpcs[0].name, 'colabora_bulk_mutate_tasks');
  assert.equal(h.rpcs[0].args.actor, actor);
  assert.equal(h.rpcs[0].args.items[0].optimistic_version, 2);
});
test('duplicate tasks and batches above 25 are rejected before authorization or writes', async () => {
  const h = setup();
  for (const items of [
    [
      { id, optimistic_version: 1 },
      { id, optimistic_version: 1 },
    ],
    Array.from({ length: 26 }, () => ({ id, optimistic_version: 1 })),
  ]) {
    const response = await bulk.POST(
      new Request('http://localhost/api/colabora/tasks/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace_id: ws, action: 'start', items }),
      })
    );
    assert.equal(response.status, 422);
  }
  assert.equal(h.auth.length, 0);
  assert.equal(h.rpcs.length, 0);
});
test('bulk reassignment emits a single deduplicated notification for the successful group', async () => {
  const h = setup();
  const response = await bulk.POST(
    new Request('http://localhost/api/colabora/tasks/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspace_id: ws,
        action: 'reassign',
        items: [{ id, optimistic_version: 1 }],
        assigned_to: '44444444-4444-4444-8444-444444444444',
      }),
    })
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).notification_status, 'queued');
  assert.equal(h.effects, 1);
});
