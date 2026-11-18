import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const user = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const space = '33333333-3333-4333-8333-333333333333';
const formId = '44444444-4444-4444-8444-444444444444';
const tokenId = '55555555-5555-4555-8555-555555555555';
const caseId = '66666666-6666-4666-8666-666666666666';
const inviteId = '77777777-7777-4777-8777-777777777777';
const now = Date.parse('2026-11-17T12:00:00Z');
const actor = {
  id: user,
  email: 'owner@example.test',
  email_confirmed_at: '2026-01-01',
  is_anonymous: false,
};
const secret = 'synthetic-invitation-key-for-test-only-12345';
const capability = 'a'.repeat(64);
let tables;
let calls;
let failTable;

function client() {
  return {
    from(table) {
      let rows = [...(tables[table] || [])];
      let single = false;
      const orders = [];
      const q = {
        select(columns) {
          calls.push({ table, columns });
          return this;
        },
        eq(field, value) {
          calls.push({ table, field, value });
          rows = rows.filter((row) => row[field] === value);
          return this;
        },
        is(field, value) {
          rows = rows.filter((row) => (value === null ? row[field] == null : row[field] === value));
          return this;
        },
        in(field, values) {
          rows = rows.filter((row) => values.includes(row[field]));
          return this;
        },
        gt(field, value) {
          rows = rows.filter((row) => row[field] > value);
          return this;
        },
        order(field, options) {
          orders.push([field, options?.ascending !== false]);
          return this;
        },
        or(expression) {
          const alternatives = expression.split(/,(?![^()]*\))/);
          rows = rows.filter((row) =>
            alternatives.some((part) => {
              const [field, op, ...rest] = part.split('.');
              const value = rest.join('.');
              const [base, nested] = field.split('->>');
              const actual = nested ? row[base]?.[nested] : row[field];
              return op === 'eq'
                ? actual === value
                : op === 'in' && value.slice(1, -1).split(',').includes(actual);
            })
          );
          return this;
        },
        range(start, end) {
          rows.sort((a, b) => {
            for (const [field, ascending] of orders) {
              const order = String(a[field] || '').localeCompare(String(b[field] || ''));
              if (order) return ascending ? order : -order;
            }
            return 0;
          });
          rows = rows.slice(start, end + 1);
          return this;
        },
        maybeSingle() {
          single = true;
          return this;
        },
        then(resolve) {
          return Promise.resolve({
            data: single ? rows[0] || null : rows,
            error: failTable === table ? new Error('synthetic backend error') : null,
          }).then(resolve);
        },
      };
      return q;
    },
  };
}
const bundled = await build({
  stdin: {
    contents: `export * from './src/lib/activity/inbox.server'; export * from './src/lib/activity/access.server'; export * from './src/lib/activity/model'; export * from './src/lib/activity/request-error'; export { GET } from './src/app/api/activity/route'; export { POST } from './src/app/api/activity/open/route'; export { encryptInvitationSecret } from './src/lib/case-files/invitations';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'fixture-dependencies',
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: 'server-only',
          namespace: 'fixture',
        }));
        build.onResolve({ filter: /^next\/server$/ }, () => ({
          path: 'next-response',
          namespace: 'fixture',
        }));
        build.onResolve({ filter: /lib\/security\/document-access$/ }, () => ({
          path: 'identity',
          namespace: 'fixture',
        }));
        build.onResolve({ filter: /lib\/supabase\/server$/ }, () => ({
          path: 'service',
          namespace: 'fixture',
        }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'server-only'
              ? ''
              : path === 'next-response'
                ? 'export class NextResponse extends Response { static json(body, init) { return new NextResponse(JSON.stringify(body), init); } }'
                : path === 'service'
                  ? 'export const createServiceClient = () => globalThis.__activityDb;'
                  : `export class DocumentAccessError extends Error { constructor(code, message, status) { super(message); this.code=code; this.status=status; } } export async function requireDocumentIdentity(request) { if (!request.headers.get('authorization')) throw new DocumentAccessError('AUTH_REQUIRED','Inicia sesión',401); if(request.headers.get('authorization')==='Bearer unavailable') throw new DocumentAccessError('AUTH_UNAVAILABLE','No se pudo verificar',503); return { user: globalThis.__activityActor }; }`,
        }));
      },
    },
  ],
});
const bundlePath = resolve('.tmp/activity-inbox-fixture.mjs');
await writeFile(bundlePath, bundled.outputFiles[0].text);
const api = await import(pathToFileURL(bundlePath).href);
beforeEach(() => {
  calls = [];
  failTable = '';
  globalThis.__activityActor = actor;
  tables = {
    workspace_members: [
      { workspace_id: space, user_id: user, status: 'active', access_expires_at: null },
    ],
    workspaces: [{ id: space, name: 'Espacio sintético' }],
    user_profiles: [
      { id: user, full_name: 'Emisor sintético' },
      { id: other, full_name: 'Otra persona' },
    ],
    form_templates: [
      {
        id: formId,
        name: 'Formulario sintético',
        workspace_id: space,
        created_by: user,
        status: 'published',
        requires_signature: false,
      },
    ],
    form_tokens: [
      {
        id: tokenId,
        template_id: formId,
        recipient_email: actor.email,
        recipient_user_id: user,
        recipient_name: 'Destinatario',
        launched_by_user_id: user,
        launcher_name: 'Emisor sintético',
        token: capability,
        access_mode: 'private',
        created_at: '2026-11-17T10:00:00Z',
        expires_at: '2099-01-01T00:00:00Z',
        used_at: null,
      },
    ],
    case_files: [
      {
        id: caseId,
        title: 'Expediente sintético',
        folio: 'QA-EXP',
        workspace_id: space,
        owner_user_id: user,
        created_by: user,
        status: 'integrating',
        priority: 'urgent',
        progress: 25,
        created_at: '2026-11-17T09:00:00Z',
        updated_at: '2026-11-17T11:00:00Z',
        runtime_assignments: {},
      },
    ],
    case_launches: [{ case_file_id: caseId, access_mode: 'private', scheduled_at: null }],
    case_participant_invitations: [
      {
        id: inviteId,
        case_file_id: caseId,
        participant_id: other,
        recipient: actor.email,
        recipient_name: 'Titular sintético',
        participant_role: 'subject',
        sender_name: 'Emisor sintético',
        created_by: user,
        created_at: '2026-11-17T09:00:00Z',
        sent_at: '2026-11-17T09:00:00Z',
        not_before: '2026-11-17T09:00:00Z',
        expires_at: '2099-01-01T00:00:00Z',
        revoked_at: null,
        generation: 1,
        delivery_status: 'sent',
        token_ciphertext: api.encryptInvitationSecret(capability, secret),
      },
    ],
  };
  globalThis.__activityDb = client();
});
const receive = () => api.loadFormActivity(client(), actor, 'received', now);
const send = () => api.loadFormActivity(client(), actor, 'sent', now);

test('incoming forms belong to the verified recipient; outgoing forms belong to the launcher', async () => {
  tables.form_tokens.push({
    ...tables.form_tokens[0],
    id: other,
    recipient_email: 'other@example.test',
    recipient_user_id: other,
    launched_by_user_id: other,
  });
  assert.equal((await receive()).length, 1);
  assert.equal((await send()).length, 1);
  tables.form_tokens[0].recipient_user_id = other;
  assert.equal(
    (await receive()).length,
    0,
    'an email match cannot override a different assigned account'
  );
  const list = await send();
  assert.ok(!JSON.stringify(list).includes(capability));
  assert.ok(!calls.some((call) => call.columns?.split(',').includes('token')));
});

test('legacy launches use the template creator and expired memberships hide sent data', async () => {
  tables.form_tokens[0].launched_by_user_id = null;
  assert.equal((await send()).length, 1);
  tables.workspace_members[0].access_expires_at = '2026-01-01';
  assert.equal((await send()).length, 0);
  assert.equal((await receive()).length, 1, 'external recipients do not need workspace membership');
});

test('forms linked to a case stay in the case and never duplicate its independent forms inbox', async () => {
  tables.case_portal_form_tokens = [{ token_id: tokenId }];
  assert.equal((await receive()).length, 0);
  assert.equal((await send()).length, 0);
  await assert.rejects(
    api.resolveActivityAccess(client(), actor, 'form-token', tokenId, secret, now),
    /expediente/
  );
});

test('public invitations and later claims form a single row; unclaimed invitations remain visible', async () => {
  tables.form_public_invitees = [
    {
      form_id: formId,
      recipient_email: actor.email,
      recipient_name: 'Destinatario',
      invited_at: '2026-11-17T09:30:00Z',
      invited_by: user,
    },
  ];
  tables.form_tokens[0].access_mode = 'public';
  assert.equal((await receive()).length, 1);
  assert.equal((await send()).length, 1);
  tables.form_tokens = [];
  assert.equal((await receive())[0].actions[0].open.source, 'form-public');
  assert.equal(
    await api.resolveActivityAccess(client(), actor, 'form-public', formId, secret, now),
    `/formulario-publico/${formId}`
  );
});

test('scheduled sends are not delivered requests and cancelled schedules retain their actual state', async () => {
  tables.form_send_schedules = [
    {
      id: inviteId,
      template_id: formId,
      requested_by: user,
      recipient_email: actor.email,
      recipient_name: 'Destinatario',
      created_at: '2026-11-17T10:00:00Z',
      scheduled_at: '2099-01-01T00:00:00Z',
      status: 'scheduled',
      token_id: tokenId,
    },
  ];
  assert.equal((await receive()).length, 0);
  assert.equal((await send()).length, 1);
  assert.equal((await send())[0].state, 'scheduled');
  tables.form_send_schedules[0].status = 'cancelled';
  assert.equal((await send())[0].state, 'cancelled');
});

test('a submitted form with optional signature is completed, while mandatory signing remains pending', async () => {
  tables.form_responses = [
    {
      id: inviteId,
      template_id: formId,
      token_id: tokenId,
      status: 'submitted',
      submitted_at: '2026-11-17T11:00:00Z',
      document_id: caseId,
    },
  ];
  assert.equal((await receive())[0].state, 'completed');
  assert.equal(
    await api.resolveActivityAccess(client(), actor, 'form-token', tokenId, secret, now),
    `/visor-documento/${caseId}`
  );
  tables.form_templates[0].requires_signature = true;
  assert.equal((await receive())[0].state, 'signature');
  assert.equal(
    await api.resolveActivityAccess(client(), actor, 'form-token', tokenId, secret, now),
    `/firmar-documento/${caseId}`
  );
});

test('case inbox combines an internal assignment and an own invitation without duplicating the case', async () => {
  const rows = await api.loadCaseActivity(client(), actor, 'received', now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].progress, 25);
  assert.match(rows[0].role, /Administrador/);
  assert.equal(rows[0].actions.length, 2);
  assert.ok(!JSON.stringify(rows).includes(capability));
  assert.ok(!calls.some((call) => call.columns?.includes('ciphertext')));
});

test('delegated reviewers see the case only while their workspace access is active', async () => {
  tables.case_participant_invitations = [];
  tables.case_files[0].owner_user_id = other;
  tables.case_file_requirements = [
    { id: inviteId, case_file_id: caseId, workspace_id: space, reviewer_user_id: user },
  ];
  assert.match((await api.loadCaseActivity(client(), actor, 'received', now))[0].role, /Revisor/);
  tables.workspace_members[0].status = 'offboarded';
  assert.equal((await api.loadCaseActivity(client(), actor, 'received', now)).length, 0);
});

test('external invitees see only their case; unrelated workspace membership grants no inbox entry', async () => {
  tables.workspace_members = [];
  assert.equal((await api.loadCaseActivity(client(), actor, 'received', now)).length, 1);
  tables.case_participant_invitations[0].recipient = 'other@example.test';
  assert.equal((await api.loadCaseActivity(client(), actor, 'received', now)).length, 0);
});

test('case opening keeps its own entry route and rejects other recipients, revoked and scheduled invitations', async () => {
  assert.equal(
    await api.resolveActivityAccess(client(), actor, 'case-invitation', inviteId, secret, now),
    `/expediente/${capability}`
  );
  tables.case_participant_invitations[0].recipient = 'other@example.test';
  await assert.rejects(
    api.resolveActivityAccess(client(), actor, 'case-invitation', inviteId, secret, now),
    /tu cuenta/
  );
  tables.case_participant_invitations[0].recipient = actor.email;
  tables.case_participant_invitations[0].revoked_at = '2026-11-17T11:00:00Z';
  await assert.rejects(
    api.resolveActivityAccess(client(), actor, 'case-invitation', inviteId, secret, now),
    /revocada/
  );
  tables.case_participant_invitations[0].revoked_at = null;
  tables.case_participant_invitations[0].not_before = '2099-01-01T00:00:00Z';
  await assert.rejects(
    api.resolveActivityAccess(client(), actor, 'case-invitation', inviteId, secret, now),
    /programado/
  );
});

test('type, search, status, date, access and workspace filters keep the correct records', async () => {
  const items = await api.loadCaseActivity(client(), actor, 'sent', now);
  const base = {
    search: 'expediente sintetico',
    state: 'in_progress',
    access: 'private',
    workspace: space,
    from: '2026-11-17',
    to: '2026-11-17',
    sort: 'recent',
  };
  assert.equal(api.filterActivity(items, base).length, 1);
  assert.equal(api.filterActivity(items, { ...base, state: 'completed' }).length, 0);
  assert.equal(api.filterActivity(items, { ...base, access: 'public' }).length, 0);
});

test('pagination reads beyond the 1000-row API cap rather than losing older invitations', async () => {
  const source = Array.from({ length: 1203 }, (_, id) => ({ id }));
  assert.equal(
    (
      await api.readActivityRows((start, end) =>
        Promise.resolve({ data: source.slice(start, end + 1), error: null })
      )
    ).length,
    source.length
  );
});

test('list routes reject anonymous, unverified and invalid requests before privileged queries', async () => {
  const { NextRequest } = await import('next/server.js');
  const request = (query, authorization = 'Bearer fixture') =>
    new NextRequest(`http://localhost/api/activity?${query}`, {
      headers: authorization ? { authorization } : {},
    });
  assert.equal((await api.GET(request('mode=received&kind=formularios', ''))).status, 401);
  assert.equal(calls.length, 0);
  globalThis.__activityActor = { ...actor, email_confirmed_at: null };
  assert.equal((await api.GET(request('mode=sent&kind=expedientes'))).status, 403);
  assert.equal(calls.length, 0);
  globalThis.__activityActor = actor;
  assert.equal((await api.GET(request('mode=received&kind=wrong'))).status, 422);
  assert.equal(
    (await api.GET(request('mode=received&kind=formularios', 'Bearer unavailable'))).status,
    503
  );
  const result = await api.GET(request('mode=received&kind=formularios'));
  assert.equal(result.status, 200);
  assert.match(result.headers.get('cache-control'), /no-store/);
  const body = await result.json();
  assert.ok(!JSON.stringify(body).includes(capability));
});

test('saved drafts with a legacy submitted timestamp remain in progress and do not start signing', async () => {
  tables.form_responses = [
    {
      id: inviteId,
      template_id: formId,
      token_id: tokenId,
      status: 'draft',
      submitted_at: '2026-11-17T11:00:00Z',
      document_id: caseId,
    },
  ];
  assert.equal((await receive())[0].state, 'in_progress');
  assert.equal(
    await api.resolveActivityAccess(client(), actor, 'form-token', tokenId, secret, now),
    `/form/${capability}`
  );
});

test('expired recipients keep the original invitation without seeing current case status or progress', async () => {
  tables.workspace_members = [];
  tables.case_files[0].status = 'sealed';
  tables.case_participant_invitations[0].case_title = 'Título original de la invitación';
  tables.case_participant_invitations[0].expires_at = '2026-01-01T00:00:00Z';
  const rows = await api.loadCaseActivity(client(), actor, 'received', now);
  assert.equal(rows[0].state, 'expired');
  assert.equal(rows[0].title, 'Título original de la invitación');
  assert.equal(rows[0].progress, null);
  assert.ok(rows[0].actions[0].disabledReason);
});

test('open route validates same-origin input and recipient ownership without exposing another invitation', async () => {
  const { NextRequest } = await import('next/server.js');
  const request = (body, origin = 'http://localhost') =>
    new NextRequest('http://localhost/api/activity/open', {
      method: 'POST',
      headers: { authorization: 'Bearer fixture', origin, 'content-type': 'application/json' },
      body,
    });
  assert.equal(
    (
      await api.POST(
        request(JSON.stringify({ source: 'form-token', id: tokenId }), 'https://untrusted.example')
      )
    ).status,
    403
  );
  assert.equal(calls.length, 0);
  assert.equal((await api.POST(request('{'))).status, 422);
  assert.equal(
    (await api.POST(request(JSON.stringify({ source: 'form-token', id: 'wrong' })))).status,
    422
  );
  tables.form_tokens[0].recipient_user_id = other;
  const denied = await api.POST(request(JSON.stringify({ source: 'form-token', id: tokenId })));
  assert.equal(denied.status, 403);
  assert.ok(!JSON.stringify(await denied.json()).includes(capability));
  tables.form_tokens[0].recipient_user_id = user;
  const allowed = await api.POST(request(JSON.stringify({ source: 'form-token', id: tokenId })));
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).data.url, `/form/${capability}`);
});

test('temporary session failures show a human explanation rather than a technical error code', () => {
  assert.match(api.activityErrorMessage({ error: 'SESSION_POLICY_UNAVAILABLE' }), /temporalmente/);
  assert.equal(
    api.activityErrorMessage({ error: 'AUTH_INVALID', message: 'Inicia sesión para continuar.' }),
    'Inicia sesión para continuar.'
  );
  assert.ok(!api.activityErrorMessage({ error: 'PGRST002' }).includes('PGRST002'));
  assert.equal(
    api.activityErrorMessage({ error: 'La invitación venció.' }),
    'La invitación venció.'
  );
});

test('backend failures are not rendered as an empty inbox or exposed as raw database errors', async () => {
  const { NextRequest } = await import('next/server.js');
  failTable = 'form_tokens';
  const result = await api.GET(
    new NextRequest('http://localhost/api/activity?mode=sent&kind=formularios', {
      headers: { authorization: 'Bearer fixture' },
    })
  );
  assert.equal(result.status, 503);
  assert.ok(!JSON.stringify(await result.json()).includes('synthetic backend error'));
});
