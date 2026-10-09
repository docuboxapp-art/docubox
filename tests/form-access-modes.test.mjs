import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync('src/app/api/formularios/publico/[formId]/claim/route.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const formId = '11111111-1111-4111-8111-111111111111';

function fixture({
  accessMode = 'public',
  user = { id: 'user-1', email: 'ana@example.com', email_confirmed_at: '2026-10-09' },
  prior = null,
} = {}) {
  const inserted = [];
  const form = {
    id: formId,
    name: 'Solicitud',
    status: 'published',
    settings: { accessMode },
    allowed_signature_types: ['autografa_digital'],
  };
  const client = {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from(table) {
      if (table === 'form_templates') {
        const builder = {
          select() {
            return builder;
          },
          eq() {
            return builder;
          },
          maybeSingle: async () => ({ data: form, error: null }),
        };
        return builder;
      }
      assert.equal(table, 'form_tokens');
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        maybeSingle: async () => ({ data: prior, error: null }),
        insert: async (row) => {
          inserted.push(row);
          return { error: null };
        },
      };
      return builder;
    },
  };
  const exports = {};
  new Function('require', 'exports', compiled)((name) => {
    if (name === 'node:crypto') return { randomBytes: () => Buffer.alloc(32, 1) };
    if (name === 'next/server')
      return {
        NextResponse: {
          json(body, options = {}) {
            return { body, status: options.status || 200 };
          },
        },
      };
    if (name === '@supabase/supabase-js') return { createClient: () => client };
    throw new Error(`Unexpected import: ${name}`);
  }, exports);
  const request = { headers: new Headers({ Authorization: 'Bearer verified-user-token' }) };
  return { exports, request, inserted, context: { params: Promise.resolve({ formId }) } };
}

const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
test.after(() => {
  if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
  if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
});

test('a public form accepts only a verified registered account', async () => {
  const unverified = fixture({
    user: { id: 'user-1', email: 'ana@example.com', email_confirmed_at: null },
  });
  assert.equal((await unverified.exports.POST(unverified.request, unverified.context)).status, 401);
  assert.equal(unverified.inserted.length, 0);
  const privateForm = fixture({ accessMode: 'private' });
  assert.equal(
    (await privateForm.exports.POST(privateForm.request, privateForm.context)).status,
    404
  );
});

test('a public link creates an account-bound launch with mandatory liveness', async () => {
  const current = fixture();
  const response = await current.exports.POST(current.request, current.context);
  assert.equal(response.status, 200);
  assert.match(response.body.url, /^\/form\/[a-f0-9]{64}$/);
  assert.equal(current.inserted.length, 1);
  assert.equal(current.inserted[0].recipient_user_id, 'user-1');
  assert.equal(current.inserted[0].access_mode, 'public');
  assert.equal(current.inserted[0].require_liveness, true);
  assert.equal(current.inserted[0].signature_type, 'autografa_digital');
});

test('an existing response cannot claim another public link', async () => {
  const current = fixture({
    prior: {
      token: 'previous-token',
      used_at: '2026-10-09T12:00:00Z',
      expires_at: '2099-01-01T00:00:00Z',
    },
  });
  assert.equal((await current.exports.POST(current.request, current.context)).status, 409);
  assert.equal(current.inserted.length, 0);
});
