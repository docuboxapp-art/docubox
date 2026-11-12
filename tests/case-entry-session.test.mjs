import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const stubs = {
  'server-only': 'export {};',
  'next/headers': 'export const cookies=async()=>globalThis.__caseEntryTest.jar;',
  '@supabase/ssr':
    'export function createServerClient(url,key,options){const h=globalThis.__caseEntryTest;h.ssr++;h.cookies=options.cookies.getAll();return h.client;}',
  '@/lib/supabase/server':
    "export function createAnonClient(token){const h=globalThis.__caseEntryTest;h.anon++;h.bearer=token;return h.client;}export function createServiceClient(){throw Error('Privileged client cannot authenticate a browser session');}",
  './runtime.server':
    'export class CaseRuntimeError extends Error{constructor(code,message,status){super(message);this.code=code;this.status=status;}}',
};
const compiled = await build({
  stdin: {
    contents: "export {caseEntryIdentity} from './src/lib/case-files/entry.server';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'auth-boundaries',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) =>
          Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'test-auth' } : undefined
        );
        b.onLoad({ filter: /.*/, namespace: 'test-auth' }, (args) => ({
          contents: stubs[args.path],
          loader: 'js',
        }));
      },
    },
  ],
});
const { caseEntryIdentity } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);
function setup(error = null) {
  const user = {
    id: 'test-user',
    email: 'qa@example.invalid',
    email_confirmed_at: '2026-11-10T00:00:00Z',
    is_anonymous: false,
  };
  const h = {
    ssr: 0,
    anon: 0,
    cookies: null,
    jar: {
      getAll: () => [{ name: 'session-cookie', value: 'test-only' }],
      set: () => {
        throw Error('Server Component is readonly');
      },
    },
    client: {
      auth: {
        async getUser(token) {
          h.getUserToken = token;
          return { data: { user: error ? null : user }, error };
        },
      },
    },
  };
  globalThis.__caseEntryTest = h;
  return { h, user };
}
test('private invitation uses the actual incoming SSR cookies, never a service-client session', async () => {
  const { h, user } = setup();
  assert.equal(await caseEntryIdentity(), user);
  assert.equal(h.ssr, 1);
  assert.equal(h.anon, 0);
  assert.deepEqual(h.cookies, [{ name: 'session-cookie', value: 'test-only' }]);
});
test('Bearer requests validate the provided credential with the public Auth client', async () => {
  const { h, user } = setup();
  assert.equal(
    await caseEntryIdentity({
      headers: new Headers({ Authorization: 'Bearer test-only-user-token' }),
    }),
    user
  );
  assert.equal(h.anon, 1);
  assert.equal(h.ssr, 0);
  assert.equal(h.getUserToken, 'test-only-user-token');
});
test('a temporary Auth error does not masquerade as a signed-out or invalid account', async () => {
  setup({ name: 'AuthRetryableFetchError', status: 503 });
  await assert.rejects(
    caseEntryIdentity(),
    (e) => e.code === 'CASE_AUTH_UNAVAILABLE' && e.status === 503
  );
  setup({ name: 'AuthSessionMissingError', status: 400 });
  assert.equal(await caseEntryIdentity(), null);
  setup({ name: 'AuthApiError', status: 401 });
  assert.equal(await caseEntryIdentity(), null);
});
