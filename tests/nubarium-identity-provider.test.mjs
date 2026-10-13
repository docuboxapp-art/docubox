import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const nodeRequire = createRequire(import.meta.url);
const source = readFileSync('src/lib/identity/verify-provider.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const provider = {};
new Function('require', 'exports', compiled)((name) => {
  if (name === 'server-only') return {};
  if (name === 'node:crypto') return nodeRequire(name);
  throw new Error(`Unexpected import: ${name}`);
}, provider);

const previousEnv = {
  user: process.env.NUBARIUM_USER,
  pass: process.env.NUBARIUM_PASS,
  gateway: process.env.IDENTITY_VERIFICATION_GATEWAY_URL,
  token: process.env.IDENTITY_VERIFICATION_GATEWAY_TOKEN,
};

function restoreEnv() {
  for (const [key, value] of Object.entries({
    NUBARIUM_USER: previousEnv.user,
    NUBARIUM_PASS: previousEnv.pass,
    IDENTITY_VERIFICATION_GATEWAY_URL: previousEnv.gateway,
    IDENTITY_VERIFICATION_GATEWAY_TOKEN: previousEnv.token,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function verify({ faceScore = 99.9, live = true, documentValid = true, approvedDocument = null } = {}) {
  delete process.env.IDENTITY_VERIFICATION_GATEWAY_URL;
  delete process.env.IDENTITY_VERIFICATION_GATEWAY_TOKEN;
  process.env.NUBARIUM_USER = 'test';
  process.env.NUBARIUM_PASS = 'test';
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    const body = url.includes('obtener_datos_id')
      ? { tipo: documentValid ? 'INE' : null, nombres: 'ANA', curp: 'AAAA000000MDFXXX00', vigencia: '2030' }
      : url.includes('reconocimiento_facial')
        ? { estatus: 'OK', similitud: faceScore, codigoValidacion: 'face-1' }
        : { status: live ? 'OK' : 'ERROR', messageCode: live ? 0 : 1, score: 98, validationCode: 'live-1' };
    return { ok: true, json: async () => body };
  };
  try {
    const result = await provider.verifyIdentityAndLiveness({
      front: 'front', back: 'back', selfie: 'selfie', approvedDocument,
    });
    return { result, requests };
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
}

test('requires valid document, face match and passive liveness', async () => {
  const success = await verify();
  assert.equal(success.result.status, 'VALID');
  assert.equal(success.result.provider, 'NUBARIUM');
  assert.equal(success.result.liveness.method, 'NUBARIUM_PASSIVE_IMAGE');
  assert.equal(success.requests.length, 3);
  assert.equal((await verify({ faceScore: 90 })).result.status, 'INVALID');
  assert.equal((await verify({ live: false })).result.status, 'INVALID');
  assert.equal((await verify({ documentValid: false })).result.status, 'INVALID');
});

test('a previously approved document is reused while face and liveness are checked again', async () => {
  const current = await verify({ approvedDocument: { curp: 'AAAA000000MDFXXX00', nombre: 'ANA' } });
  assert.equal(current.result.status, 'VALID');
  assert.equal(current.requests.length, 2);
  assert.equal(current.result.document_fields.curp, 'AAAA000000MDFXXX00');
});

test('an explicitly configured identity gateway keeps precedence over Nubarium', async () => {
  process.env.IDENTITY_VERIFICATION_GATEWAY_URL = 'https://gateway.example.test/verify';
  process.env.IDENTITY_VERIFICATION_GATEWAY_TOKEN = 'gateway-token';
  process.env.NUBARIUM_USER = 'test';
  process.env.NUBARIUM_PASS = 'test';
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body), authorization: options.headers.Authorization });
    return { ok: true, json: async () => ({ status: 'VALID', provider: 'GATEWAY' }) };
  };
  try {
    const result = await provider.verifyIdentityAndLiveness({ front: 'front', back: 'back', selfie: 'selfie' });
    assert.equal(result.provider, 'GATEWAY');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://gateway.example.test/verify');
    assert.equal(requests[0].authorization, 'Bearer gateway-token');
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test('a provider outage never produces a successful verification', async () => {
  delete process.env.IDENTITY_VERIFICATION_GATEWAY_URL;
  delete process.env.IDENTITY_VERIFICATION_GATEWAY_TOKEN;
  process.env.NUBARIUM_USER = 'test';
  process.env.NUBARIUM_PASS = 'test';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, json: async () => ({ message: 'unavailable' }) });
  try {
    await assert.rejects(
      provider.verifyIdentityAndLiveness({ front: 'front', back: 'back', selfie: 'selfie' }),
      provider.IdentityProviderUnavailableError,
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});
