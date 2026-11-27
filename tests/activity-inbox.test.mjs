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
const columnValue = (row, path) => {
  const [column, field] = path.split('->>');
  return field ? row[column]?.[field] : row[column];
};

function client() {
  return {
    from(table) {
      let rows = [...(tables[table] || [])];
      let single = false;
      let jsonAliases = [];
      const orders = [];
      const sortRows = () => rows.sort((a, b) => {
        for (const [field, ascending] of orders) {
          const order = String(a[field] || '').localeCompare(String(b[field] || ''));
          if (order) return ascending ? order : -order;
        }
        return 0;
      });
      const q = {
        select(columns) {
          calls.push({ table, columns });
          jsonAliases = columns
            .split(',')
            .map((column) => column.split(':'))
            .filter(([, path]) => path?.includes('->>'));
          return this;
        },
        eq(field, value) {
          calls.push({ table, field, value });
          rows = rows.filter((row) => columnValue(row, field) === value);
          return this;
        },
        is(field, value) {
          rows = rows.filter((row) =>
            value === null ? columnValue(row, field) == null : columnValue(row, field) === value
          );
          return this;
        },
        not(field, operator, value) {
          assert.equal(operator, 'is');
          rows = rows.filter((row) =>
            value === null ? columnValue(row, field) != null : columnValue(row, field) !== value
          );
          return this;
        },
        neq(field, value) {
          rows = rows.filter((row) => row[field] !== value);
          return this;
        },
        filter(field, operator, value) {
          calls.push({ table, field, operator, value });
          if (operator === 'eq') return this.eq(field, value);
          assert.equal(operator, 'ilike');
          const literal = value.replace(/\\([\\%_])/g, '$1').toLowerCase();
          rows = rows.filter((row) => row[field]?.toLowerCase() === literal);
          return this;
        },
        in(field, values) {
          rows = rows.filter((row) => values.includes(columnValue(row, field)));
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
          rows = sortRows().slice(start, end + 1);
          return this;
        },
        limit(count) {
          rows = sortRows().slice(0, count);
          return this;
        },
        maybeSingle() {
          single = true;
          return this;
        },
        then(resolve) {
          const result = rows.map((row) => ({
            ...row,
            ...Object.fromEntries(
              jsonAliases.map(([alias, path]) => [alias, columnValue(row, path)])
            ),
          }));
          return Promise.resolve({
            data: single ? result[0] || null : result,
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
    contents: `export * from './src/lib/activity/inbox.server'; export * from './src/lib/activity/access.server'; export * from './src/lib/activity/model'; export * from './src/lib/activity/request-error'; export { GET } from './src/app/api/activity/route'; export { POST } from './src/app/api/activity/open/route'; export { GET as contactActivity } from './src/app/api/contactos/[id]/actividad/route'; export { encryptInvitationSecret } from './src/lib/case-files/invitations';`,
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
        build.onResolve({ filter: /(?:lib\/case-files\/|\.\/)runtime\.server$/ }, () => ({
          path: 'case-runtime',
          namespace: 'fixture',
        }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'server-only'
              ? ''
              : path === 'next-response'
                ? 'export class NextResponse extends Response { static json(body, init) { return new NextResponse(JSON.stringify(body), init); } }'
                : path === 'service'
                  ? 'export const createAnonClient = () => globalThis.__activityDb; export const createServiceClient = createAnonClient;'
                  : path === 'case-runtime'
                    ? `export const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value); export class CaseRuntimeError extends Error { constructor(code, message, status) { super(message); this.code=code; this.status=status; } }`
                    : `export class DocumentAccessError extends Error { constructor(code, message, status) { super(message); this.code=code; this.status=status; } } export async function requireDocumentIdentity(request) { if (!request.headers.get('authorization')) throw new DocumentAccessError('AUTH_REQUIRED','Inicia sesión',401); if(request.headers.get('authorization')==='Bearer unavailable') throw new DocumentAccessError('AUTH_UNAVAILABLE','No se pudo verificar',503); return { token: 'fixture', user: globalThis.__activityActor }; }`,
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
    case_file_participants: [
      { id: other, case_file_id: caseId, workspace_id: space, user_id: user, status: 'active' },
    ],
    case_participant_invitations: [
      {
        id: inviteId,
        case_file_id: caseId,
        workspace_id: space,
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

const contactId = '88888888-8888-4888-8888-888888888888';
const contactEmail = 'agenda_qa@example.test';
const outsideSpace = '99999999-9999-4999-8999-999999999999';
const verifiedDate = '2026-11-17T11:08:00Z';

function readContact(kind, workspaceId = space, authorization = 'Bearer fixture') {
  const nextUrl = new URL(
    `http://localhost/api/contactos/${contactId}/actividad?tipo=${kind}&workspaceId=${workspaceId}`
  );
  return api.contactActivity(
    { nextUrl, headers: new Headers({ authorization }), signal: new AbortController().signal },
    { params: Promise.resolve({ id: contactId }) }
  );
}

test('contact activity checks the agenda owner, authenticated session and active workspace', async () => {
  tables.contacts = [{ id: contactId, user_id: other, email: contactEmail }];
  assert.equal((await readContact('identidad')).status, 404);
  assert.ok(!calls.some(({ table }) => table === 'id_capture_logs'));
  tables.contacts[0].user_id = user;
  assert.equal((await readContact('identidad', space, '')).status, 401);
  assert.equal((await readContact('identidad', outsideSpace)).status, 403);
  assert.equal((await readContact('aportada', outsideSpace)).status, 403);
  assert.ok(!calls.some(({ table }) => table === 'id_capture_logs'));
  assert.ok(!calls.some(({ table }) => table === 'case_portal_uploads'));
});

test('contact forms match the recipient in the selected space and exclude forms bound to a case', async () => {
  tables.contacts = [{ id: contactId, user_id: user, email: contactEmail }];
  tables.form_templates.push({
    ...tables.form_templates[0],
    id: other,
    workspace_id: outsideSpace,
    name: 'Otro espacio',
  });
  tables.workspace_members.push({ workspace_id: outsideSpace, user_id: user, status: 'active' });
  const launch = { ...tables.form_tokens[0], recipient_email: contactEmail.toUpperCase() };
  tables.form_tokens = [
    launch,
    { ...launch, id: 'case-form' },
    { ...launch, id: 'outside-space', template_id: other },
    { ...launch, id: 'different-contact', recipient_email: 'agendaXqa@example.test' },
    { ...launch, id: 'different-sender', launched_by_user_id: other },
  ];
  tables.case_portal_form_tokens = [{ token_id: 'case-form' }];
  const response = await readContact('formularios');
  const { data } = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(
    data.map((row) => row.id),
    [`token:${tokenId}`]
  );
  assert.match(data[0].action.href, /^\/formularios\/respuestas\?/);
  assert.ok(
    calls.some((call) => call.operator === 'ilike' && call.value === 'agenda\\_qa@example.test')
  );
  assert.ok(!JSON.stringify(data).includes(capability));
});

test('contact cases join all matching roles and real progress without including another workspace', async () => {
  tables.contacts = [{ id: contactId, user_id: user, email: contactEmail }];
  tables.case_files.push({ ...tables.case_files[0], id: other, workspace_id: outsideSpace });
  tables.case_file_participants = [
    { id: 'a', workspace_id: space, case_file_id: caseId, email: contactEmail, role: 'subject' },
    {
      id: 'b',
      workspace_id: space,
      case_file_id: caseId,
      email: contactEmail.toUpperCase(),
      role: 'representative',
    },
    { id: 'c', workspace_id: space, case_file_id: caseId, email: actor.email, role: 'contact' },
    {
      id: 'd',
      workspace_id: outsideSpace,
      case_file_id: other,
      email: contactEmail,
      role: 'subject',
    },
  ];
  const response = await readContact('expedientes');
  const { data } = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(
    data.map((row) => [row.id, row.context, row.progress, row.action.href]),
    [[caseId, 'Titular · Representante', 25, `/expedientes/${caseId}`]]
  );
});

test('contact identity exposes only scoped verification outcomes from documents, forms and case invitations', async () => {
  tables.contacts = [{ id: contactId, user_id: user, email: contactEmail }];
  tables.form_tokens[0].recipient_email = contactEmail;
  tables.form_tokens[0].liveness_verified_at = verifiedDate;
  tables.case_file_participants = [
    { id: other, workspace_id: space, case_file_id: caseId, email: contactEmail, role: 'subject' },
  ];
  tables.case_participant_invitations[0].recipient = contactEmail;
  tables.case_participant_invitations[0].workspace_id = space;
  tables.case_participant_invitations.push({
    ...tables.case_participant_invitations[0],
    id: 'another-invite',
    recipient: actor.email,
  });
  tables.case_invitation_access_grants = [
    { invitation_id: inviteId, user_id: other, liveness_verified_at: verifiedDate },
    { invitation_id: 'another-invite', user_id: user, liveness_verified_at: verifiedDate },
  ];
  tables.documentos = [
    {
      id: 'legacy',
      nombre: 'Documento A',
      workspace_id: space,
      owner_id: user,
      estado: 'completado',
      participantes: [{ email: contactEmail }],
    },
    {
      id: 'owned',
      nombre: 'Documento B',
      workspace_id: space,
      owner_id: user,
      estado: 'en_progreso',
      participantes: [{ email: contactEmail, user_id: other }],
    },
    {
      id: 'other-owner',
      nombre: 'Documento de otra persona',
      workspace_id: space,
      owner_id: other,
      estado: 'completado',
      participantes: [{ email: contactEmail, user_id: other }],
    },
  ];
  tables.participation_responses = [
    { id: 'r', documento_id: 'legacy', participante_id: other, participante_email: contactEmail },
  ];
  const log = {
    id: 'proof',
    document_id: 'legacy',
    user_id: other,
    created_at: verifiedDate,
    identity_match: true,
    nubarium_aprobado: true,
    selfie_b64: 'synthetic-evidence',
  };
  tables.id_capture_logs = [
    log,
    { ...log, id: 'failed-proof', document_id: 'owned', identity_match: false },
    { ...log, id: 'wrong-signer', user_id: user },
    { ...log, id: 'wrong-owner', document_id: 'other-owner' },
  ];
  const response = await readContact('identidad');
  const { data } = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(data.map((row) => [row.id, row.status]).sort(), [
    [`case:${inviteId}:${verifiedDate}`, 'Aprobada'],
    ['document:failed-proof', 'Sin aprobación'],
    ['document:proof', 'Aprobada'],
    [`form:token:${tokenId}`, 'Aprobada'],
  ]);
  assert.ok(!JSON.stringify(data).includes('synthetic-evidence'));
  assert.ok(calls.every((call) => !call.columns?.includes('selfie_b64')));
});

test('contact contributions show only completed uploads tied to the contact and the correct case', async () => {
  tables.contacts = [{ id: contactId, user_id: user, email: contactEmail }];
  tables.case_file_participants = [
    { id: other, workspace_id: space, case_file_id: caseId, email: contactEmail, role: 'subject' },
  ];
  const invitation = {
    ...tables.case_participant_invitations[0],
    workspace_id: space,
    recipient: contactEmail,
  };
  tables.case_participant_invitations = [
    invitation,
    { ...invitation, id: 'other-recipient', recipient: actor.email },
  ];
  const upload = {
    id: 'current',
    invitation_id: inviteId,
    requirement_id: 'req',
    document_id: 'new-file',
    file_name: 'comprobante.pdf',
    status: 'completed',
    completed_at: verifiedDate,
    storage_path: 'private-object',
  };
  tables.case_portal_uploads = [
    upload,
    {
      ...upload,
      id: 'previous',
      document_id: 'original-file',
      file_name: 'comprobante-anterior.pdf',
    },
    { ...upload, id: 'not-committed', status: 'staging' },
    { ...upload, id: 'other-contact', invitation_id: 'other-recipient' },
    { ...upload, id: 'wrong-case', requirement_id: 'req-other-case' },
    { ...upload, id: 'wrong-workspace', requirement_id: 'req-other-workspace' },
  ];
  const requirement = {
    id: 'req',
    workspace_id: space,
    case_file_id: caseId,
    title: 'Comprobante de domicilio',
    status: 'approved',
  };
  tables.case_file_requirements = [
    requirement,
    { ...requirement, id: 'req-other-case', case_file_id: other },
    { ...requirement, id: 'req-other-workspace', workspace_id: outsideSpace },
  ];
  tables.case_file_documents = [
    {
      id: 'attached',
      workspace_id: space,
      case_file_id: caseId,
      requirement_id: requirement.id,
      source_document_id: upload.document_id,
    },
  ];

  const response = await readContact('aportada');
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.deepEqual(
    data.map((row) => [row.id, row.status]),
    [
      ['upload:current', 'Aprobado'],
      ['upload:previous', 'Versión anterior'],
    ]
  );
  assert.ok(
    data.every(
      (row) =>
        row.origin === 'expediente' &&
        row.description === requirement.title &&
        row.action.href === `/expedientes/${caseId}?tab=documentos`
    )
  );
  assert.ok(!JSON.stringify(data).includes('private-object'));
});

test('identity contributions require a document capture bound to the contact in its original process', async () => {
  const captureId = '09090909-0909-4909-8909-090909090909';
  const otherCaptureId = '08080808-0808-4808-8808-080808080808';
  tables.contacts = [{ id: contactId, user_id: user, email: contactEmail }];
  tables.case_file_participants = [
    { id: other, workspace_id: space, case_file_id: caseId, email: contactEmail, role: 'subject' },
  ];
  tables.case_participant_invitations[0].recipient = contactEmail;
  tables.case_participant_invitations[0].workspace_id = space;
  tables.form_tokens = [];
  tables.form_public_invitees = [
    { form_id: formId, recipient_email: contactEmail, invited_by: user, invited_at: verifiedDate },
  ];
  tables.documentos = [
    {
      id: 'owned',
      nombre: 'Documento de firma',
      workspace_id: space,
      owner_id: user,
      estado: 'completado',
      participantes: [{ email: contactEmail, user_id: other }],
    },
  ];
  const log = {
    id: 'signing',
    document_id: 'owned',
    user_id: other,
    created_at: verifiedDate,
    identity_match: true,
    nubarium_aprobado: true,
    anverso_b64: 'camera-data',
    selfie_b64: 'biometric-data',
  };
  tables.id_capture_logs = [
    log,
    { ...log, id: 'selfie-only', anverso_b64: null },
    { ...log, id: 'other-signer', user_id: user },
    {
      ...log,
      id: 'case-id',
      document_id: null,
      identity_match: false,
      raw_nubarium_response: { mode: 'case_portal_liveness', case_invitation_id: inviteId },
    },
    {
      ...log,
      id: 'other-invite-id',
      document_id: null,
      raw_nubarium_response: { mode: 'case_portal_liveness', case_invitation_id: 'not-the-invite' },
    },
    { ...log, id: captureId, document_id: null },
    { ...log, id: otherCaptureId, document_id: null, user_id: user },
  ];
  const metadata = {
    mode: 'public_form_liveness',
    form_id: formId,
    recipient_email: contactEmail,
    capture_log_id: captureId,
  };
  tables.mobile_upload_sessions = [
    { id: 'form-session', status: 'completed', user_id: other, metadata },
    {
      id: 'wrong-account',
      status: 'completed',
      user_id: other,
      metadata: { ...metadata, capture_log_id: otherCaptureId },
    },
    {
      id: 'wrong-email',
      status: 'completed',
      user_id: user,
      metadata: { ...metadata, recipient_email: actor.email, capture_log_id: otherCaptureId },
    },
  ];

  const response = await readContact('aportada');
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.deepEqual(data.map((row) => [row.id, row.status]).sort(), [
    ['case-identification:case-id', 'Sin aprobación'],
    ['document:signing', 'Aprobada'],
    [`form-identification:${captureId}`, 'Aprobada'],
  ]);
  assert.ok(
    data.every((row) => row.origin === 'identidad' && row.title === 'Identificación oficial')
  );
  assert.ok(data.some((row) => row.action.href === `/expedientes/${caseId}?tab=identidad`));
  assert.ok(data.some((row) => row.action.href === `/formularios/respuestas?id=${formId}`));
  assert.ok(!/camera-data|biometric-data/.test(JSON.stringify(data)));
  const forbidden = /(^|,)(anverso_b64|selfie_b64|token|key_ciphertext|storage_path|metadata)(,|$)/;
  assert.ok(calls.every((call) => !call.columns || !forbidden.test(call.columns)));
});

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

test('sent form actions follow the responses screen availability', async () => {
  for (const status of ['published', 'paused', 'archived']) {
    tables.form_templates[0].status = status;
    const [item] = await send();
    assert.deepEqual(item.actions.map((action) => action.label), status === 'archived'
      ? ['Ver formulario'] : ['Ver respuestas', 'Ver formulario']);
    assert.equal(item.actions.at(-1).href, `/formularios/preview?id=${formId}`);
  }
});

test('a saved signature can resume PDF preparation after expiry; an unused expired invitation stays closed', async () => {
  const openForm = () => api.resolveActivityAccess(client(), actor, 'form-token', tokenId, secret, now);
  const token = tables.form_tokens[0];
  token.expires_at = '2026-11-17T11:30:00Z';
  assert.equal((await receive())[0].state, 'expired');
  await assert.rejects(openForm(), /venció/);

  tables.form_templates[0].requires_signature = true;
  tables.form_templates[0].status = 'archived';
  token.used_at = '2026-11-17T11:00:00Z';
  tables.form_responses = [{
    id: inviteId, token_id: tokenId, status: 'submitted',
    submitted_at: token.used_at, document_id: null,
  }];
  const [item] = await receive();
  assert.equal(item.actions[0].label, 'Continuar firma');
  assert.equal(item.actions[0].disabledReason, undefined);
  assert.equal(await openForm(), `/form/${capability}`);

  tables.form_templates[0].requires_signature = false;
  assert.match((await receive())[0].actions[0].disabledReason, /documento para consultar/);
  await assert.rejects(openForm(), /documento para consultar/);
});

test('received forms renew public verification through the code entry and honor private link identity', async () => {
  const openToken = () => api.resolveActivityAccess(client(), actor, 'form-token', tokenId, secret, now);
  const token = tables.form_tokens[0];
  token.recipient_email = 'old@example.test';
  assert.match((await receive())[0].actions[0].disabledReason, /otra cuenta/);
  await assert.rejects(openToken(), /otra cuenta/);

  token.recipient_email = actor.email;
  token.access_mode = 'public';
  token.liveness_verified_at = '2026-11-15T10:00:00Z';
  tables.form_public_invitees = [{
    form_id: formId, recipient_email: actor.email, invited_at: '2026-11-17T09:30:00Z',
  }];
  const [item] = await receive();
  assert.equal(item.actions[0].label, 'Abrir con código');
  assert.equal(item.actions[0].open.source, 'form-public');
  await assert.rejects(openToken(), /verificación de identidad/);
  assert.equal(await api.resolveActivityAccess(client(), actor, 'form-public', formId, secret, now),
    `/formulario-publico/${formId}`);

  token.liveness_verified_at = '2026-11-17T11:30:00Z';
  assert.equal((await receive())[0].actions[0].open.source, 'form-token');
  assert.equal(await openToken(), `/form/${capability}`);
});

test('the inbox and opening route both use the latest form response', async () => {
  tables.form_templates[0].requires_signature = true;
  tables.form_responses = [
    { id: tokenId, token_id: tokenId, status: 'submitted',
      submitted_at: '2026-11-17T10:30:00Z', document_id: caseId },
    { id: inviteId, token_id: tokenId, status: 'signed',
      submitted_at: '2026-11-17T11:00:00Z', document_id: space },
  ];
  assert.equal((await receive())[0].actions[0].label, 'Ver mi respuesta');
  assert.equal(
    await api.resolveActivityAccess(client(), actor, 'form-token', tokenId, secret, now),
    `/visor-documento/${space}`
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

test('future access is disabled until the invitation starts and keeps the original snapshot', async () => {
  tables.workspace_members = [];
  const invitation = tables.case_participant_invitations[0];
  invitation.case_title = 'Expediente según la invitación';
  invitation.not_before = '2026-11-18T10:00:00Z';
  const [pending] = await api.loadCaseActivity(client(), actor, 'received', now);
  assert.equal(pending.state, 'scheduled');
  assert.equal(pending.scheduledAt, invitation.not_before);
  assert.equal(pending.title, invitation.case_title);
  assert.equal(pending.progress, null);
  assert.match(pending.actions[0].disabledReason, /programado/);
  const start = Date.parse(invitation.not_before);
  const [active] = await api.loadCaseActivity(client(), actor, 'received', start);
  assert.equal(active.actions[0].disabledReason, undefined);
  assert.equal(active.progress, 25);
  assert.equal(await api.resolveActivityAccess(client(), actor, 'case-invitation', inviteId, secret, start),
    `/expediente/${capability}`);
});

test('cancelled cases remain consultable internally and the participation is disabled', async () => {
  tables.case_files[0].status = 'cancelled';
  const [sent] = await api.loadCaseActivity(client(), actor, 'sent', now);
  assert.equal(sent.actions[0].href, `/expedientes/${caseId}`);
  const [received] = await api.loadCaseActivity(client(), actor, 'received', now);
  assert.equal(received.actions[0].label, 'Consultar expediente');
  assert.match(received.actions[1].disabledReason, /cancelado/);
  await assert.rejects(
    api.resolveActivityAccess(client(), actor, 'case-invitation', inviteId, secret, now),
    /cancelado/
  );
  tables.workspace_members = [];
  const [external] = await api.loadCaseActivity(client(), actor, 'received', now);
  assert.equal(external.progress, null);
  assert.equal(external.actions.length, 1);
  assert.match(external.actions[0].disabledReason, /cancelado/);
});

test('a valid participant role is preferred over a more recent revoked role', async () => {
  tables.workspace_members = [];
  const old = tables.case_participant_invitations[0];
  tables.case_file_participants.push({
    ...tables.case_file_participants[0], id: formId, status: 'revoked',
  });
  tables.case_participant_invitations.push({
    ...old, id: tokenId, participant_id: formId, created_at: '2026-11-17T10:30:00Z',
  });
  const [received] = await api.loadCaseActivity(client(), actor, 'received', now);
  assert.equal(received.actions[0].open.id, inviteId);
  assert.equal(received.actions[0].disabledReason, undefined);
  await assert.rejects(
    api.resolveActivityAccess(client(), actor, 'case-invitation', tokenId, secret, now),
    /no está activa/
  );

  tables.case_file_participants[0].user_id = other;
  const [onlyHistory] = await api.loadCaseActivity(client(), actor, 'received', now);
  assert.equal(onlyHistory.progress, null);
  assert.ok(onlyHistory.actions[0].disabledReason);
  await assert.rejects(
    api.resolveActivityAccess(client(), actor, 'case-invitation', inviteId, secret, now),
    /tu cuenta/
  );
});

test('a sealed case can still be consulted and viewed by an active invitee', async () => {
  tables.case_files[0].status = 'sealed';
  const [received] = await api.loadCaseActivity(client(), actor, 'received', now);
  assert.equal(received.actions[0].label, 'Consultar expediente');
  assert.equal(received.actions[1].disabledReason, undefined);
  assert.equal(await api.resolveActivityAccess(client(), actor, 'case-invitation', inviteId, secret, now),
    `/expediente/${capability}`);
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
