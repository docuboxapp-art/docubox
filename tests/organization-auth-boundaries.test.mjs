import { z } from 'zod';
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const stubs = {
  '@/lib/supabase/server': `
    export const createAnonClient=()=>globalThis.__orgAuthQA.client;
    export const createServiceClient=()=>{globalThis.__orgAuthQA.serviceCreated++;return globalThis.__orgAuthQA.service;};`,
};
await build({
  entryPoints: ['src/lib/organization/server.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  outfile: '.tmp/org-auth-qa.cjs',
  plugins: [
    {
      name: 'auth-boundaries',
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
const {
  authorizeOrganizationRequest,
  authenticateOrganizationRequest,
  organizationApiFailure,
  verifyOrganizationPassword,
} = createRequire(import.meta.url)('../.tmp/org-auth-qa.cjs');
const original = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic';
test.after(() => {
  for (const [env, value] of [
    ['NEXT_PUBLIC_SUPABASE_URL', original.url],
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', original.key],
  ]) {
    if (value === undefined) delete process.env[env];
    else process.env[env] = value;
  }
  delete globalThis.__orgAuthQA;
});
function setup({
  authError = null,
  throws = false,
  allowed = true,
  permissionError = null,
  type = 'business',
} = {}) {
  const h = { serviceCreated: 0, queries: [], rpc: [] };
  h.client = {
    auth: {
      getUser: async () => {
        if (throws) throw Error('timeout');
        return { data: { user: authError ? null : { id: 'actor' } }, error: authError };
      },
    },
    rpc: async (name, args) => {
      h.rpc.push({ name, args });
      return { data: allowed, error: permissionError };
    },
  };
  h.service = {
    from(table) {
      h.queries.push(table);
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: { workspace_type: type }, error: null }),
      };
      return q;
    },
  };
  globalThis.__orgAuthQA = h;
  return h;
}
const request = (hasToken = true) =>
  new Request('http://localhost/api/organizacion', {
    headers: hasToken ? { authorization: 'Bearer synthetic' } : {},
  });
const run = () =>
  authorizeOrganizationRequest(request(), '11111111-1111-4111-8111-111111111111', 'teams.manage');
test('missing and rejected sessions remain 401 before service access', async () => {
  let h = setup();
  await assert.rejects(authenticateOrganizationRequest(request(false)), { status: 401 });
  assert.equal(h.serviceCreated, 0);
  h = setup({ authError: { status: 401, code: 'bad_jwt' } });
  await assert.rejects(run(), { status: 401 });
  assert.equal(h.serviceCreated, 0);
});
test('temporary Auth failures and thrown timeouts remain 503', async () => {
  for (const options of [
    { authError: { status: 503, name: 'AuthRetryableFetchError' } },
    { throws: true },
  ]) {
    const h = setup(options);
    await assert.rejects(run(), { status: 503 });
    assert.equal(h.serviceCreated, 0);
  }
});
test('a permission outage is 503, while a real denial is 403', async () => {
  let h = setup({ permissionError: { code: 'timeout' } });
  await assert.rejects(run(), { status: 503 });
  assert.equal(h.queries.length, 0);
  h = setup({ allowed: false });
  await assert.rejects(run(), { status: 403 });
  assert.equal(h.queries.length, 0);
});
test('organization endpoints reject personal workspaces even for an owner', async () => {
  setup({ type: 'personal' });
  await assert.rejects(run(), { status: 403, code: 'organization_required' });
});
test('business authorization checks permission against the requested workspace', async () => {
  const h = setup();
  await run();
  assert.deepEqual(h.rpc, [
    {
      name: 'has_organization_permission',
      args: { ws_id: '11111111-1111-4111-8111-111111111111', requested_permission: 'teams.manage' },
    },
  ]);
});

test('sharing an in-flight Auth lookup still checks each workspace permission independently', async () => {
  const h = setup();
  let finish;
  let lookups = 0;
  h.client.auth.getUser = () => {
    lookups++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  h.client.rpc = async (name, args) => {
    h.rpc.push({ name, args });
    return { data: args.ws_id === 'allowed', error: null };
  };
  const pending = Promise.allSettled([
    authorizeOrganizationRequest(request(), 'allowed', 'teams.read'),
    authorizeOrganizationRequest(request(), 'denied', 'teams.read'),
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lookups, 1);
  finish({ data: { user: { id: 'actor' } }, error: null });
  const [allowed, denied] = await pending;
  assert.equal(allowed.status, 'fulfilled');
  assert.equal(denied.status, 'rejected');
  assert.equal(denied.reason.status, 403);
  assert.deepEqual(
    h.rpc.map((call) => call.args.ws_id),
    ['allowed', 'denied']
  );
});
test('known database denials have safe actionable messages', async () => {
  const response = organizationApiFailure({ message: 'organization_unit_member_scope_invalid' });
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /miembros activos/);
  const unexpected = organizationApiFailure({ message: 'private database error' });
  assert.equal(unexpected.status, 500);
  assert.doesNotMatch(JSON.stringify(await unexpected.json()), /private database/);
});

test('password confirmation keeps provider outages separate from an incorrect password', async () => {
  const h = setup();
  h.client.auth.signInWithPassword = async () => ({ data: { user: null }, error: { status: 503 } });
  await assert.rejects(
    verifyOrganizationPassword('actor', 'example@example.invalid', 'synthetic'),
    { status: 503 }
  );
  h.client.auth.signInWithPassword = async () => ({ data: { user: null }, error: { status: 400 } });
  await assert.rejects(
    verifyOrganizationPassword('actor', 'example@example.invalid', 'synthetic'),
    { status: 401 }
  );
  h.client.auth.signInWithPassword = async () => ({ data: { user: { id: 'actor' } }, error: null });
  await verifyOrganizationPassword('actor', 'example@example.invalid', 'synthetic');
});

test('validation, duplicate and invalid-reference errors remain actionable without database details', async () => {
  const invalid = z.object({ name: z.string().min(1) }).safeParse({ name: '' });
  assert.equal(organizationApiFailure(invalid.error).status, 422);
  for (const [code, status] of [
    ['23505', 409],
    ['23514', 422],
    ['23503', 422],
  ]) {
    const response = organizationApiFailure({ code, message: 'private provider detail' });
    assert.equal(response.status, status);
    assert.doesNotMatch(JSON.stringify(await response.json()), /private provider detail/);
  }
});
