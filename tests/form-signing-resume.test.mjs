import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync('supabase/functions/get-form-schema/index.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture({
  userEmail = 'ana@example.com',
  recipientEmail = 'ana@example.com',
  responseStatus = 'signing',
  documentState = 'en_proceso',
} = {}) {
  let handler;
  const queried = [];
  const token = {
    id: 'token-id',
    used_at: '2026-10-08T12:00:00Z',
    expires_at: '2026-10-08T13:00:00Z',
    recipient_email: recipientEmail,
    recipient_user_id: 'user-1',
    access_mode: 'private',
    form_templates: { id: 'template-id', status: 'published', settings: {} },
  };
  const rows = {
    form_tokens: token,
    form_responses: { id: 'response-id', document_id: 'document-id', status: responseStatus },
    documentos: { id: 'document-id', estado: documentState },
  };
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: { id: 'user-1', email: userEmail, email_confirmed_at: '2026-10-08' } },
        error: null,
      }),
    },
    from(table) {
      queried.push(table);
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        single: async () => ({ data: rows[table], error: null }),
        maybeSingle: async () => ({ data: rows[table], error: null }),
      };
      return builder;
    },
  };
  new Function('require', 'exports', compiled)((name) => {
    if (name.includes('deno.land/std')) return { serve: (callback) => { handler = callback; } };
    if (name.includes('@supabase/supabase-js')) return { createClient: () => client };
    throw new Error(`Unexpected import: ${name}`);
  }, {});
  const request = new Request('https://example.test/get-form-schema?token=used-token', {
    headers: { Authorization: 'Bearer account-token' },
  });
  return { handler, request, queried };
}

test('the recipient can resume an unsigned form after its original deadline', async () => {
  const { handler, request, queried } = fixture();
  const response = await handler(request);
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, 'TOKEN_USED');
  assert.equal(body.response_id, 'response-id');
  assert.equal(body.document_id, 'document-id');
  assert.equal(body.document_state, 'en_proceso');
  assert.deepEqual(queried, ['form_tokens', 'form_responses', 'documentos']);
});

test('a different account cannot discover the response or signing document', async () => {
  const { handler, request, queried } = fixture({ userEmail: 'otra@example.com' });
  const response = await handler(request);
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.document_id, undefined);
  assert.deepEqual(queried, ['form_tokens']);
});

test('a signed response is returned as completed rather than a new form', async () => {
  const { handler, request } = fixture({ responseStatus: 'signed', documentState: 'completado' });
  const response = await handler(request);
  const body = await response.json();
  assert.equal(body.response_status, 'signed');
  assert.equal(body.document_state, 'completado');
});
