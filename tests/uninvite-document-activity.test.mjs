import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const directory = 'node_modules/.cache/docubox-uninvite-activity-tests';
const outfile = `${directory}/route.mjs`;
await mkdir(directory, { recursive: true });

await build({
  entryPoints: ['src/app/api/documentos/[documentId]/activity/route.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'silent',
  plugins: [{
    name: 'activity-services',
    setup(context) {
      context.onResolve({ filter: /^@\/lib\/security\/(document-content-access|document-access)$/ }, ({ path }) => ({ path, namespace: 'activity-services' }));
      context.onLoad({ filter: /.*/, namespace: 'activity-services' }, ({ path }) => ({
        contents: path.endsWith('document-content-access')
          ? `export const requireDocumentContentAccess = async () => globalThis.__activityTest.access;`
          : `export const documentAccessResponse = () => ({ status: 500, body: {} });`,
        loader: 'js',
      }));
    },
  }],
});

const { GET } = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);

function setup(auditRows) {
  const document = {
    id: 'document-1', owner_id: null, nombre: 'Documento',
    created_at: '2026-10-01T00:00:00.000Z', estado: 'en_proceso',
    participantes: [{
      id: 'invite-1', nombre: 'Participante de prueba', email: 'invitee@example.test',
      sub_estado: 'revocado', participant_relationship_status: 'REVOKED',
      access_revoked_at: '2026-10-02T00:00:00.000Z',
    }],
  };
  const service = { from(table) {
    return {
      select() { return this; }, eq() { return this; }, order() { return this; },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      then(resolve, reject) {
        return Promise.resolve({
          data: table === 'document_lifecycle_audit_events' ? auditRows : [],
          error: null,
        }).then(resolve, reject);
      },
    };
  } };
  globalThis.__activityTest = { access: { document, service, additionalAccessLevel: null } };
}

async function events() {
  const response = await GET(new Request('http://localhost/api/documentos/document-1/activity'), {
    params: Promise.resolve({ documentId: 'document-1' }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).events;
}

test('document activity shows the immutable uninvite audit with actor and time', async () => {
  setup([{
    id: 'audit-1', action: 'PARTICIPANT_UNINVITED',
    previous_state: { participant_name: 'Participante de prueba' },
    actor_email: 'owner@example.test', created_at: '2026-10-02T00:00:00.000Z',
  }]);
  const uninvites = (await events()).filter((event) => event.action === 'PARTICIPANT_UNINVITED');
  assert.equal(uninvites.length, 1);
  assert.equal(uninvites[0].actor_name, 'owner@example.test');
  assert.equal(uninvites[0].created_at, '2026-10-02T00:00:00.000Z');
  assert.match(uninvites[0].details.description, /Participante de prueba/);
});

test('document activity uses the persisted revocation timestamp if the audit insert failed', async () => {
  setup([]);
  const uninvites = (await events()).filter((event) => event.action === 'PARTICIPANT_UNINVITED');
  assert.equal(uninvites.length, 1);
  assert.equal(uninvites[0].source, 'synthesized');
  assert.equal(uninvites[0].created_at, '2026-10-02T00:00:00.000Z');
});
