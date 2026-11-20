import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
await build({
  entryPoints: ['src/lib/supabase/user-request.server.ts', 'src/lib/client/defer-read.ts'],
  outdir: '.tmp/request-amplification',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outExtension: { '.js': '.cjs' },
  packages: 'external',
});
const require = createRequire(import.meta.url);
const {
  getUserForRequest,
} = require('../.tmp/request-amplification/supabase/user-request.server.cjs');
const { deferRead } = require('../.tmp/request-amplification/client/defer-read.cjs');
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferredClient() {
  const h = { calls: [], complete: null, reject: null };
  const pending = new Promise((resolve, reject) => {
    h.complete = resolve;
    h.reject = reject;
  });
  h.client = {
    auth: {
      getUser: (token) => {
        h.calls.push(token);
        return pending;
      },
    },
  };
  return h;
}
test('concurrent identical lookups share Auth while fresh lookups after completion still revalidate', async () => {
  const h = deferredClient();
  const first = getUserForRequest(h.client, 'synthetic-a', 'project-a');
  const second = getUserForRequest(h.client, 'synthetic-a', 'project-a');
  await flush();
  assert.equal(h.calls.length, 1);
  h.complete({ data: { user: { id: 'actor' } }, error: null });
  assert.deepEqual(await first, await second);
  h.client.auth.getUser = async () => {
    h.calls.push('fresh');
    return { data: { user: null }, error: { status: 401 } };
  };
  assert.equal((await getUserForRequest(h.client, 'synthetic-a', 'project-a')).error.status, 401);
  assert.equal(h.calls.length, 2);
});
test('different tokens, projects and credentials never share an identity', async () => {
  const clients = [deferredClient(), deferredClient(), deferredClient()];
  const results = [
    getUserForRequest(clients[0].client, 'token-a', 'project-a'),
    getUserForRequest(clients[1].client, 'token-b', 'project-a'),
    getUserForRequest(clients[2].client, 'token-a', 'project-b'),
  ];
  await flush();
  assert.ok(clients.every((c) => c.calls.length === 1));
  clients.forEach((c, i) => c.complete({ data: { user: { id: `actor-${i}` } }, error: null }));
  assert.deepEqual(
    (await Promise.all(results)).map((r) => r.data.user.id),
    ['actor-0', 'actor-1', 'actor-2']
  );
});
test('rejected and unsuccessful lookups are removed and cannot become a cached denial', async () => {
  for (const thrown of [true, false]) {
    const h = deferredClient();
    const pending = getUserForRequest(h.client, 'error-token', `error-${thrown}`);
    if (thrown) {
      const rejected = assert.rejects(pending, /upstream/);
      h.reject(Error('upstream'));
      await rejected;
    } else {
      h.complete({ data: { user: null }, error: { status: 503 } });
      assert.equal((await pending).error.status, 503);
    }
    let calls = 0;
    h.client.auth.getUser = async () => {
      calls++;
      return { data: { user: { id: 'recovered' } }, error: null };
    };
    assert.equal(
      (await getUserForRequest(h.client, 'error-token', `error-${thrown}`)).data.user.id,
      'recovered'
    );
    assert.equal(calls, 1);
  }
});
test('Strict Mode setup-cleanup-setup starts one read and later refreshes remain independent', async () => {
  let reads = 0;
  const read = async () => {
    reads++;
  };
  const cleanup = deferRead(read);
  cleanup();
  const currentCleanup = deferRead(read);
  await flush();
  assert.equal(reads, 1);
  currentCleanup();
  deferRead(read);
  await flush();
  assert.equal(reads, 2);
});
test('unmounted reads do not start and an obsolete workspace effect cannot issue its request', async () => {
  const read = [];
  const cancel = deferRead(() => {
    read.push('old');
  });
  cancel();
  deferRead(() => {
    read.push('new');
  });
  await flush();
  assert.deepEqual(read, ['new']);
});
