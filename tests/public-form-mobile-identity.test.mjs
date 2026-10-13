import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const nodeRequire = createRequire(import.meta.url);
const source = readFileSync('src/app/api/mobile-upload/create-id-capture-session/route.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const formId = '11111111-1111-4111-8111-111111111111';

function fixture({ codeMatches = true, failures = 0, published = true, storedId = true } = {}) {
  const sessions = [];
  const chain = (result) => {
    const query = {
      select: () => query,
      eq: () => query,
      or: () => query,
      not: () => query,
      gte: () => query,
      limit: () => query,
      maybeSingle: async () => ({ data: result, error: null }),
    };
    return query;
  };
  const service = {
    from(table) {
      if (table === 'mobile_upload_sessions') return {
        insert: (row) => {
          sessions.push(row);
          return { select: () => ({ single: async () => ({ data: { id: 'session-1' }, error: null }) }) };
        },
      };
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  const user = { id: 'user-1', email: 'ana@example.com', email_confirmed_at: '2026-10-09' };
  const exports = {};
  new Function('require', 'exports', compiled)((name) => {
    if (name === 'node:crypto') return nodeRequire(name);
    if (name === 'next/server') return { NextResponse: { json: (body, options = {}) => ({
      body, status: options.status || 200,
    }) } };
    if (name === '@/lib/supabase/server') return {
      createServiceClient: () => service,
      createAnonClient: () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
    };
    if (name === '@/lib/security/document-access') return {
      requireDocumentAccess: () => { throw new Error('Document access must not be used'); },
      documentAccessResponse: () => ({ body: { error: 'Unexpected error' }, status: 500 }),
    };
    if (name === '@/lib/identity/capture-crypto') return { captureEncryptionKey: () => Buffer.alloc(32) };
    if (name === '@/lib/identity/stored-identity') return {
      findStoredIdentity: async () => storedId ? { front: 'front', back: 'back' } : null,
    };
    if (name === '@/lib/forms/public-code-access') return {
      PublicCodeError: class PublicCodeError extends Error { constructor(message, status) { super(message); this.status = status; } },
      verifyPublicCode: async () => {
        if (!codeMatches || failures >= 10 || !published) throw new Error('Invalid public invitation');
        return { formId, email: 'ana@example.com', userId: 'user-1' };
      },
    };
    throw new Error(`Unexpected import: ${name}`);
  }, exports);
  const request = {
    headers: new Headers(),
    json: async () => ({ formId, code: 'ABCD2345', email: 'ana@example.com' }),
  };
  return { exports, request, sessions };
}

test('a code recipient can create a mobile form session without a Docubox login', async () => {
  const current = fixture();
  const response = await current.exports.POST(current.request);
  assert.equal(response.status, 200);
  assert.equal(response.body.hasStoredId, true);
  assert.match(response.body.token, /^[a-f0-9]{64}$/);
  assert.equal(current.sessions[0].metadata.mode, 'public_form_liveness');
  assert.equal(current.sessions[0].metadata.form_id, formId);
  assert.equal(current.sessions[0].metadata.recipient_email, 'ana@example.com');
  assert.equal(current.sessions[0].metadata.document_id, null);
});

test('a wrong code and exhausted attempts cannot start mobile capture', async () => {
  for (const options of [{ codeMatches: false }, { failures: 10 }, { published: false }]) {
    const current = fixture(options);
    const response = await current.exports.POST(current.request);
    assert.notEqual(response.status, 200);
    assert.equal(current.sessions.length, 0);
  }
});
