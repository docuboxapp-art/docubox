import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';

// Entirely synthetic sessions and transport: never reads env or contacts Auth.
const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated' };
function session(marker) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, marker })}.synthetic`,
    refresh_token: `synthetic-${marker}`,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer', user,
  };
}

async function fixture(t, fetchImpl) {
  const values = new Map([['qa-auth', JSON.stringify(session('initial'))]]);
  const client = createClient('https://synthetic.invalid', 'synthetic-public-key', {
    auth: {
      autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'qa-auth',
      storage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => { values.set(key, value); },
        removeItem: (key) => { values.delete(key); },
      },
    },
    global: { fetch: fetchImpl },
  });
  t.after(() => client.auth.dispose());
  assert.equal((await client.auth.getSession()).error, null);
  return { client, values };
}

function gate() {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  return { pending, release };
}

test('simultaneous refreshes share one upstream request', { timeout: 2000 }, async (t) => {
  const entered = gate();
  const response = gate();
  let calls = 0;
  const { client } = await fixture(t, async () => {
    calls += 1; entered.release();
    await response.pending;
    return Response.json(session('rotated'));
  });
  const first = client.auth.refreshSession();
  await entered.pending;
  const second = client.auth.refreshSession();
  await new Promise(setImmediate);
  response.release();
  const results = await Promise.all([first, second]);
  assert.equal(calls, 1);
  for (const result of results) {
    assert.equal(result.error, null);
    assert.equal(result.data.session.refresh_token, 'synthetic-rotated');
  }
});

test('a refresh cannot restore a session after sign out', { timeout: 2000 }, async (t) => {
  const entered = gate();
  const response = gate();
  const { client, values } = await fixture(t, async (input) => {
    if (String(input).includes('/logout')) return new Response(null, { status: 204 });
    entered.release(); await response.pending;
    return Response.json(session('discarded'));
  });
  const refresh = client.auth.refreshSession();
  await entered.pending;
  assert.equal((await client.auth.signOut({ scope: 'local' })).error, null);
  assert.equal(values.has('qa-auth'), false);
  response.release();
  const result = await refresh;
  assert.equal(result.error?.name, 'AuthRefreshDiscardedError');
  assert.equal((await client.auth.getSession()).data.session, null);
  assert.equal(values.has('qa-auth'), false);
});

test('a session read inside an auth subscriber does not deadlock', { timeout: 2000 }, async (t) => {
  const { client } = await fixture(t, async () => Response.json(session('rotated')));
  let observed;
  const { data: { subscription } } = client.auth.onAuthStateChange(async (event) => {
    if (event === 'TOKEN_REFRESHED') observed = (await client.auth.getSession()).data.session;
  });
  t.after(() => subscription.unsubscribe());
  const result = await client.auth.refreshSession();
  assert.equal(result.error, null);
  assert.equal(observed?.refresh_token, 'synthetic-rotated');
});
