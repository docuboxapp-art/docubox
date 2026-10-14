import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformSync } from 'esbuild';

const source = await readFile(
  new URL('../src/lib/supabase/password-auth-fetch.ts', import.meta.url),
  'utf8'
);
const compiled = transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022' }).code;
const { fetchWithPasswordSignInTimeout } = await import(
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
    'https://example.supabase.co/auth/v1/user',
    { method: 'GET' },
    fetchImpl,
    10
  );
  assert.equal(result, response);
  assert.deepEqual(receivedInit, { method: 'GET' });
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
