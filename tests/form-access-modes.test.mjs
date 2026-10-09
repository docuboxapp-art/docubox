import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const nodeRequire = createRequire(import.meta.url);
const source = readFileSync('src/lib/forms/claim-public-form.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const formId = '11111111-1111-4111-8111-111111111111';
const publicCode = 'DBX-0123456789ABCDEF12';

function fixture({
  accessMode = 'private',
  user = { id: 'user-1', email: 'ana@example.com', email_confirmed_at: '2026-10-09' },
  prior = null,
  codeExists = true,
} = {}) {
  const inserted = [];
  const form = {
    id: formId,
    name: 'Solicitud',
    status: 'published',
    settings: { accessMode },
    allowed_signature_types: ['autografa_digital'],
  };
  const chain = (result) => {
    const query = {
      select: () => query,
      eq: () => query,
      not: () => query,
      gte: () => query,
      order: () => query,
      limit: () => query,
      maybeSingle: async () => result,
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return query;
  };
  const service = {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from(table) {
      if (table === 'form_public_code_attempts') {
        return { ...chain({ count: 0, error: null }), insert: async () => ({ error: null }) };
      }
      if (table === 'form_public_access_codes')
        return chain({ data: codeExists ? { form_id: formId, code_hash: 'saved-hash' } : null, error: null });
      if (table === 'form_templates') return chain({ data: form, error: null });
      if (table === 'form_tokens')
        return { ...chain({ data: prior, error: null }), insert: async (row) => {
          inserted.push(row);
          return { error: null };
        } };
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  const exports = {};
  new Function('require', 'exports', compiled)((name) => {
    if (name === 'server-only') return {};
    if (name === 'node:crypto') return nodeRequire(name);
    if (name === 'next/server')
      return { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } };
    if (name === '@supabase/supabase-js') return { createClient: () => service };
    if (name === './public-access-code')
      return { normalizePublicCode: (value) => String(value).replaceAll('-', ''), publicCodeLookup: () => 'lookup', matchesPublicCode: () => true };
    if (name === '@/lib/identity/capture-crypto')
      return { captureEncryptionKey: () => null, normalizeImageBase64: (value) => value, validImageBase64: () => true };
    throw new Error(`Unexpected import: ${name}`);
  }, exports);
  const request = {
    headers: new Headers({ Authorization: 'Bearer verified-user-token' }),
    json: async () => ({ code: publicCode, selfie: 'selfie-data' }),
  };
  return { exports, request, inserted };
}

const previousEnv = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  gateway: process.env.IDENTITY_VERIFICATION_GATEWAY_URL,
  token: process.env.IDENTITY_VERIFICATION_GATEWAY_TOKEN,
};
const previousFetch = globalThis.fetch;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.IDENTITY_VERIFICATION_GATEWAY_URL = 'https://identity.example.test/verify';
process.env.IDENTITY_VERIFICATION_GATEWAY_TOKEN = 'test-gateway-token';
globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 'VALID', liveness: { passed: true }, verification_id: 'verified-1' }) });
test.after(() => {
  for (const [key, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: previousEnv.url,
    SUPABASE_SERVICE_ROLE_KEY: previousEnv.key,
    IDENTITY_VERIFICATION_GATEWAY_URL: previousEnv.gateway,
    IDENTITY_VERIFICATION_GATEWAY_TOKEN: previousEnv.token,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = previousFetch;
});

test('public code requires a verified registered account', async () => {
  const unverified = fixture({ user: { id: 'user-1', email: 'ana@example.com', email_confirmed_at: null } });
  assert.equal((await unverified.exports.claimPublicForm(unverified.request, formId)).status, 401);
  assert.equal(unverified.inserted.length, 0);
});

test('a code activates public access even when the form can also send private invitations', async () => {
  const current = fixture({ accessMode: 'private' });
  const response = await current.exports.claimPublicForm(current.request, formId);
  assert.equal(response.status, 200);
  assert.match(response.body.url, /^\/form\/[a-f0-9]{64}$/);
  assert.equal(current.inserted.length, 1);
  assert.equal(current.inserted[0].recipient_user_id, 'user-1');
  assert.equal(current.inserted[0].access_mode, 'public');
  assert.equal(current.inserted[0].liveness_reference, 'verified-1');
  assert.equal(current.inserted[0].signature_type, 'autografa_digital');
});

test('without an active code, the form cannot be claimed publicly', async () => {
  const current = fixture({ codeExists: false });
  assert.equal((await current.exports.claimPublicForm(current.request, formId)).status, 403);
  assert.equal(current.inserted.length, 0);
});

test('an existing response cannot claim another public link', async () => {
  const current = fixture({ prior: { token: 'previous-token', used_at: '2026-10-09T12:00:00Z', expires_at: null } });
  assert.equal((await current.exports.claimPublicForm(current.request, formId)).status, 409);
  assert.equal(current.inserted.length, 0);
});

function codeRouteFixture({ existing = false, authorized = true, allowedTypes = ['autografa_digital'] } = {}) {
  const inserts = [];
  const form = {
    id: formId,
    status: 'published',
    settings: { accessMode: 'private' },
    created_by: 'owner-1',
    workspace_id: 'workspace-1',
    allowed_signature_types: allowedTypes,
  };
  const chain = (data) => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data, error: null }) };
    return query;
  };
  const service = {
    auth: { getUser: async () => ({ data: { user: { id: 'owner-1' } } }) },
    from: (table) => {
      if (table === 'form_templates') return chain(form);
      if (table === 'form_public_access_codes')
        return { ...chain(existing ? { code_ciphertext: 'encrypted-existing-code' } : null), insert: async (row) => {
          inserts.push(row);
          return { error: null };
        } };
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  const routeSource = readFileSync('src/app/api/formularios/publico/[formId]/codigo/route.ts', 'utf8');
  const routeCode = ts.transpileModule(routeSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', routeCode)((name) => {
    if (name === 'next/server')
      return { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } };
    if (name === '@supabase/supabase-js') return { createClient: () => service };
    if (name === '@/lib/forms/public-access-code')
      return {
        createPublicCode: () => 'DBX-new-code',
        decryptPublicCode: () => 'DBX-existing-code',
        encryptPublicCode: () => 'encrypted-new-code',
        hashPublicCode: () => 'hash',
        publicCodeLookup: () => 'lookup',
      };
    if (name === '@/lib/templates/publication-server')
      return { resolveTemplatePublicationContext: async () => authorized ? { user: { id: 'owner-1' }, canManageResources: true } : null };
    throw new Error(`Unexpected import: ${name}`);
  }, exports);
  return {
    exports,
    inserts,
    request: { headers: new Headers({ Authorization: 'Bearer owner-token' }) },
    context: { params: Promise.resolve({ formId }) },
  };
}

test('reading a code never activates public access', async () => {
  const current = codeRouteFixture();
  const response = await current.exports.GET(current.request, current.context);
  assert.equal(response.status, 404);
  assert.equal(current.inserts.length, 0);
});

test('the launcher activates a code on a private-capable published form', async () => {
  const current = codeRouteFixture();
  const response = await current.exports.POST(current.request, current.context);
  assert.equal(response.status, 200);
  assert.equal(response.body.code, 'DBX-new-code');
  assert.equal(current.inserts.length, 1);
  assert.equal(current.inserts[0].form_id, formId);
});

test('existing public codes remain stable and require the form owner', async () => {
  const existing = codeRouteFixture({ existing: true });
  assert.equal((await existing.exports.POST(existing.request, existing.context)).body.code, 'DBX-existing-code');
  assert.equal(existing.inserts.length, 0);
  const denied = codeRouteFixture({ authorized: false });
  assert.equal((await denied.exports.POST(denied.request, denied.context)).status, 403);
});

test('public launch requires autograph signatures', async () => {
  const current = codeRouteFixture({ allowedTypes: ['click_sign'] });
  assert.equal((await current.exports.POST(current.request, current.context)).status, 409);
  assert.equal(current.inserts.length, 0);
});
