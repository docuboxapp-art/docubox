import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchWithRequestDeadline } from '../src/lib/supabase/server.ts';

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
