import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const directory = 'node_modules/.cache/docubox-uninvite-route-tests';
const outfile = `${directory}/route.mjs`;
await mkdir(directory, { recursive: true });

const mocks = {
  'next/server': `export const NextResponse = { json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200, headers: { 'content-type': 'application/json' } }) };`,
  'next/headers': `export const cookies = async () => ({ getAll: () => [], set: () => {} });`,
  '@supabase/ssr': `export const createServerClient = () => ({ auth: { getUser: async () => ({ data: { user: globalThis.__uninviteTest.user }, error: null }) } });`,
  '@/lib/supabase/server': `
    export const createServiceClient = () => ({ from(table) {
      const query = {
        operation: 'read', payload: null,
        select() { return this; }, eq() { return this; }, in() { return this; },
        update(payload) { this.operation = 'update'; this.payload = payload; return this; },
        insert(payload) { globalThis.__uninviteTest.audits.push(payload); return Promise.resolve({ error: null }); },
        single() { return Promise.resolve({ data: globalThis.__uninviteTest.doc, error: null }); },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        then(resolve, reject) {
          const state = globalThis.__uninviteTest;
          if (this.operation === 'update') {
            state.updates.push(this.payload);
            return Promise.resolve({ error: null }).then(resolve, reject);
          }
          const rows = {
            participation_responses: state.responses,
            document_activity_log: state.activity,
            document_lifecycle_audit_events: state.viewAccess,
            document_encryption_security_events: state.fileAccess,
          }[table] || [];
          return Promise.resolve({ data: rows, error: state.errorTable === table ? { message: 'read failed' } : null }).then(resolve, reject);
        },
      };
      return query;
    } });`,
  '@/lib/emailNotifications': `export const sendParticipationCompletionEmail = async () => {}; export const sendParticipationCompletionEmailToAll = async () => {}; export const sendOwnerParticipantActionEmail = async () => {};`,
  '@/lib/notificationsInApp.server': `export const createNotificationServer = async () => {}; export const createNotificationsForUsersServer = async () => {};`,
};

await build({
  entryPoints: ['src/app/api/documentos/update-estado/route.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'silent',
  plugins: [{
    name: 'isolated-services',
    setup(buildContext) {
      buildContext.onResolve({ filter: /^(next\/server|next\/headers|@supabase\/ssr|@\/lib\/(supabase\/server|emailNotifications|notificationsInApp\.server))$/ }, ({ path }) => ({ path, namespace: 'isolated-services' }));
      buildContext.onLoad({ filter: /.*/, namespace: 'isolated-services' }, ({ path }) => ({ contents: mocks[path], loader: 'js' }));
    },
  }],
});

const { POST } = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);

function setup(participant, responses = []) {
  globalThis.__uninviteTest = {
    user: { id: 'owner', email: 'owner@example.test' },
    doc: {
      id: 'document-1', owner_id: 'owner', workspace_id: null,
      estado: 'en_proceso', nombre: 'Prueba aislada', participantes: [participant],
    },
    responses,
    activity: [],
    viewAccess: [],
    fileAccess: [],
    errorTable: null,
    updates: [],
    audits: [],
  };
}

async function uninvite() {
  const request = new Request('http://localhost/api/documentos/update-estado', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'desinvitar', documentoId: 'document-1',
      participantId: 'invite-1', participantEmail: 'invitee@example.test',
    }),
  });
  return POST(request);
}

test('cannot uninvite a participant with a completed status', async () => {
  setup({ id: 'invite-1', user_id: 'invitee', email: 'invitee@example.test', sub_estado: 'firmado' });
  const response = await uninvite();
  assert.equal(response.status, 409);
  assert.equal(globalThis.__uninviteTest.updates.length, 0);
  assert.equal(globalThis.__uninviteTest.audits.length, 0);
});

test('cannot uninvite when a completed response exists despite a pending status', async () => {
  setup(
    { id: 'invite-1', user_id: 'invitee', email: 'invitee@example.test', sub_estado: 'en_revision' },
    [{ participante_id: 'invitee', firma_completada: false }, { participante_id: 'invitee', firma_completada: true }]
  );
  const response = await uninvite();
  assert.equal(response.status, 409);
  assert.equal(globalThis.__uninviteTest.updates.length, 0);
});

test('cannot uninvite a participant who opened the viewer without completing a signature', async () => {
  setup({ id: 'invite-1', user_id: 'invitee', email: 'invitee@example.test', sub_estado: 'en_revision' });
  globalThis.__uninviteTest.activity = [
    { actor_id: 'invitee', actor_email: 'invitee@example.test', action: 'documento_visto' },
  ];
  const response = await uninvite();
  assert.equal(response.status, 409);
  assert.equal(globalThis.__uninviteTest.updates.length, 0);
});

test('cannot uninvite after saving a draft or accepting terms', async () => {
  setup(
    { id: 'invite-1', user_id: 'invitee', email: 'invitee@example.test', sub_estado: 'en_revision' },
    [{ participante_id: 'invitee', terminos_aceptados: true, firma_completada: false }]
  );
  const response = await uninvite();
  assert.equal(response.status, 409);
  assert.equal(globalThis.__uninviteTest.updates.length, 0);
});

test('cannot uninvite after a server-recorded document view', async () => {
  setup({ id: 'invite-1', user_id: 'invitee', email: 'invitee@example.test', sub_estado: 'en_revision' });
  globalThis.__uninviteTest.fileAccess = [
    { user_id: 'invitee', event_type: 'DOCUMENT_VIEWED' },
  ];
  const response = await uninvite();
  assert.equal(response.status, 409);
  assert.equal(globalThis.__uninviteTest.updates.length, 0);
});

test('another participant viewing the document does not block an untouched invitation', async () => {
  setup({ id: 'invite-1', user_id: 'invitee', email: 'invitee@example.test', sub_estado: 'en_revision' });
  globalThis.__uninviteTest.activity = [
    { actor_id: 'someone-else', actor_email: 'other@example.test', action: 'documento_visto' },
  ];
  const response = await uninvite();
  assert.equal(response.status, 200);
});

test('unknown interaction history fails closed', async () => {
  setup({ id: 'invite-1', user_id: 'invitee', email: 'invitee@example.test', sub_estado: 'en_revision' });
  globalThis.__uninviteTest.errorTable = 'document_activity_log';
  const response = await uninvite();
  assert.equal(response.status, 500);
  assert.equal(globalThis.__uninviteTest.updates.length, 0);
});

test('cannot uninvite the document owner when the participant user ID is absent', async () => {
  setup({ id: 'invite-1', email: 'owner@example.test', sub_estado: 'en_revision' });
  const response = await uninvite();
  assert.equal(response.status, 409);
  assert.equal(globalThis.__uninviteTest.updates.length, 0);
});

test('uninviting an untouched invitation revokes access and records the action', async () => {
  setup({ id: 'invite-1', user_id: 'invitee', email: 'invitee@example.test', sub_estado: 'en_revision' });
  const response = await uninvite();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(globalThis.__uninviteTest.updates[0].participantes[0].current_access, false);
  assert.equal(globalThis.__uninviteTest.updates[0].participantes[0].sub_estado, 'revocado');
  assert.equal(globalThis.__uninviteTest.audits[0].action, 'PARTICIPANT_UNINVITED');
  assert.ok(body.revokedAt);
});
