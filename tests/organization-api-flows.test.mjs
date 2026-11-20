import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const key = '__organizationFlowQA';
const stubs = {
  '@/lib/organization/security-alerts.server':
    'export const notifyOrganizationSecurityEvent=async()=>{};',
  '@/lib/organization/server': `
    export class OrganizationApiError extends Error { constructor(status,code,message){super(message);this.status=status;this.code=code;} }
    export async function authorizeOrganizationRequest(request,workspace,permission){
      const h=globalThis.${key};h.authorizations.push({workspace,permission});
      if(h.denied||h.deniedPermissions?.includes(permission))throw new OrganizationApiError(403,'permission_denied','Denegado');
      return {user:{id:h.user},userClient:h.client,service:h.service};
    }
    export async function requireOrganizationReauthentication(request,ws,user,scope){
      globalThis.${key}.reauth.push(scope);
      if(!request.headers.get('x-organization-reauth'))throw new OrganizationApiError(401,'reauthentication_required','Confirma tu identidad');
    }
    export const createOpaqueSecret=()=>({value:'synthetic',hash:'synthetic-hash'});
    export async function verifyOrganizationPassword(){globalThis.${key}.passwordVerified=true;}
    export function organizationApiFailure(e){return Response.json({success:false,code:e.code||'internal_error'},{status:e.status||500});}`,
  '@/lib/supabase/server': `export const createServiceClient=()=>globalThis.${key}.service;`,
  '@/lib/notificationsInApp.server': `export const createNotificationServer=()=>{throw Error('No notification expected');};`,
};
const require = createRequire(import.meta.url);
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
        name: 'org-api-boundaries',
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
const structure = await bundle('src/app/api/organizacion/structure/route.ts', 'org-structure-qa');
const members = await bundle('src/app/api/organizacion/members/route.ts', 'org-members-qa');
const reauthenticate = await bundle(
  'src/app/api/organizacion/reauthenticate/route.ts',
  'org-reauthentication-qa'
);
const member = await bundle(
  'src/app/api/organizacion/members/[memberId]/route.ts',
  'org-member-detail-qa'
);
const ws = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const permissionId = '33333333-3333-4333-8333-333333333333';
function harness(overrides = {}) {
  const h = {
    user: id,
    authorizations: [],
    reauth: [],
    calls: [],
    queries: [],
    catalog: [],
    canManage: true,
    denied: false,
    ...overrides,
  };
  h.client = {
    rpc: async (name, args) => {
      h.calls.push({ name, args });
      return {
        data:
          name === 'organization_resource_scope_version'
            ? (h.scopeVersion ?? 1)
            : name === 'has_organization_permission'
              ? h.canManage
              : id,
        error: null,
      };
    },
  };
  h.service = {
    from(table) {
      const q = { table, filters: [], columns: '' };
      h.queries.push(q);
      const result = () => ({
        data:
          table === 'organization_permissions'
            ? h.catalog
            : table === 'workspace_members'
              ? h.memberRecords || []
              : [],
        // workspace_members also references the inviter's user profile.
        error:
          table === 'workspace_members' && /\buser_profiles\(/.test(q.columns)
            ? { code: 'PGRST201', message: 'Multiple profile relationships' }
            : null,
      });
      const chain = {
        insert(values) {
          q.inserted = values;
          return chain;
        },
        select(columns) {
          q.columns = columns;
          return chain;
        },
        eq(...args) {
          q.filters.push(args);
          return chain;
        },
        in(...args) {
          q.filters.push(args);
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle: async () => ({ data: null, error: null }),
        then(resolve, reject) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  globalThis[key] = h;
  return h;
}
const post = (body, reauth = false) =>
  new Request('http://localhost/api/organizacion/structure', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(reauth ? { 'x-organization-reauth': 'synthetic-confirmation' } : {}),
    },
    body: JSON.stringify({ workspace_id: ws, ...body }),
  });
test.after(() => delete globalThis[key]);

test('role managers can confirm their authorized action without an unrelated organization.read permission', async () => {
  const h = harness({ deniedPermissions: ['organization.read'] });
  const response = await reauthenticate.POST(
    post({ password: 'synthetic', scopes: ['roles.manage'] })
  );
  assert.equal(response.status, 200);
  assert.equal(h.authorizations[0].permission, 'roles.manage');
  assert.equal(h.passwordVerified, true);
});

test('confirmation cannot include scopes the member does not have', async () => {
  const h = harness({ canManage: false });
  const response = await reauthenticate.POST(
    post({ password: 'synthetic', scopes: ['roles.manage', 'security.manage'] })
  );
  assert.equal(response.status, 403);
  assert.equal(h.passwordVerified, undefined);
  assert.equal(h.queries.length, 0);
});

test('team creation accepts empty optional selectors and commits members in the same RPC', async () => {
  const h = harness();
  const response = await structure.POST(
    post({
      action: 'save_unit',
      unit: {
        name: 'Legal',
        unit_type: 'team',
        parent_id: '',
        leader_member_id: '',
        deputy_member_id: '',
        cost_center_id: '',
      },
      member_ids: [id],
    })
  );
  assert.equal(response.status, 200);
  assert.deepEqual(h.calls, [
    {
      name: 'save_organization_unit_bundle',
      args: {
        ws_id: ws,
        unit_data: {
          name: 'Legal',
          unit_type: 'team',
          parent_id: null,
          leader_member_id: null,
          deputy_member_id: null,
          cost_center_id: null,
        },
        requested_member_ids: [id],
      },
    },
  ]);
  assert.equal(h.queries.length, 0);
});
test('invalid team UUID is rejected before mutation', async () => {
  const h = harness();
  const response = await structure.POST(
    post({
      action: 'save_unit',
      unit: { name: 'Legal', unit_type: 'team', parent_id: 'foreign-text' },
    })
  );
  assert.equal(response.status, 400);
  assert.equal(h.calls.length, 0);
});
test('role save requires identity confirmation before mutation', async () => {
  const h = harness();
  const response = await structure.POST(
    post({
      action: 'save_role',
      role: { name: 'Consulta', scope_type: 'organization' },
      permission_ids: [permissionId],
    })
  );
  assert.equal(response.status, 401);
  assert.equal(h.calls.length, 0);
});
test('role and selected permissions save transactionally after confirmation', async () => {
  const h = harness();
  const response = await structure.POST(
    post(
      {
        action: 'save_role',
        role: { name: 'Consulta', scope_type: 'organization' },
        permission_ids: [permissionId],
      },
      true
    )
  );
  assert.equal(response.status, 200);
  assert.deepEqual(h.calls, [
    {
      name: 'save_organization_role_bundle',
      args: {
        ws_id: ws,
        role_data: { name: 'Consulta', scope_type: 'organization', scope_config: {} },
        requested_permission_ids: [permissionId],
      },
    },
  ]);
  assert.deepEqual(h.reauth, ['roles.manage']);
});
test('legacy permission selection translates UUIDs into the actual database key contract', async () => {
  const h = harness({ catalog: [{ id: permissionId, permission_key: 'teams.read' }] });
  const response = await structure.POST(
    post({ action: 'set_role_permissions', role_id: id, permission_ids: [permissionId] }, true)
  );
  assert.equal(response.status, 200);
  assert.deepEqual(h.calls[0], {
    name: 'set_organization_role_permissions',
    args: { ws_id: ws, target_role_id: id, permission_keys: ['teams.read'] },
  });
});
test('unknown permission IDs never reach the permission mutator', async () => {
  const h = harness();
  const response = await structure.POST(
    post({ action: 'set_role_permissions', role_id: id, permission_ids: [permissionId] }, true)
  );
  assert.equal(response.status, 422);
  assert.equal(h.calls.length, 0);
});
test('read-only team list has no management capability', async () => {
  harness({ canManage: false });
  const response = await structure.GET(
    new Request(`http://localhost/api/organizacion/structure?workspace_id=${ws}&resource=units`)
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).capabilities.canManage, false);
});

test('team and member lists resolve the member profile when an inviter relationship also exists', async () => {
  const memberRecords = [
    {
      id,
      role: 'owner',
      status: 'active',
      user_profiles: { full_name: 'Member', email: 'member@example.invalid' },
    },
  ];
  for (const [handler, path, field] of [
    [structure, 'structure?resource=units&', 'members'],
    [members, 'members?', 'data'],
  ]) {
    const h = harness({ memberRecords });
    const response = await handler.GET(
      new Request(`http://localhost/api/organizacion/${path}workspace_id=${ws}`)
    );
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json())[field], memberRecords);
    assert.match(
      h.queries.find((q) => q.table === 'workspace_members').columns,
      /user_profiles!workspace_members_user_id_fkey\(/
    );
  }
});
test('workspace denial stops reads and writes', async () => {
  const h = harness({ denied: true });
  assert.equal((await structure.POST(post({ action: 'save_unit' }))).status, 403);
  assert.equal(
    (await members.GET(new Request(`http://localhost/api/organizacion/members?workspace_id=${ws}`)))
      .status,
    403
  );
  assert.equal(h.calls.length, 0);
  assert.equal(h.queries.length, 0);
});
test('member list scopes every source to the workspace and omits invitation secrets', async () => {
  const h = harness();
  const response = await members.GET(
    new Request(`http://localhost/api/organizacion/members?workspace_id=${ws}`)
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(h.queries.length, 4);
  for (const q of h.queries)
    assert.ok(q.filters.some(([field, value]) => field === 'workspace_id' && value === ws));
  const invite = h.queries.find((q) => q.table === 'organization_invitations');
  assert.doesNotMatch(invite.columns, /token|hash|secret/);
  for (const table of ['organization_roles', 'organization_units'])
    assert.ok(
      h.queries
        .find((q) => q.table === table)
        .filters.some(([k, v]) => k === 'status' && v === 'active')
    );
});
test('member role assignment uses the authorized RPC and requires reauthentication', async () => {
  const h = harness();
  const context = { params: Promise.resolve({ memberId: id }) };
  assert.equal(
    (await member.POST(post({ action: 'set_roles', role_ids: [permissionId] }), context)).status,
    401
  );
  assert.equal(h.calls.length, 0);
  assert.equal(
    (await member.POST(post({ action: 'set_roles', role_ids: [permissionId] }, true), context))
      .status,
    200
  );
  assert.deepEqual(h.calls[0], {
    name: 'set_organization_member_roles',
    args: { ws_id: ws, target_member_id: id, requested_role_ids: [permissionId] },
  });
});
test('member team assignment uses tenant-scoped membership RPC', async () => {
  const h = harness();
  assert.equal(
    (
      await member.POST(post({ action: 'set_units', unit_ids: [permissionId] }), {
        params: Promise.resolve({ memberId: id }),
      })
    ).status,
    200
  );
  assert.deepEqual(h.calls[0], {
    name: 'set_organization_member_units',
    args: { ws_id: ws, target_member_id: id, requested_unit_ids: [permissionId] },
  });
});

test('limited roles cannot be saved before scope policies are installed', async () => {
  const h = harness({ scopeVersion: 0 });
  const response = await structure.POST(
    post(
      { action: 'save_role', role: { name: 'Propios', scope_type: 'own' }, permission_ids: [] },
      true
    )
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'organization_scope_unavailable');
  assert.equal(
    h.calls.some((call) => call.name === 'save_organization_role_bundle'),
    false
  );
});
