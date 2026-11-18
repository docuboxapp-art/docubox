import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const key = '__collaborationFunctionalQA';
const require = createRequire(import.meta.url);
const stubs = {
  '@/lib/collaboration/entitlements-server': `export const hasCurrentCollaborationEntitlement=async()=>!globalThis.${key}.entitlementDenied;`,
  '@/lib/organization/server': `import {ZodError} from 'zod';export class OrganizationApiError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code}}export const organizationApiFailure=e=>Response.json({success:false,code:e.code||'internal_error',error:e.message},{status:e instanceof ZodError?422:e.status||500});`,
  '@/lib/collaboration/server': `import {OrganizationApiError} from '@/lib/organization/server';export async function authorizeCollaborationRequest(request,ws,permission,write,resource){const h=globalThis.${key};h.permissions.push({ws,permission,write,resource});if(resource&&h.resourceDenied)throw new OrganizationApiError(403,'organization_resource_out_of_scope','Fuera del alcance');if(h.denied)throw new OrganizationApiError(403,'permission_denied','Denegado');return {user:{id:h.actor,email:'actor@example.invalid'},service:h.service,userClient:h.client,access:h.access}}export const assertCollaborationCreationScope=async()=>{if(globalThis.${key}.creationDenied)throw new OrganizationApiError(403,'organization_resource_out_of_scope','Fuera del alcance');};export const requireCollaborationEntitlement=()=>{};export const recordCollaborationAudit=async()=>{};`,
  '@/lib/supabase/server': `export const createServiceClient=()=>globalThis.${key}.service;`,
  '@/lib/collaboration/invitations.server': `export const sendCollaborationRequestInvitation=async(...args)=>{globalThis.${key}.deliveries.push(args[1]);return {status:'sent'}};export const sendCollaborationRoomInvitation=async(...args)=>{globalThis.${key}.deliveries.push(args[2]);return {status:'sent'}};`,
  '@/lib/collaboration/automation': `export const executeConfiguredAutomation=async()=>({});`,
  '@/lib/notificationsInApp.server': `export const createNotificationServer=async()=>{};`,
};
async function bundle(entry, name) {
  await build({
    entryPoints: [entry],
    outfile: `.tmp/${name}.cjs`,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    plugins: [
      {
        name: 'qa-boundaries',
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
  return require(`../.tmp/${name}.cjs`);
}
const milestones = await bundle(
  'src/app/api/colabora/milestones/[id]/route.ts',
  'colabora-milestones-qa'
);
const catalog = await bundle('src/app/api/colabora/catalog/route.ts', 'colabora-catalog-qa');
const resources = await bundle(
  'src/app/api/colabora/resources/[resource]/route.ts',
  'colabora-resources-qa'
);
const details = await bundle(
  'src/app/api/colabora/details/[resource]/[id]/route.ts',
  'colabora-details-qa'
);
const forms = await bundle('src/app/api/colabora/forms/route.ts', 'colabora-forms-qa');
const taskCreate = await bundle('src/app/api/colabora/tasks/route.ts', 'colabora-task-create-qa');
const taskDetail = await bundle(
  'src/app/api/colabora/tasks/[taskId]/route.ts',
  'colabora-task-detail-qa'
);
const itemAction = await bundle(
  'src/app/api/public/colabora/requests/[token]/items/[itemId]/action/route.ts',
  'colabora-item-action-qa'
);
const upload = await bundle(
  'src/app/api/public/colabora/requests/[token]/upload/route.ts',
  'colabora-upload-qa'
);
const invitations = await bundle(
  'src/app/api/colabora/invitations/route.ts',
  'colabora-invitation-qa'
);
const publicRequests = await bundle(
  'src/app/api/public/colabora/requests/[token]/route.ts',
  'colabora-public-requests-qa'
);
const publicRooms = await bundle(
  'src/app/api/public/colabora/rooms/[token]/route.ts',
  'colabora-public-rooms-qa'
);
const reviews = await bundle(
  'src/app/api/colabora/documents/[documentId]/route.ts',
  'colabora-review-qa'
);
const ws = '11111111-1111-4111-8111-111111111111',
  id = '22222222-2222-4222-8222-222222222222',
  actor = '33333333-3333-4333-8333-333333333333',
  foreign = '44444444-4444-4444-8444-444444444444',
  formId = '55555555-5555-4555-8555-555555555555';
const token = 'a'.repeat(43),
  sessionToken = 'b'.repeat(43),
  hash = (value) => createHash('sha256').update(value).digest('hex');
function setup(tables = {}) {
  const h = {
    actor,
    tables,
    permissions: [],
    queries: [],
    writes: [],
    rpcs: [],
    rpcResults: {},
    deliveries: [],
    denied: false,
    access: {
      eligible: true,
      accessible: true,
      writeAllowed: true,
      membershipRole: 'owner',
      permissions: [],
    },
  };
  function client(who) {
    return {
      from(table) {
        const trace = { who, table, columns: '', filters: [] };
        h.queries.push(trace);
        let changes, insert;
        const result = () => {
          let rows = (h.tables[table] || []).filter((row) =>
            trace.filters.every(([op, key, value]) =>
              op === 'eq'
                ? row[key] === value
                : op === 'in'
                  ? value.includes(row[key])
                  : op === 'is'
                    ? (row[key] ?? null) === value
                    : op === 'gt'
                      ? row[key] > value
                      : op === 'not-is'
                        ? row[key] != null
                        : true
            )
          );
          if (changes) {
            h.writes.push({ who, table, changes, filters: trace.filters });
            rows.forEach((row) => Object.assign(row, changes));
          }
          if (insert) {
            const values = Array.isArray(insert) ? insert : [insert];
            rows = values.map((row) => ({ id, ...row }));
            h.writes.push({ who, table, insert });
            h.tables[table] = [...(h.tables[table] || []), ...rows];
          }
          return {
            data: trace.range ? rows.slice(trace.range[0], trace.range[1] + 1) : rows,
            error: null,
            count: rows.length,
          };
        };
        const q = {
          select(columns) {
            trace.columns = columns;
            return q;
          },
          eq(k, v) {
            trace.filters.push(['eq', k, v]);
            return q;
          },
          in(k, v) {
            trace.filters.push(['in', k, v]);
            return q;
          },
          is(k, v) {
            trace.filters.push(['is', k, v]);
            return q;
          },
          gt(k, v) {
            trace.filters.push(['gt', k, v]);
            return q;
          },
          not(k, op, v) {
            trace.filters.push(['not-' + op, k, v]);
            return q;
          },
          order() {
            return q;
          },
          limit() {
            return q;
          },
          range(from, to) {
            trace.range = [from, to];
            return q;
          },
          lt(k, v) {
            trace.filters.push(['lt', k, v]);
            return q;
          },
          gte(k, v) {
            trace.filters.push(['gte', k, v]);
            return q;
          },
          lte(k, v) {
            trace.filters.push(['lte', k, v]);
            return q;
          },
          or() {
            return q;
          },
          update(v) {
            changes = v;
            return q;
          },
          insert(v) {
            insert = v;
            return q;
          },
          delete() {
            return q;
          },
          single: async () => ({ ...result(), data: result().data[0] || null }),
          maybeSingle: async () => {
            const r = result();
            return { ...r, data: r.data[0] || null };
          },
          then(resolve, reject) {
            return Promise.resolve(result()).then(resolve, reject);
          },
        };
        return q;
      },
      rpc: async (name, args) => {
        h.rpcs.push({ who, name, args });
        return (
          h.rpcResults[name] || {
            data: {
              id,
              workspace_id: ws,
              recipient_email: 'recipient@example.invalid',
              status: 'sent',
            },
            error: null,
          }
        );
      },
    };
  }
  h.client = client('user');
  h.service = client('service');
  h.service.storage = {
    from() {
      return {
        upload: async () => {
          h.writes.push({ storage: true });
          return { error: null };
        },
        remove: async () => ({ error: null }),
      };
    },
  };
  globalThis[key] = h;
  return h;
}
const post = (path, body, headers = {}) =>
  new Request('http://localhost' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const patch = (body) =>
  new Request('http://localhost/api/colabora/details/requests/' + id, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspace_id: ws, ...body }),
  });
const context = (resource) => ({ params: Promise.resolve({ resource, id }) });
const requestBody = (items) => ({
  workspace_id: ws,
  title: 'Solicitud sintética',
  recipient_name: 'Persona de prueba',
  recipient_email: 'recipient@example.invalid',
  items,
  send_invitation: false,
});
const activeRequest = {
  id,
  workspace_id: ws,
  access_token_hash: hash(token),
  recipient_email: 'recipient@example.invalid',
  status: 'sent',
  access_expires_at: '2099-01-01T00:00:00Z',
};
const activeSession = {
  id: actor,
  request_id: id,
  session_token_hash: hash(sessionToken),
  otp_consumed_at: '2026-11-18T00:00:00Z',
  revoked_at: null,
  expires_at: '2099-01-01T00:00:00Z',
};
test.after(() => delete globalThis[key]);

test('catalog permission denial stops reads before a privileged query', async () => {
  const h = setup();
  h.denied = true;
  assert.equal(
    (
      await catalog.GET(
        new Request(`http://localhost/api/colabora/catalog?workspace_id=${ws}&type=forms`)
      )
    ).status,
    403
  );
  assert.equal(h.queries.length, 0);
});
test('published form catalogs use current-user RLS and workspace scope', async () => {
  const h = setup({
    form_templates: [
      { id: formId, workspace_id: ws, status: 'published' },
      { id: foreign, workspace_id: foreign, status: 'published' },
      { id, workspace_id: ws, status: 'draft' },
    ],
  });
  const response = await catalog.GET(
    new Request(`http://localhost/api/colabora/catalog?workspace_id=${ws}&type=forms`)
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    (await response.json()).data.map((row) => row.id),
    [formId]
  );
  assert.equal(h.queries[0].who, 'user');
});
test('a task cannot assign a member from another organization', async () => {
  const h = setup({
    workspace_members: [{ workspace_id: foreign, user_id: foreign, status: 'active' }],
  });
  const response = await taskCreate.POST(
    post('/api/colabora/tasks', {
      workspace_id: ws,
      title: 'Tarea de prueba',
      assigned_to: foreign,
    })
  );
  assert.equal(response.status, 422);
  assert.equal(h.writes.length, 0);
});
test('resource creation rejects a foreign space before inserting anything', async () => {
  const h = setup({ collaboration_spaces: [{ id: foreign, workspace_id: foreign }] });
  const response = await resources.POST(
    post('/api/colabora/resources/milestones', {
      workspace_id: ws,
      title: 'Hito de prueba',
      space_id: foreign,
      due_at: '2099-01-01T00:00:00Z',
    }),
    context('milestones')
  );
  assert.equal(response.status, 422);
  assert.equal(h.writes.length, 0);
});
test('request forms require a published source from the same organization', async () => {
  const h = setup({ form_templates: [{ id: formId, workspace_id: foreign, status: 'published' }] });
  const response = await resources.POST(
    post(
      '/api/colabora/resources/requests',
      requestBody([{ item_type: 'form', title: 'Formulario', form_template_id: formId }])
    ),
    context('requests')
  );
  assert.equal(response.status, 422);
  assert.equal(h.rpcs.length, 0);
});
test('request creation snapshots the published form and sends one audited transaction', async () => {
  const h = setup({
    form_templates: [
      {
        id: formId,
        workspace_id: ws,
        status: 'published',
        name: 'Formulario de prueba',
        version_number: 2,
        revision_number: 3,
        settings: { requiresSignature: false },
      },
    ],
  });
  const response = await resources.POST(
    post(
      '/api/colabora/resources/requests',
      requestBody([
        { item_type: 'form', title: 'Formulario', form_template_id: formId },
        { item_type: 'document', title: 'Documento' },
      ])
    ),
    context('requests')
  );
  assert.equal(response.status, 201);
  assert.equal(h.rpcs[0].name, 'colabora_create_document_request');
  assert.equal(h.rpcs[0].args.items[0].source_snapshot.requiresSignature, false);
  assert.equal(h.rpcs[0].args.items[0].source_snapshot.revision, 3);
  assert.match(h.rpcs[0].args.token_hash, /^[a-f0-9]{64}$/);
  assert.equal(h.deliveries.length, 0);
  assert.equal(h.rpcs[0].args.items.length, 2);
});
test('a form requirement cannot silently degrade to a file upload', async () => {
  const h = setup();
  const response = await resources.POST(
    post(
      '/api/colabora/resources/requests',
      requestBody([{ item_type: 'form', title: 'Formulario sin vínculo' }])
    ),
    context('requests')
  );
  assert.equal(response.status, 422);
  assert.equal(h.rpcs.length, 0);
});
test('checklist changes bind to a scoped request and use an atomic operation', async () => {
  const h = setup({
    collaboration_document_requests: [
      { id, workspace_id: ws, status: 'sent', recipient_email: 'recipient@example.invalid' },
    ],
  });
  const response = await details.PATCH(
    patch({ action: 'add_item', item: { item_type: 'document', title: 'Nuevo documento' } }),
    context('requests')
  );
  assert.equal(response.status, 200);
  assert.equal(h.permissions[0].permission, 'requests.create');
  assert.equal(h.rpcs[0].name, 'colabora_change_request_item');
  assert.equal(h.rpcs[0].args.request_id, id);
});
test('closed requests reject approval before changing receipt or progress', async () => {
  const h = setup({
    collaboration_document_requests: [{ id, workspace_id: ws, status: 'cancelled' }],
  });
  const response = await details.PATCH(
    patch({ action: 'approve_item', item_id: actor }),
    context('requests')
  );
  assert.equal(response.status, 409);
  assert.equal(h.rpcs.length, 0);
});
test('reviewing a request uses the receipt-aware transaction and review permission', async () => {
  const h = setup({
    collaboration_document_requests: [{ id, workspace_id: ws, status: 'in_review' }],
  });
  h.rpcResults.colabora_review_request_item = { data: { status: 'completed' }, error: null };
  const response = await details.PATCH(
    patch({ action: 'approve_item', item_id: actor }),
    context('requests')
  );
  assert.equal(response.status, 200);
  assert.equal(h.permissions[0].permission, 'requests.review_items');
  assert.equal(h.rpcs[0].name, 'colabora_review_request_item');
  assert.equal((await response.json()).status, 'completed');
  assert.equal(h.writes.length, 0);
});
test('external form access requires the OTP-verified request session', async () => {
  const h = setup({
    collaboration_document_requests: [{ ...activeRequest }],
    collaboration_request_items: [
      { id: actor, workspace_id: ws, request_id: id, item_type: 'form', status: 'pending' },
    ],
  });
  const response = await itemAction.POST(post('/api/action', {}), {
    params: Promise.resolve({ token, itemId: actor }),
  });
  assert.equal(response.status, 401);
  assert.equal(h.rpcs.length, 0);
});
test('a session belonging to a different request cannot open a form', async () => {
  const h = setup({
    collaboration_document_requests: [{ ...activeRequest }],
    collaboration_request_external_sessions: [{ ...activeSession, request_id: foreign }],
  });
  const response = await itemAction.POST(
    post('/api/action', {}, { 'x-colabora-session': sessionToken }),
    { params: Promise.resolve({ token, itemId: actor }) }
  );
  assert.equal(response.status, 401);
  assert.equal(h.rpcs.length, 0);
});
test('a valid external session opens a private form invitation without a public biometric bypass', async () => {
  const h = setup({
    collaboration_document_requests: [{ ...activeRequest }],
    collaboration_request_external_sessions: [{ ...activeSession }],
    collaboration_request_items: [
      { id: actor, workspace_id: ws, request_id: id, item_type: 'form', status: 'pending' },
    ],
  });
  h.rpcResults.colabora_request_form_token = {
    data: { token: 'c'.repeat(64), resume: false },
    error: null,
  };
  const response = await itemAction.POST(
    post('/api/action', {}, { 'x-colabora-session': sessionToken }),
    { params: Promise.resolve({ token, itemId: actor }) }
  );
  assert.equal(response.status, 200);
  assert.match((await response.json()).url, /^\/portal-formulario\/[a-f0-9]{64}$/);
  assert.equal(h.rpcs[0].args.session_hash, hash(sessionToken));
  assert.equal(h.rpcs[0].args.request_hash, hash(token));
});
test('upload cannot substitute a file for a linked form requirement', async () => {
  const h = setup({
    collaboration_document_requests: [{ ...activeRequest }],
    collaboration_request_external_sessions: [{ ...activeSession }],
    collaboration_request_items: [
      { id: actor, workspace_id: ws, request_id: id, item_type: 'form', status: 'pending' },
    ],
  });
  const form = new FormData();
  form.set('item_id', actor);
  form.set('file', new File(['%PDF-synthetic'], 'test.pdf', { type: 'application/pdf' }));
  const response = await upload.POST(
    new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'x-colabora-session': sessionToken },
      body: form,
    }),
    { params: Promise.resolve({ token }) }
  );
  assert.equal(response.status, 422);
  assert.equal(h.writes.length, 0);
});
test('renewing an invitation uses a fresh hash and returns an explicit delivery result', async () => {
  const h = setup({ collaboration_document_requests: [{ id, workspace_id: ws }] });
  const response = await invitations.POST(
    post('/api/colabora/invitations', { workspace_id: ws, request_id: id })
  );
  assert.equal(response.status, 200);
  assert.equal(h.rpcs[0].name, 'colabora_rotate_request_invitation');
  assert.equal(h.rpcs[0].args.ws, ws);
  assert.match(h.rpcs[0].args.token_hash, /^[a-f0-9]{64}$/);
  assert.match((await response.json()).path, /^\/solicitud\/[A-Za-z0-9_-]{43}$/);
  assert.equal(h.deliveries.length, 1);
});
test('forms overview aggregates through the caller to retain RLS and workspace scope', async () => {
  const h = setup();
  h.rpcResults.colabora_forms_overview = {
    data: [{ id: formId, name: 'Formulario', response_count: 1005, request_count: 2 }],
    error: null,
  };
  const response = await forms.GET(
    new Request('http://localhost/api/colabora/forms?workspace_id=' + ws)
  );
  const row = (await response.json()).data[0];
  assert.equal(row.response_count, 1005);
  assert.equal(row.request_count, 2);
  assert.equal(h.rpcs[0].who, 'user');
  assert.equal(h.rpcs[0].args.ws, ws);
});
test('review creation validates assigned reviewers and delegates version changes atomically', async () => {
  const h = setup({
    documentos: [{ id, workspace_id: ws, deleted_at: null }],
    document_versions: [{ id: formId, workspace_id: ws }],
    workspace_members: [{ workspace_id: ws, user_id: actor, status: 'active' }],
  });
  const response = await resources.POST(
    post('/api/resources/reviews', {
      workspace_id: ws,
      title: 'Revisión de prueba',
      document_id: id,
      document_version_id: formId,
      reviewer_ids: [actor],
    }),
    context('reviews')
  );
  assert.equal(response.status, 201);
  assert.equal(h.rpcs[0].name, 'colabora_create_review');
  assert.equal(h.writes.length, 0);
});
test('review decisions retain optimistic version and current document scope in one transaction', async () => {
  const h = setup({ collaboration_review_rounds: [{ id, workspace_id: ws, document_id: formId }] });
  const response = await reviews.POST(
    post('/api/reviews', {
      workspace_id: ws,
      action: 'approve',
      review_round_id: id,
      optimistic_version: 4,
    }),
    { params: Promise.resolve({ documentId: formId }) }
  );
  assert.equal(response.status, 200);
  assert.equal(h.rpcs[0].name, 'colabora_decide_review');
  assert.equal(h.rpcs[0].args.expected_version, 4);
  assert.equal(h.rpcs[0].args.document_id, formId);
});
test('closed tasks require explicit reopening before any further state change', async () => {
  const h = setup({
    tareas: [{ id, workspace_id: ws, title: 'Cerrada', estado: 'cancelada', is_blocked: false }],
  });
  const response = await taskDetail.PATCH(
    new Request('http://localhost/task', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace_id: ws, action: 'complete', optimistic_version: 1 }),
    }),
    { params: Promise.resolve({ taskId: id }) }
  );
  assert.equal(response.status, 409);
  assert.equal(h.writes.length, 0);
});

test('external operations stop when the organization no longer allows deliveries', async () => {
  const h = setup({
    collaboration_document_requests: [activeRequest],
    collaboration_request_external_sessions: [activeSession],
    collaboration_request_items: [
      { id: actor, workspace_id: ws, request_id: id, item_type: 'form', status: 'pending' },
    ],
  });
  h.entitlementDenied = true;
  const result = await itemAction.POST(
    post('/api/action', {}, { 'x-colabora-session': sessionToken }),
    { params: Promise.resolve({ token, itemId: actor }) }
  );
  assert.equal(result.status, 403);
  assert.equal(h.rpcs.length, 0);
});
test('participant submission uses the session-bound transaction', async () => {
  const h = setup({ collaboration_document_requests: [activeRequest] });
  h.rpcResults.colabora_submit_request = {
    data: { id, workspace_id: ws, status: 'in_review', reviewer_id: actor, version: 3 },
    error: null,
  };
  const result = await publicRequests.POST(
    post('/api/public/request', { action: 'submit' }, { 'x-colabora-session': sessionToken }),
    { params: Promise.resolve({ token }) }
  );
  assert.equal(result.status, 200);
  assert.equal(h.rpcs[0].name, 'colabora_submit_request');
  assert.equal(h.rpcs[0].args.session_hash, hash(sessionToken));
});
test('room invitations renew access and deliver the mail through the organization template', async () => {
  const h = setup({
    collaboration_rooms: [
      { id, workspace_id: ws, status: 'active', name: 'Sala', expires_at: '2099-01-01T00:00:00Z' },
    ],
  });
  const result = await details.PATCH(
    patch({
      action: 'add_guest',
      name: 'Invitado de ejemplo',
      email: 'guest@example.invalid',
      allow_download: false,
      allow_comment: true,
    }),
    context('rooms')
  );
  assert.equal(result.status, 200);
  assert.equal((await result.json()).invitation.status, 'sent');
  assert.equal(h.deliveries.length, 1);
  assert.equal(
    h.writes.find((w) => w.table === 'collaboration_room_guests').insert.permissions.comment,
    true
  );
});
test('an external room comment requires both a verified session and the organization policy', async () => {
  const room = {
    id,
    workspace_id: ws,
    status: 'active',
    expires_at: '2099-01-01T00:00:00Z',
    terms_required: false,
  };
  const guest = {
    id: actor,
    workspace_id: ws,
    room_id: id,
    room,
    status: 'active',
    token_hash: hash(token),
    token_expires_at: '2099-01-01T00:00:00Z',
    permissions: { view: true, comment: true },
  };
  const h = setup({
    collaboration_room_guests: [guest],
    collaboration_external_sessions: [
      {
        id: foreign,
        guest_id: actor,
        session_token_hash: hash(sessionToken),
        revoked_at: null,
        otp_consumed_at: '2026-11-18T00:00:00Z',
        expires_at: '2099-01-01T00:00:00Z',
      },
    ],
    collaboration_settings: [{ workspace_id: ws, allow_external_comments: false }],
  });
  let result = await publicRooms.POST(
    post(
      '/api/room',
      { action: 'comment', body: 'Comentario de ejemplo' },
      { 'x-colabora-session': sessionToken }
    ),
    { params: Promise.resolve({ token }) }
  );
  assert.equal(result.status, 403);
  assert.equal(h.writes.length, 0);
  h.tables.collaboration_settings[0].allow_external_comments = true;
  result = await publicRooms.POST(
    post(
      '/api/room',
      { action: 'comment', body: 'Comentario de ejemplo' },
      { 'x-colabora-session': sessionToken }
    ),
    { params: Promise.resolve({ token }) }
  );
  assert.equal(result.status, 201);
  assert.equal(h.writes[0].insert.guest_id, actor);
  assert.equal(h.writes[0].insert.metadata.body, 'Comentario de ejemplo');
});

test('a calendar milestone can be completed without a linked space and persists its state', async () => {
  const h = setup({
    collaboration_milestones: [{ id, workspace_id: ws, status: 'upcoming', space_id: null }],
  });
  const response = await milestones.PATCH(patch({ action: 'complete' }), {
    params: Promise.resolve({ id }),
  });
  assert.equal(response.status, 200);
  assert.equal(h.tables.collaboration_milestones[0].status, 'completed');
  assert.ok(h.tables.collaboration_milestones[0].completed_at);
});
test('milestones in closed spaces cannot be changed', async () => {
  const h = setup({
    collaboration_milestones: [{ id, workspace_id: ws, status: 'upcoming', space_id: actor }],
    collaboration_spaces: [{ id: actor, workspace_id: ws, status: 'closed' }],
  });
  const response = await milestones.PATCH(patch({ action: 'complete' }), {
    params: Promise.resolve({ id }),
  });
  assert.equal(response.status, 409);
  assert.equal(h.writes.length, 0);
});
test('a foreign milestone cannot be modified', async () => {
  const h = setup({
    collaboration_milestones: [{ id, workspace_id: foreign, status: 'upcoming' }],
  });
  const response = await milestones.PATCH(patch({ action: 'complete' }), {
    params: Promise.resolve({ id }),
  });
  assert.equal(response.status, 404);
  assert.equal(h.writes.length, 0);
});

test('request approval outside the role scope cannot change a receipt or its progress', async () => {
  const h = setup({
    collaboration_document_requests: [{ id, workspace_id: ws, status: 'in_review' }],
  });
  h.resourceDenied = true;
  const response = await details.PATCH(
    patch({ action: 'approve_item', item_id: actor }),
    context('requests')
  );
  assert.equal(response.status, 403);
  assert.deepEqual(h.permissions[0].resource, { type: 'request', id });
  assert.equal(h.writes.length, 0);
  assert.equal(h.rpcs.length, 0);
});

test('an invitation outside the role scope cannot issue a token or send mail', async () => {
  const h = setup({ collaboration_document_requests: [{ ...activeRequest }] });
  h.resourceDenied = true;
  const response = await invitations.POST(
    post('/api/colabora/invitations', { workspace_id: ws, request_id: id })
  );
  assert.equal(response.status, 403);
  assert.equal(h.deliveries.length, 0);
  assert.equal(h.rpcs.length, 0);
  assert.equal(h.writes.length, 0);
});

test('creation scope denial stops a new request before its transaction or invitation', async () => {
  const h = setup();
  h.creationDenied = true;
  const response = await resources.POST(
    post(
      '/api/colabora/resources/requests',
      requestBody([{ item_type: 'document', title: 'Synthetic' }])
    ),
    context('requests')
  );
  assert.equal(response.status, 403);
  assert.equal(h.rpcs.length, 0);
  assert.equal(h.deliveries.length, 0);
  assert.equal(h.writes.length, 0);
});

test('member catalogs apply a user-token scope filter to otherwise visible forms', async () => {
  const h = setup({
    form_templates: [
      { id: formId, workspace_id: ws, status: 'published' },
      { id, workspace_id: ws, status: 'published' },
    ],
  });
  h.access.membershipRole = 'member';
  h.access.permissions = ['requests.create'];
  h.rpcResults.organization_filter_resource_ids = { data: [formId], error: null };
  const response = await catalog.GET(
    new Request(`http://localhost/api/colabora/catalog?workspace_id=${ws}&type=forms`)
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    (await response.json()).data.map((row) => row.id),
    [formId]
  );
  const rpc = h.rpcs.find((call) => call.name === 'organization_filter_resource_ids');
  assert.equal(rpc.who, 'user');
  assert.deepEqual(rpc.args.requested_permissions, ['requests.create']);
});

test('task pagination and priority use the caller RLS and validated query criteria', async () => {
  const h = setup({
    tareas: [
      { id, workspace_id: ws, prioridad: 'media', assigned_to: actor },
      { id: foreign, workspace_id: ws, prioridad: 'critica', assigned_to: foreign },
    ],
  });
  const response = await taskCreate.GET(
    new Request(
      `http://localhost/api/colabora/tasks?workspace_id=${ws}&priority=media&mine=1&page=2&page_size=10`
    )
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.data, []);
  assert.equal(payload.total, 1);
  assert.equal(payload.page, 2);
  assert.equal(h.queries[0].who, 'user');
  assert.deepEqual(h.queries[0].range, [10, 19]);
  const invalid = await taskCreate.GET(
    new Request(`http://localhost/api/colabora/tasks?workspace_id=${ws}&page=-1`)
  );
  assert.equal(invalid.status, 422);
});
