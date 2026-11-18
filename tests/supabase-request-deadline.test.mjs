import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnonClient, fetchWithRequestDeadline } from '../src/lib/supabase/server.ts';
import { isDefinitivelyInvalidAuthToken } from '../src/lib/supabase/auth-verification.ts';

test('a request-scoped deadline aborts stalled Supabase calls', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
  try {
    await assert.rejects(
      fetchWithRequestDeadline(AbortSignal.timeout(10))('https://example.supabase.co/rest/v1/test'),
      { name: 'TimeoutError' }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('caller cancellation also aborts a bounded Supabase call', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
  try {
    const caller = new AbortController();
    const pending = fetchWithRequestDeadline(AbortSignal.timeout(1000))(
      'https://example.supabase.co/rest/v1/test',
      { signal: caller.signal }
    );
    caller.abort(new Error('cancelled by caller'));
    await assert.rejects(pending, /cancelled by caller/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a Request object retains its caller cancellation signal', async () => {
  const caller = new AbortController();
  let signal;
  const request = new Request('https://synthetic.invalid/rest/v1/test', { signal: caller.signal });
  await fetchWithRequestDeadline(AbortSignal.timeout(1000), async (_input, init) => {
    signal = init.signal;
    return Response.json({});
  })(request);
  caller.abort();
  assert.equal(signal.aborted, true);
});

async function withSyntheticAuth(t, fetchImpl) {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.invalid';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic-public-key';
  globalThis.fetch = fetchImpl;
  t.after(() => {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = oldKey;
  });
}

test('server Auth deadlines cover a stalled body and remain temporary failures', async (t) => {
  await withSyntheticAuth(t, async () => new Response(new ReadableStream({ start() {} })));
  const auth = createAnonClient(undefined, AbortSignal.timeout(15));
  const result = await auth.auth.getUser('synthetic-token');
  assert.equal(result.data.user, null);
  assert.ok(result.error);
  assert.equal(isDefinitivelyInvalidAuthToken(result.error), false);
});

test('server Auth still preserves a definitive rejected JWT', async (t) => {
  await withSyntheticAuth(t, async () => Response.json(
    { code: 'bad_jwt', msg: 'Invalid JWT' }, { status: 401 }
  ));
  const result = await createAnonClient().auth.getUser('synthetic-token');
  assert.equal(result.error.status, 401);
  assert.equal(isDefinitivelyInvalidAuthToken(result.error), true);
});

test('server data requests retain the user Bearer and streaming response', async (t) => {
  let seenHeaders;
  await withSyntheticAuth(t, async (_input, init) => {
    seenHeaders = new Headers(init.headers);
    return Response.json([{ id: 'synthetic-document' }]);
  });
  const result = await createAnonClient('synthetic-token').from('documentos').select('id');
  assert.equal(result.error, null);
  assert.deepEqual(result.data, [{ id: 'synthetic-document' }]);
  assert.equal(seenHeaders.get('Authorization'), 'Bearer synthetic-token');
});
