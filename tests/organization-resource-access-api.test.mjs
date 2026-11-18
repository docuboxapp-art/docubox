import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url),
  key = '__organizationResourceScopeQA';
await build({
  entryPoints: ['src/lib/collaboration/server.ts'],
  outfile: '.tmp/organization-scope-server-qa.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  plugins: [
    {
      name: 'authenticated-boundary',
      setup(b) {
        b.onResolve({ filter: /^@\/lib\/organization\/server$/ }, () => ({
          path: 'organization-auth',
          namespace: 'qa',
        }));
        b.onLoad({ filter: /.*/, namespace: 'qa' }, () => ({
          contents: `export class OrganizationApiError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code}};export const authenticateOrganizationRequest=async()=>({user:{id:'22222222-2222-4222-8222-222222222222'},userClient:globalThis.${key}.client,service:{rpc(){throw Error('Service role must not check a user scope')}}});`,
          loader: 'js',
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
const {
  authorizeCollaborationRequest,
  assertCollaborationCreationScope,
} = require('../.tmp/organization-scope-server-qa.cjs');
const ws = '11111111-1111-4111-8111-111111111111',
  actor = '22222222-2222-4222-8222-222222222222',
  id = '33333333-3333-4333-8333-333333333333';
function setup(answer = () => ({ data: true, error: null })) {
  const calls = [];
  globalThis[key] = {
    client: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        if (name === 'get_my_collaboration_access')
          return {
            data: {
              eligible: true,
              accessible: true,
              write_allowed: true,
              membership_role: 'member',
              workspace_status: 'active',
              membership_status: 'active',
              permissions: ['tasks.edit'],
            },
            error: null,
          };
        if (name === 'organization_resource_scope_version') return { data: 1, error: null };
        return answer(name, args);
      },
    },
  };
  return calls;
}
const request = new Request('http://localhost/api/colabora/tasks/' + id);
test.after(() => delete globalThis[key]);
test('existing resource operations check the user JWT, precise action and resource', async () => {
  const calls = setup();
  await authorizeCollaborationRequest(request, ws, 'tasks.edit', true, { type: 'task', id });
  assert.deepEqual(calls.at(-1), {
    name: 'organization_can_access_resource',
    args: { ws_id: ws, requested_permission: 'tasks.edit', resource_type: 'task', resource_id: id },
  });
});
test('scope denial is a permission error rather than an expired session', async () => {
  setup(() => ({ data: false, error: null }));
  await assert.rejects(
    authorizeCollaborationRequest(request, ws, 'tasks.edit', true, { type: 'task', id }),
    (e) => e.status === 403 && e.code === 'organization_resource_out_of_scope'
  );
});
test('SQL unavailability never falls back to organization-wide permission', async () => {
  setup(() => ({ data: null, error: { code: 'PGRST202' } }));
  await assert.rejects(
    authorizeCollaborationRequest(request, ws, 'tasks.edit', true, { type: 'task', id }),
    (e) => e.status === 503 && e.code === 'organization_scope_unavailable'
  );
});
test('creation independently checks assignment and each referenced source', async () => {
  const calls = setup();
  await assertCollaborationCreationScope(
    globalThis[key].client,
    ws,
    'tasks.create',
    'task',
    actor,
    { assigned_to: id, document_id: id }
  );
  assert.deepEqual(
    calls.map((call) => [call.name, call.args.requested_permission]),
    [
      ['organization_can_create_resource', 'tasks.create'],
      ['organization_can_create_resource', 'tasks.assign'],
      ['organization_can_access_resource', 'tasks.create'],
    ]
  );
  assert.deepEqual(calls[0].args.assigned_user_ids, [id]);
});
test('a published form outside the scope cannot be attached to a new request', async () => {
  setup((name) => ({ data: name !== 'organization_can_access_resource', error: null }));
  await assert.rejects(
    assertCollaborationCreationScope(
      globalThis[key].client,
      ws,
      'requests.create',
      'request',
      actor,
      { items: [{ form_template_id: id }] }
    ),
    (e) => e.status === 403
  );
});

test('member reads fail closed until scope policies are installed', async () => {
  setup();
  const original = globalThis[key].client.rpc;
  globalThis[key].client.rpc = async (name, args) =>
    name === 'organization_resource_scope_version'
      ? { data: null, error: { code: 'PGRST202' } }
      : original(name, args);
  await assert.rejects(
    authorizeCollaborationRequest(request, ws, 'tasks.edit'),
    (e) => e.status === 503 && e.code === 'organization_scope_unavailable'
  );
});
