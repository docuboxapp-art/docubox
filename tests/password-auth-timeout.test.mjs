import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformSync } from 'esbuild';

const source = await readFile(
  new URL('../src/lib/supabase/password-auth-fetch.ts', import.meta.url),
  'utf8'
);
const compiled = transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022' }).code;
const { fetchWithPasswordSignInTimeout, fetchWithCompleteResponseTimeout } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('cancels a stalled password sign-in request at its deadline', async () => {
  let cancelled = false;
  const stalledFetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        cancelled = true;
        reject(init.signal.reason);
      });
    });

  await assert.rejects(
    fetchWithPasswordSignInTimeout(
      'https://example.supabase.co/auth/v1/token?grant_type=password',
      undefined,
      stalledFetch,
      10
    ),
    { name: 'TimeoutError' }
  );
  assert.equal(cancelled, true);
});

test('leaves unrelated Supabase requests unchanged', async () => {
  let receivedInit;
  const response = new Response('{}');
  const fetchImpl = (_input, init) => {
    receivedInit = init;
    return Promise.resolve(response);
  };

  const result = await fetchWithPasswordSignInTimeout(
    'https://example.supabase.co/rest/v1/documentos',
    { method: 'GET' },
    fetchImpl,
    10
  );
  assert.equal(result, response);
  assert.deepEqual(receivedInit, { method: 'GET' });
});

test('bounds a stalled refresh request without changing the password deadline', async () => {
  let cancelled = false;
  const pending = fetchWithPasswordSignInTimeout(
    'https://example.supabase.co/auth/v1/token?grant_type=refresh_token',
    undefined,
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          cancelled = true;
          reject(init.signal.reason);
        });
      }),
    10
  );
  await assert.rejects(pending, { name: 'TimeoutError' });
  assert.equal(cancelled, true);
});

test('bounds a stalled user verification request', async () => {
  await assert.rejects(
    fetchWithPasswordSignInTimeout(
      'https://example.supabase.co/auth/v1/user',
      undefined,
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason));
        }),
      10
    ),
    { name: 'TimeoutError' }
  );
});

test('passes through an existing cancellation signal', async () => {
  const original = new AbortController();
  const pending = fetchWithPasswordSignInTimeout(
    'https://example.supabase.co/auth/v1/token?grant_type=password',
    { signal: original.signal },
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
      }),
    1000
  );

  original.abort(new Error('cancelled by caller'));
  await assert.rejects(pending, /cancelled by caller/);
});

test('the policy deadline also covers a response that stalls after HTTP 200 headers', async () => {
  let bodyCancelled = false;
  await assert.rejects(
    fetchWithPasswordSignInTimeout(
      'https://example.supabase.co/rest/v1/rpc/enforce_docubox_session_policy',
      undefined,
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              bodyCancelled = true;
            },
          })
        ),
      10
    ),
    { name: 'TimeoutError' }
  );
  assert.equal(bodyCancelled, true);
});

test('the outer middleware deadline still cancels the body after headers arrive', async () => {
  const outer = new AbortController();
  let bodyCancelled = false;
  let headersArrived;
  const headers = new Promise((resolve) => {
    headersArrived = resolve;
  });
  const pending = fetchWithCompleteResponseTimeout(
    'https://example.supabase.co/auth/v1/user',
    undefined,
    {
      timeoutMs: 1000,
      requestSignal: outer.signal,
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              bodyCancelled = true;
            },
          })
        ),
      onResponse: headersArrived,
    }
  );
  await headers;
  outer.abort(new Error('outer request deadline'));
  await assert.rejects(pending, /outer request deadline/);
  assert.equal(bodyCancelled, true);
});

test('a fetch implementation ignoring abort cannot keep the auth caller pending forever', async () => {
  await assert.rejects(
    fetchWithPasswordSignInTimeout(
      'https://example.supabase.co/auth/v1/user',
      undefined,
      () => new Promise(() => {}),
      10
    ),
    { name: 'TimeoutError' }
  );
});

test('a complete error response preserves its status, headers and UTF-8 JSON body', async () => {
  const encoded = new TextEncoder().encode(JSON.stringify({ error: 'Sesión inválida' }));
  const response = await fetchWithPasswordSignInTimeout(
    'https://example.supabase.co/auth/v1/user',
    undefined,
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(encoded.slice(0, 27));
            c.enqueue(encoded.slice(27));
            c.close();
          },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json', 'x-request-id': 'test' } }
      ),
    1000
  );
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('x-request-id'), 'test');
  assert.deepEqual(await response.json(), { error: 'Sesión inválida' });
});

test('an aborted caller does not start a new upstream auth request', async () => {
  const caller = new AbortController();
  caller.abort(new Error('cancelled'));
  let calls = 0;
  await assert.rejects(
    fetchWithPasswordSignInTimeout(
      'https://example.supabase.co/auth/v1/user',
      { signal: caller.signal },
      async () => {
        calls++;
        return new Response('{}');
      },
      1000
    ),
    /cancelled/
  );
  assert.equal(calls, 0);
});

test('a failed validation can be followed by a fresh denied policy without caching success', async () => {
  const url = 'https://example.supabase.co/rest/v1/rpc/enforce_docubox_session_policy';
  await assert.rejects(
    fetchWithPasswordSignInTimeout(
      url,
      undefined,
      async () => new Response(new ReadableStream()),
      10
    ),
    { name: 'TimeoutError' }
  );
  const result = await fetchWithPasswordSignInTimeout(
    url,
    undefined,
    async () => Response.json([{ active: false, reason: 'INACTIVITY_TIMEOUT' }]),
    1000
  );
  assert.deepEqual(await result.json(), [{ active: false, reason: 'INACTIVITY_TIMEOUT' }]);
});

test('auth sign-out and other no-content responses remain valid', async () => {
  const result = await fetchWithCompleteResponseTimeout(
    'https://example.supabase.co/auth/v1/logout',
    undefined,
    {
      timeoutMs: 1000,
      fetchImpl: async () => new Response(null, { status: 204 }),
    }
  );
  assert.equal(result.status, 204);
  assert.equal(await result.text(), '');
});
