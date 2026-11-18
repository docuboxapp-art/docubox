import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url),
  key = '__organizationUploadQA';
const originalKey = process.env.ORGANIZATION_CREDENTIAL_ENCRYPTION_KEY;
process.env.ORGANIZATION_CREDENTIAL_ENCRYPTION_KEY = 'synthetic-private-key-for-upload-tests-only';
const buildOptions = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  plugins: [
    {
      name: 'upload-qa',
      setup(b) {
        b.onResolve({ filter: /^@\/lib\/organization\/server$/ }, () => ({
          path: 'auth',
          namespace: 'qa',
        }));
        b.onLoad({ filter: /.*/, namespace: 'qa' }, () => ({
          contents: `export class OrganizationApiError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code}}export const authorizeOrganizationRequest=async(r,ws,permission)=>{const h=globalThis.${key};h.permissions.push(permission);if(h.denied)throw new OrganizationApiError(403,'permission_denied','Denegado');return {user:{id:h.actor},service:h.service,userClient:{rpc:async()=>({data:h.ready,error:null})}}};export const organizationApiFailure=e=>Response.json({code:e.code},{status:e.status||422});`,
          loader: 'js',
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
};
await build({
  ...buildOptions,
  entryPoints: ['src/app/api/organizacion/directory-evidence/upload/route.ts'],
  outfile: '.tmp/organization-evidence-upload-qa.cjs',
});
await build({
  ...buildOptions,
  entryPoints: ['src/app/api/organizacion/directory-evidence/route.ts'],
  outfile: '.tmp/organization-evidence-legacy-qa.cjs',
});
const route = require('../.tmp/organization-evidence-upload-qa.cjs');
const legacy = require('../.tmp/organization-evidence-legacy-qa.cjs');
const ws = '11111111-1111-4111-8111-111111111111',
  actor = '22222222-2222-4222-8222-222222222222',
  person = '33333333-3333-4333-8333-333333333333';
function setup() {
  const h = {
    actor,
    ready: true,
    permissions: [],
    signed: [],
    downloads: [],
    uploads: [],
    removed: [],
    rpcs: [],
    bytes: Buffer.from('%PDF-1.7 synthetic'),
    denied: false,
    exists: false,
  };
  h.service = {
    from(table) {
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        maybeSingle: async () => ({
          data:
            table === 'organization_directory_people'
              ? { id: person }
              : h.exists
                ? { id: h.exists }
                : null,
          error: null,
        }),
      };
      return q;
    },
    rpc: async (name, args) => {
      h.rpcs.push({ name, args });
      return { data: args.evidence_id, error: null };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'organization-evidence');
        return {
          upload: async (path, bytes, options) => {
            h.uploads.push({ path, bytes, options });
            return { data: { path }, error: null };
          },
          createSignedUploadUrl: async (path, options) => {
            h.signed.push({ path, options });
            return { data: { token: 'synthetic-storage-ticket' }, error: null };
          },
          download: async (path) => {
            h.downloads.push(path);
            return { data: new Blob([h.bytes]), error: null };
          },
          remove: async (paths) => {
            h.removed.push(...paths);
            return { error: null };
          },
        };
      },
    },
  };
  globalThis[key] = h;
  return h;
}
const request = (method, body) =>
  new Request('http://localhost/api/organizacion/directory-evidence/upload', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const input = (h) => ({
  workspace_id: ws,
  person_id: person,
  evidence_type: 'appointment',
  display_name: 'Synthetic',
  file_name: 'synthetic.pdf',
  mime_type: 'application/pdf',
  size_bytes: h.bytes.length,
  sha256_hash: createHash('sha256').update(h.bytes).digest('hex'),
});
async function prepare(h) {
  const response = await route.POST(request('POST', input(h)));
  assert.equal(response.status, 200);
  return response.json();
}
test.after(() => {
  delete globalThis[key];
  if (originalKey === undefined) delete process.env.ORGANIZATION_CREDENTIAL_ENCRYPTION_KEY;
  else process.env.ORGANIZATION_CREDENTIAL_ENCRYPTION_KEY = originalKey;
});
test('a 5 MB private file uses small preparation/finalization requests and server-computed hash', async () => {
  const h = setup();
  h.bytes = Buffer.alloc(5 * 1024 * 1024);
  h.bytes.write('%PDF-1.7');
  const ticket = await prepare(h);
  assert.equal(h.signed[0].options.upsert, false);
  assert.ok(ticket.path.startsWith(`${ws}/${person}/`));
  assert.ok(JSON.stringify(ticket).length < 8000);
  const response = await route.PUT(request('PUT', { workspace_id: ws, ticket: ticket.ticket }));
  assert.equal(response.status, 201);
  assert.equal(h.rpcs[0].name, 'finalize_organization_directory_evidence');
  assert.equal(h.rpcs[0].args.actor, actor);
  assert.equal(h.rpcs[0].args.evidence_values.size_bytes, 5 * 1024 * 1024);
  assert.equal(h.permissions.length, 2);
});
test('policy availability is checked before issuing an upload capability', async () => {
  const h = setup();
  h.ready = false;
  const response = await route.POST(request('POST', input(h)));
  assert.equal(response.status, 503);
  assert.equal(h.signed.length, 0);
});
test('a ticket cannot be finalized by another actor or workspace', async () => {
  const h = setup(),
    ticket = await prepare(h);
  h.actor = '44444444-4444-4444-8444-444444444444';
  let response = await route.PUT(request('PUT', { workspace_id: ws, ticket: ticket.ticket }));
  assert.equal(response.status, 403);
  h.actor = actor;
  response = await route.PUT(
    request('PUT', { workspace_id: '55555555-5555-4555-8555-555555555555', ticket: ticket.ticket })
  );
  assert.equal(response.status, 403);
  assert.equal(h.downloads.length, 0);
  assert.equal(h.rpcs.length, 0);
});
test('a changed file fails verification and cannot create an evidence record', async () => {
  const h = setup(),
    ticket = await prepare(h);
  h.bytes = Buffer.from('%PDF-1.7 modified!');
  const response = await route.PUT(request('PUT', { workspace_id: ws, ticket: ticket.ticket }));
  assert.equal(response.status, 422);
  assert.equal(h.rpcs.length, 0);
  assert.equal(h.removed[0], ticket.path);
});
test('fake PDF content and a forged ticket never reach the metadata transaction', async () => {
  const h = setup();
  h.bytes = Buffer.from('<html>not a PDF</html>');
  const ticket = await prepare(h);
  let response = await route.PUT(request('PUT', { workspace_id: ws, ticket: ticket.ticket }));
  assert.equal(response.status, 422);
  const [payload, mac] = ticket.ticket.split('.');
  response = await route.PUT(
    request('PUT', {
      workspace_id: ws,
      ticket: payload + '.' + (mac[0] === 'A' ? 'B' : 'A') + mac.slice(1),
    })
  );
  assert.equal(response.status, 403);
  assert.equal(h.rpcs.length, 0);
});
test('loss of role between upload and confirmation prevents any download or write', async () => {
  const h = setup(),
    ticket = await prepare(h);
  h.denied = true;
  const response = await route.PUT(request('PUT', { workspace_id: ws, ticket: ticket.ticket }));
  assert.equal(response.status, 403);
  assert.equal(h.downloads.length, 0);
  assert.equal(h.rpcs.length, 0);
});
test('expired tickets and files above 15 MB are rejected before upload or persistence', async () => {
  const h = setup(),
    ticket = await prepare(h),
    originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 16 * 60000;
    const response = await route.PUT(request('PUT', { workspace_id: ws, ticket: ticket.ticket }));
    assert.equal(response.status, 403);
  } finally {
    Date.now = originalNow;
  }
  const response = await route.POST(request('POST', { ...input(h), size_bytes: 16 * 1024 * 1024 }));
  assert.equal(response.status, 422);
  assert.equal(h.signed.length, 1);
  assert.equal(h.rpcs.length, 0);
});

function legacyRequest(h, overrides = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    workspace_id: ws,
    person_id: person,
    evidence_type: 'appointment',
    display_name: 'Synthetic',
    ...overrides,
  }))
    form.set(key, value);
  form.set('file', new File([h.bytes], 'synthetic.pdf', { type: 'application/pdf' }));
  return new Request('http://localhost/api/organizacion/directory-evidence', {
    method: 'POST',
    body: form,
  });
}
test('legacy multipart uploads use the same atomic evidence and audit transaction', async () => {
  const h = setup();
  const result = await legacy.POST(legacyRequest(h));
  assert.equal(result.status, 201);
  assert.equal(h.uploads.length, 1);
  assert.equal(h.rpcs[0].name, 'finalize_organization_directory_evidence');
  assert.equal(
    h.rpcs[0].args.evidence_values.sha256_hash,
    createHash('sha256').update(h.bytes).digest('hex')
  );
  assert.equal(h.rpcs[0].args.evidence_values.storage_path, h.uploads[0].path);
  assert.equal(h.uploads[0].options.upsert, false);
});
test('legacy uploads reject missing readiness, fake content and invalid dates before storage', async () => {
  let h = setup();
  h.ready = false;
  assert.equal((await legacy.POST(legacyRequest(h))).status, 503);
  assert.equal(h.uploads.length, 0);
  h = setup();
  h.bytes = Buffer.from('Fake synthetic PDF');
  assert.equal((await legacy.POST(legacyRequest(h))).status, 422);
  assert.equal(h.uploads.length, 0);
  h = setup();
  assert.equal(
    (await legacy.POST(legacyRequest(h, { valid_from: '2026-11-18', valid_until: '2026-11-17' })))
      .status,
    400
  );
  assert.equal(h.uploads.length, 0);
});
