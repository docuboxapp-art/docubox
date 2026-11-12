import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = await build({
  entryPoints: [path.join(root, 'src/app/api/auth/totp/check/route.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'isolated-route-dependencies',
      setup(plugin) {
        plugin.onResolve(
          { filter: /^(next\/server|@\/lib\/supabase\/server|@\/lib\/observability\/events)$/ },
          (args) => ({ path: args.path, namespace: 'mock' })
        );
        plugin.onResolve({ filter: /^@\/lib\/supabase\/auth-verification$/ }, () => ({
          path: path.join(root, 'src/lib/supabase/auth-verification.ts'),
        }));
        plugin.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => {
          if (args.path === 'next/server') {
            return {
              contents:
                'export const NextResponse = { json: (body, init) => new Response(JSON.stringify(body), { ...init, headers: { "Content-Type": "application/json", ...init?.headers } }) };',
            };
          }
          if (args.path.endsWith('/server')) {
            return {
              contents:
                'export const createAnonClient = () => ({ auth: { getClaims: async () => globalThis.__totpTestState.claims() } }); export const createServiceClient = () => ({ rpc: async () => globalThis.__totpTestState.requirements() });',
            };
          }
          return { contents: 'export const emitObservedEvent = () => undefined;' };
        });
      },
    },
  ],
});
const { POST } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
);
const request = (authorized = true) =>
  new Request('http://localhost/api/auth/totp/check', {
    method: 'POST',
    headers: authorized ? { Authorization: 'Bearer test-token' } : {},
  });

test('login requirement check fails closed without a bearer token', async () => {
  const response = await POST(request(false));
  assert.equal(response.status, 401);
});

test('temporary Auth failure returns 503 without querying security requirements', async () => {
  let queried = false;
  globalThis.__totpTestState = {
    claims: async () => ({ data: null, error: { status: 504, code: 'request_timeout' } }),
    requirements: async () => {
      queried = true;
      return { data: null };
    },
  };
  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.equal(queried, false);
});

test('invalid token returns 401 while a security RPC outage returns 503', async () => {
  globalThis.__totpTestState = {
    claims: async () => ({ data: null, error: { status: 401, code: 'bad_jwt' } }),
    requirements: async () => ({ data: null }),
  };
  assert.equal((await POST(request())).status, 401);

  globalThis.__totpTestState.claims = async () => ({
    data: { claims: { role: 'authenticated', sub: 'test-user' } },
    error: null,
  });
  globalThis.__totpTestState.requirements = async () => ({
    data: null,
    error: { code: 'PGRST002' },
  });
  assert.equal((await POST(request())).status, 503);
});

test('valid token and available requirements return their enforced flags', async () => {
  globalThis.__totpTestState = {
    claims: async () => ({
      data: { claims: { role: 'authenticated', sub: 'test-user' } },
      error: null,
    }),
    requirements: async () => ({
      data: { totp_enabled: true, passkey_required: false },
      error: null,
    }),
  };
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).totpEnabled, true);
});
