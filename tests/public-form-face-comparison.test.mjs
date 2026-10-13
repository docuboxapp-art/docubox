import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const nodeRequire = createRequire(import.meta.url);
const source = readFileSync('src/app/api/nubarium/reconocimiento-facial/route.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const token = 'a'.repeat(64);
const storedImage = 'S'.repeat(300);
const capturedImage = 'C'.repeat(300);
const selfie = 'F'.repeat(300);

function fixture({ status = 'pending', storedId = true, mode = 'public_form_liveness' } = {}) {
  const requests = [];
  const session = {
    user_id: 'user-1', status,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    metadata: { mode },
  };
  const service = {
    from(table) {
      assert.equal(table, 'mobile_upload_sessions');
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: session, error: null }),
      };
      return query;
    },
  };
  const exports = {};
  new Function('require', 'exports', compiled)((name) => {
    if (name === 'next/server') return { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } };
    if (name === '@/lib/supabase/server') return {
      createServiceClient: () => service,
      createClient: async () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
    };
    if (name === '@/lib/security/capability-token') return { hashCapabilityToken: () => 'hashed-token' };
    if (name === '@/lib/identity/capture-crypto') return {
      captureEncryptionKey: () => Buffer.alloc(32),
      validImageBase64: (image) => image.length >= 256,
    };
    if (name === '@/lib/identity/stored-identity') return {
      findStoredIdentity: async () => storedId ? { front: storedImage } : null,
    };
    throw new Error(`Unexpected import: ${name}`);
  }, exports);
  return { exports, requests };
}

async function compare(current, credential) {
  const previousFetch = globalThis.fetch;
  const previousUser = process.env.NUBARIUM_USER;
  const previousPass = process.env.NUBARIUM_PASS;
  process.env.NUBARIUM_USER = 'test';
  process.env.NUBARIUM_PASS = 'test';
  globalThis.fetch = async (_url, options) => {
    current.requests.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ estatus: 'OK', similitud: 99.9 }) };
  };
  try {
    return await current.exports.POST({ json: async () => ({
      credencial: credential, captura: selfie, enrollmentToken: token,
    }) });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUser === undefined) delete process.env.NUBARIUM_USER;
    else process.env.NUBARIUM_USER = previousUser;
    if (previousPass === undefined) delete process.env.NUBARIUM_PASS;
    else process.env.NUBARIUM_PASS = previousPass;
  }
}

test('public form comparison uses the approved stored ID without sending it to the browser', async () => {
  const current = fixture();
  const response = await compare(current);
  assert.equal(response.status, 200);
  assert.equal(current.requests[0].credencial, storedImage);
  assert.equal(current.requests[0].captura, selfie);
});

test('a supplied image cannot replace an approved stored ID in a public form session', async () => {
  const current = fixture();
  const response = await compare(current, capturedImage);
  assert.equal(response.status, 200);
  assert.equal(current.requests[0].credencial, storedImage);
});

test('a new public form enrollee can compare with the ID captured on the phone', async () => {
  const current = fixture({ storedId: false });
  const response = await compare(current, capturedImage);
  assert.equal(response.status, 200);
  assert.equal(current.requests[0].credencial, capturedImage);
});

test('an existing document capture continues using its ID image', async () => {
  const current = fixture({ mode: 'id_capture' });
  const response = await compare(current, capturedImage);
  assert.equal(response.status, 200);
  assert.equal(current.requests[0].credencial, capturedImage);
});

test('a cancelled public form session cannot compare faces', async () => {
  const current = fixture({ status: 'cancelled' });
  const response = await compare(current);
  assert.equal(response.status, 410);
  assert.equal(current.requests.length, 0);
});
