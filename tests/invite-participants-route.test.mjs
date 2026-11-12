import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const directory = 'node_modules/.cache/docubox-invite-route-tests';
const outfile = `${directory}/route.mjs`;
await mkdir(directory, { recursive: true });

const mocks = {
  'next/server': `export const NextResponse = { json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200, headers: { 'content-type': 'application/json' } }) };`,
  'next/headers': `export const cookies = async () => ({ getAll: () => [], set: () => {} });`,
  '@supabase/ssr': `export const createServerClient = () => ({ auth: { getUser: async () => ({ data: { user: globalThis.__inviteTest.user }, error: null }) } });`,
  '@/lib/supabase/server': `export const createServiceClient = () => ({ from(table) {
    const query = {
      table, payload: null, operation: 'read',
      select() { return this; }, eq() { return this; }, is() { return this; }, ilike() { return this; },
      update(payload) { this.operation = 'update'; this.payload = payload; return this; },
      insert(payload) { globalThis.__inviteTest.audits.push(payload); return Promise.resolve({ error: null }); },
      maybeSingle() {
        const state = globalThis.__inviteTest;
        if (this.operation === 'update') { state.updates.push(this.payload); return Promise.resolve({ data: { id: state.doc.id }, error: null }); }
        if (table === 'documentos') return Promise.resolve({ data: state.doc, error: null });
        return Promise.resolve({ data: null, error: null });
      },
    };
    return query;
  } });`,
  '@/lib/orchestration/document-delivery': `export const deliverDocumentInvitations = async (...args) => { globalThis.__inviteTest.deliveries.push(args); return { sent: [], failed: [] }; }; export const stampDeliveredParticipants = (parts) => parts;`,
};

await build({
  entryPoints: ['src/app/api/documentos/invitar-participantes/route.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'silent',
  plugins: [
    {
      name: 'isolated-services',
      setup(context) {
        context.onResolve(
          {
            filter:
              /^(next\/server|next\/headers|@supabase\/ssr|@\/lib\/(supabase\/server|orchestration\/document-delivery))$/,
          },
          ({ path }) => ({ path, namespace: 'isolated-services' })
        );
        context.onLoad({ filter: /.*/, namespace: 'isolated-services' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'js',
        }));
      },
    },
  ],
});

const { POST } = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
const documentId = 'c93bbab0-cc20-4b4a-9805-e915249ae99a';
function setup(overrides = {}) {
  globalThis.__inviteTest = {
    user: { id: 'owner-1', email: 'owner@example.test', user_metadata: {} },
    doc: {
      id: documentId,
      owner_id: 'owner-1',
      workspace_id: 'workspace-1',
      nombre: 'Contrato',
      descripcion: null,
      estado: 'en_proceso',
      participant_mode: 'yo_y_otros',
      participation_order: 'paralelo',
      grupos_firma: [],
      participantes: [
        {
          id: 'owner-participant',
          user_id: 'owner-1',
          email: 'owner@example.test',
          isCurrentUser: true,
        },
      ],
      ...overrides,
    },
    updates: [],
    audits: [],
    deliveries: [],
  };
}
function invite(email = 'new@example.test') {
  return POST(
    new Request('http://localhost/api/documentos/invitar-participantes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        documentId,
        participants: [
          {
            name: 'Nuevo Participante',
            email,
            acto: 'Firmante',
            rolDocumento: 'Accionista',
            tipoFirma: ['autografa'],
            tipoNotificacion: ['correo'],
            deliveryMode: 'remote',
          },
        ],
      }),
    })
  );
}

test('blocks invitations for Solo yo on the server', async () => {
  setup({ participant_mode: 'solo_yo' });
  assert.equal((await invite()).status, 409);
  assert.equal(globalThis.__inviteTest.updates.length, 0);
});

test('blocks invitation by someone other than the owner', async () => {
  setup();
  globalThis.__inviteTest.user.id = 'another-user';
  assert.equal((await invite()).status, 403);
  assert.equal(globalThis.__inviteTest.updates.length, 0);
});

test('blocks invitations once the document is completed', async () => {
  setup({ estado: 'completado' });
  assert.equal((await invite()).status, 409);
});

test('blocks an existing participant email, including historical entries', async () => {
  setup({ participantes: [{ email: 'new@example.test', current_access: false }] });
  assert.equal((await invite()).status, 409);
  assert.equal(globalThis.__inviteTest.updates.length, 0);
});

test('adds and delivers a configured participant in parallel mode', async () => {
  setup();
  const response = await invite();
  assert.equal(response.status, 200);
  const participant = globalThis.__inviteTest.updates[0].participantes[1];
  assert.equal(participant.visible, true);
  assert.equal(participant.email, 'new@example.test');
  assert.equal(participant.acto, 'Firmante');
  assert.ok(participant.portal_token);
  assert.equal(globalThis.__inviteTest.deliveries.length, 1);
  assert.equal(globalThis.__inviteTest.audits.length, 1);
});

test('allows Solo otros when the owner is not a participant', async () => {
  setup({
    participant_mode: 'solo_otros',
    participantes: [{ id: 'other', email: 'other@example.test' }],
  });
  assert.equal((await invite()).status, 200);
  assert.equal(globalThis.__inviteTest.updates[0].participant_mode, 'solo_otros');
});

test('recognizes the owner by email in an older Solo yo document', async () => {
  setup({ participant_mode: null, participantes: [{ id: 'old', email: 'owner@example.test' }] });
  assert.equal((await invite()).status, 409);
  assert.equal(globalThis.__inviteTest.updates.length, 0);
});

test('queues a new participant at the end of a sequential flow', async () => {
  setup({ participation_order: 'secuencial' });
  const response = await invite();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).queued, true);
  assert.equal(globalThis.__inviteTest.updates[0].participantes[1].visible, false);
  assert.equal(globalThis.__inviteTest.deliveries.length, 0);
});

test('appends a final group in a mixed flow', async () => {
  setup({
    participation_order: 'mixto',
    grupos_firma: [{ id: 'first', tipo: 'paralelo', participantIds: ['existing'] }],
  });
  const response = await invite();
  assert.equal(response.status, 200);
  const update = globalThis.__inviteTest.updates[0];
  assert.equal(update.participantes[1].visible, false);
  assert.deepEqual(update.grupos_firma[1].participantIds, [update.participantes[1].id]);
});
