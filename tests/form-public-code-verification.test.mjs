import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const nodeRequire = createRequire(import.meta.url);
const source = readFileSync('src/app/api/formularios/publico/verificar-codigo/route.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const formId = '11111111-1111-4111-8111-111111111111';
const code = 'ABCD2345';

function fixture({ account = true, codeMatches = true, formPublished = true, failures = 0 } = {}) {
  const attempts = [];
  const chain = (result) => {
    const query = {
      select: () => query,
      eq: () => query,
      or: () => query,
      gte: () => query,
      maybeSingle: async () => result,
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return query;
  };
  const service = {
    auth: { getUser: async () => ({ data: { user: account ? {
      id: 'user-1', email: 'ana@example.com', email_confirmed_at: '2026-10-09',
    } : null }, error: null }) },
    from(table) {
      if (table === 'form_public_code_attempts')
        return { ...chain({ count: failures, error: null }), insert: async (row) => {
          attempts.push(row); return { error: null };
        } };
      if (table === 'form_public_access_codes')
        return chain({ data: { form_id: formId, code_lookup: 'lookup', code_hash: 'saved-hash' }, error: null });
      if (table === 'form_templates')
        return chain({ data: { name: 'Solicitud', status: formPublished ? 'published' : 'draft',
          settings: {}, allowed_signature_types: ['autografa_digital'] }, error: null });
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  const exports = {};
  new Function('require', 'exports', compiled)((name) => {
    if (name === 'node:crypto') return nodeRequire(name);
    if (name === 'next/server') return { NextResponse: { json: (body, options = {}) => ({
      body, status: options.status || 200,
    }) } };
    if (name === '@supabase/supabase-js') return { createClient: () => service };
    if (name === '@/lib/forms/public-access-code') return {
      normalizePublicCode: (value) => String(value).replaceAll('-', ''),
      publicCodeLookup: () => 'lookup',
      isValidPublicCode: () => true,
      matchesStoredPublicCode: () => codeMatches,
    };
    throw new Error(`Unexpected import: ${name}`);
  }, exports);
  const request = {
    headers: new Headers({ Authorization: 'Bearer verified-user-token' }),
    json: async () => ({ code, formId }),
  };
  return { exports, request, attempts };
}

const priorUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const priorKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
test.after(() => {
  if (priorUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = priorUrl;
  if (priorKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = priorKey;
});

test('a registered user sees whether the code is correct before taking a photo', async () => {
  const current = fixture();
  const response = await current.exports.POST(current.request);
  assert.equal(response.status, 200);
  assert.equal(response.body.valid, true);
  assert.equal(current.attempts[0].succeeded, true);
});

test('an incorrect code is rejected and counted without opening the form', async () => {
  const current = fixture({ codeMatches: false });
  const response = await current.exports.POST(current.request);
  assert.equal(response.status, 403);
  assert.equal(current.attempts[0].succeeded, false);
});

test('code checks require a verified account and respect rate limits', async () => {
  const noAccount = fixture({ account: false });
  assert.equal((await noAccount.exports.POST(noAccount.request)).status, 401);
  const limited = fixture({ failures: 5 });
  assert.equal((await limited.exports.POST(limited.request)).status, 429);
  assert.equal(limited.attempts.length, 0);
});

test('a code for an unpublished form is not accepted', async () => {
  const current = fixture({ formPublished: false });
  assert.equal((await current.exports.POST(current.request)).status, 404);
});
