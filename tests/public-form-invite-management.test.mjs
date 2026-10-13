import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(
  'src/app/api/formularios/lanzamientos/publicos/[formId]/route.ts',
  'utf8'
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const formId = '11111111-1111-4111-8111-111111111111';

function fixture({ authorized = true, answered = false, published = true, legacy = false } = {}) {
  const deleted = [];
  const emails = [];
  const invitee = {
    recipient_name: 'Ana',
    recipient_email: 'ana@example.com',
    invited_at: '2026-10-13T12:00:00Z',
    invited_by: 'user-1',
    code_hash: legacy ? null : 'hash',
    code_ciphertext: legacy ? null : 'encrypted-code',
  };
  const builder = (table) => {
    let deleting = false;
    const chain = {
      select() {
        return chain;
      },
      eq() {
        return chain;
      },
      gte() {
        return chain;
      },
      limit() {
        return chain;
      },
      delete() {
        deleting = true;
        return chain;
      },
      maybeSingle() {
        if (table === 'form_public_invitees') {
          if (deleting) {
            deleted.push(invitee);
            return Promise.resolve({ data: { form_id: formId }, error: null });
          }
          return Promise.resolve({ data: invitee, error: null });
        }
        if (table === 'form_responses')
          return Promise.resolve({ data: answered ? { id: 'response-1' } : null, error: null });
        if (table === 'form_public_access_codes')
          return Promise.resolve({ data: { code_ciphertext: 'legacy-code' }, error: null });
        if (table === 'user_profiles')
          return Promise.resolve({ data: { full_name: 'Carlos' }, error: null });
        throw new Error(`Unexpected table ${table}`);
      },
    };
    return chain;
  };
  const service = { from: builder };
  const user = { id: 'user-1', email: 'carlos@example.com', user_metadata: {} };
  const userClient = {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from(table) {
      assert.equal(table, 'form_templates');
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        maybeSingle() {
          return Promise.resolve({
            data: {
              id: formId,
              name: 'Solicitud',
              status: published ? 'published' : 'draft',
              workspace_id: 'workspace-1',
              created_by: authorized ? 'user-1' : 'other',
              workspaces: { name: 'Mi espacio' },
            },
            error: null,
          });
        },
      };
      return chain;
    },
  };
  const exports = {};
  new Function('require', 'exports', 'fetch', compiled)(
    (name) => {
      if (name === 'next/server')
        return {
          NextResponse: {
            json(body, options = {}) {
              return { body, status: options.status || 200 };
            },
          },
        };
      if (name === '@/lib/supabase/server')
        return { createAnonClient: () => userClient, createServiceClient: () => service };
      if (name === '@/lib/forms/public-access-code')
        return {
          decryptPublicCode: (value) => (value === 'legacy-code' ? 'SHARED123' : 'CODE1234'),
        };
      if (name === '@/lib/publicAppUrl') return { getPublicAppUrl: () => 'https://app.docubox.mx' };
      if (name === '@/lib/templates/publication-server')
        return {
          resolveTemplatePublicationContext: async () => ({ user, canManageResources: false }),
        };
      if (name === '../../../../../../../supabase/functions/_shared/form-email-template')
        return {
          buildFormEmail: ({ variant, accessCode, formUrl }) =>
            `${variant}:${accessCode || ''}:${formUrl}`,
        };
      throw new Error(`Unexpected import ${name}`);
    },
    exports,
    async (_url, options) => {
      emails.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ data: [{ id: 'mail-1' }, { id: 'mail-2' }] }) };
    }
  );
  const request = {
    headers: new Headers({ authorization: 'Bearer user-token' }),
    json: async () => ({ email: 'ana@example.com' }),
  };
  const context = { params: Promise.resolve({ formId }) };
  return { exports, request, context, deleted, emails };
}

test('cancelling a pending code invitation revokes its recipient binding', async () => {
  const current = fixture();
  const response = await current.exports.DELETE(current.request, current.context);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(current.deleted.length, 1);
});

test('unauthorized users and answered invitations cannot be managed', async () => {
  const denied = fixture({ authorized: false });
  assert.equal((await denied.exports.DELETE(denied.request, denied.context)).status, 403);
  assert.equal(denied.deleted.length, 0);
  const answered = fixture({ answered: true });
  assert.equal((await answered.exports.DELETE(answered.request, answered.context)).status, 409);
  assert.equal(answered.deleted.length, 0);
});

test('resending uses the same code in two separate emails without exposing it to the caller', async () => {
  const previous = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-key';
  try {
    const current = fixture();
    const result = await current.exports.POST(current.request, current.context);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { success: true });
    assert.equal(current.emails[0].length, 2);
    assert.match(current.emails[0][0].html, /public_invitation/);
    assert.match(current.emails[0][1].html, /public_code:CODE1234/);
  } finally {
    if (previous === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous;
  }
});

test('legacy shared-code invitations can still be resent', async () => {
  const previous = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-key';
  try {
    const current = fixture({ legacy: true });
    assert.equal((await current.exports.POST(current.request, current.context)).status, 200);
    assert.match(current.emails[0][1].html, /public_code:SHARED123/);
  } finally {
    if (previous === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous;
  }
});
