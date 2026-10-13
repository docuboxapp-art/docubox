import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { buildFormEmail } from '../supabase/functions/_shared/form-email-template.ts';

const nodeRequire = createRequire(import.meta.url);
const source = readFileSync('src/lib/forms/claim-public-form.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const formId = '11111111-1111-4111-8111-111111111111';
const publicCode = 'ABCD2345';

function fixture({
  accessMode = 'private',
  user = { id: 'user-1', email: 'ana@example.com' },
  prior = null,
  codeExists = true,
  mobileStatus = 'completed',
  mobileFormId = formId,
  captureApproved = true,
  enrollmentApproved = true,
  signatureType = 'autografa_digital',
  allowedTypes = ['autografa_digital'],
} = {}) {
  const inserted = [];
  const updated = [];
  const form = {
    id: formId,
    name: 'Solicitud',
    status: 'published',
    settings: { accessMode },
    allowed_signature_types: allowedTypes,
  };
  const chain = (result) => {
    const query = {
      select: () => query,
      eq: () => query,
      or: () => query,
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
        return chain({ data: codeExists ? { form_id: formId, code_lookup: 'lookup', code_hash: 'saved-hash' } : null, error: null });
      if (table === 'form_public_invitees') return chain({ data: {
        recipient_name: 'Ana invitada', launch_prefill: { nombre: 'Ana', rfc: 'RFC-INVITACION' },
      }, error: null });
      if (table === 'form_templates') return chain({ data: form, error: null });
      if (table === 'form_tokens')
        return { ...chain({ data: prior, error: null }), insert: async (row) => {
          inserted.push(row);
          return { error: null };
        }, update: (row) => { updated.push(row); return chain({ error: null }); } };
      if (table === 'mobile_upload_sessions') return chain({ data: {
        id: 'mobile-session-1', user_id: user?.id, status: mobileStatus,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        metadata: {
          mode: 'public_form_liveness', form_id: mobileFormId, capture_log_id: 'capture-1',
          recipient_email: user?.email, identity_match: true, captured_at: new Date().toISOString(),
          provider: { liveness_passed: true, provider_reference: 'verified-1' },
        },
      }, error: null });
      if (table === 'id_capture_logs') return chain({ data: {
        id: 'capture-1', nubarium_aprobado: captureApproved,
      }, error: null });
      if (table === 'enrollment_tokens') return chain({ data: {
        id: 'enrollment-1', status: enrollmentApproved ? 'completed' : 'pending',
        document_metadata: { provider_reference: 'enrollment-provider-1' },
      }, error: null });
      if (table === 'enrollment_results') return chain({ data: {
        id: 'enrollment-result-1', face_match_passed: enrollmentApproved,
        created_at: new Date().toISOString(),
      }, error: null });
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
    if (name === './public-code-access')
      return {
        PublicCodeError: class PublicCodeError extends Error { constructor(message, status) { super(message); this.status = status; } },
        verifyPublicCode: async (_service, _request, body) => {
          if (!codeExists) throw new Error('El código no corresponde a esta invitación.');
          return { formId: body.formId, email: user?.email || 'ana@example.com', userId: user?.id || null, name: 'Ana invitada', signatureType };
        },
      };
    if (name === '@/lib/security/capability-token')
      return { hashCapabilityToken: (value) => `hash:${value}` };
    throw new Error(`Unexpected import: ${name}`);
  }, exports);
  const request = {
    headers: new Headers(),
    json: async () => ({ code: publicCode, email: 'ana@example.com', mobileSessionToken: 'a'.repeat(64) }),
  };
  return { exports, request, inserted, updated };
}

const previousEnv = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  gateway: process.env.IDENTITY_VERIFICATION_GATEWAY_URL,
  token: process.env.IDENTITY_VERIFICATION_GATEWAY_TOKEN,
  resend: process.env.RESEND_API_KEY,
};
const previousFetch = globalThis.fetch;
let deliveredBatch = null;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.IDENTITY_VERIFICATION_GATEWAY_URL = 'https://identity.example.test/verify';
process.env.IDENTITY_VERIFICATION_GATEWAY_TOKEN = 'test-gateway-token';
globalThis.fetch = async (url, options) => {
  if (url.includes('resend.com')) {
    deliveredBatch = JSON.parse(options.body);
    return { ok: true, json: async () => ({ data: [{ id: 'mail-1' }, { id: 'mail-2' }] }) };
  }
  return { ok: true, json: async () => ({ status: 'VALID', liveness: { passed: true }, verification_id: 'verified-1' }) };
};
process.env.RESEND_API_KEY = 'resend-test-key';
test.after(() => {
  for (const [key, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: previousEnv.url,
    SUPABASE_SERVICE_ROLE_KEY: previousEnv.key,
    IDENTITY_VERIFICATION_GATEWAY_URL: previousEnv.gateway,
    IDENTITY_VERIFICATION_GATEWAY_TOKEN: previousEnv.token,
    RESEND_API_KEY: previousEnv.resend,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = previousFetch;
});

test('a public code needs an account profile but not an authenticated session', async () => {
  const newRecipient = fixture({ user: null });
  assert.equal((await newRecipient.exports.claimPublicForm(newRecipient.request, formId)).status, 409);
  assert.equal(newRecipient.inserted.length, 0);
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
  assert.equal(current.inserted[0].recipient_name, 'Ana invitada');
  assert.equal(current.inserted[0].launch_prefill.rfc, 'RFC-INVITACION');
});

test('without an active code, the form cannot be claimed publicly', async () => {
  const current = fixture({ codeExists: false });
  assert.equal((await current.exports.claimPublicForm(current.request, formId)).status, 503);
  assert.equal(current.inserted.length, 0);
});

test('an existing response cannot claim another public link', async () => {
  const current = fixture({ prior: { token: 'previous-token', used_at: '2026-10-09T12:00:00Z', expires_at: null } });
  assert.equal((await current.exports.claimPublicForm(current.request, formId)).status, 409);
  assert.equal(current.inserted.length, 0);
});

test('a reused unsubmitted link updates the selected signature method', async () => {
  const current = fixture({ signatureType: 'efirma_sat', prior: {
    token: 'previous-token', used_at: null,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  } });
  const response = await current.exports.claimPublicForm(current.request, formId);
  assert.equal(response.status, 200);
  assert.equal(response.body.url, '/form/previous-token');
  assert.equal(current.updated[0].signature_type, 'efirma_sat');
  assert.equal(current.inserted.length, 0);
});

function codeRouteFixture({ existing = false, authorized = true, allowedTypes = ['autografa_digital'], recipientEmail = 'ana@example.com', signatureType = 'autografa_digital' } = {}) {
  const inserts = [];
  const updates = [];
  const invitees = [];
  const form = {
    id: formId,
    name: 'Solicitud',
    status: 'published',
    settings: { accessMode: 'private' },
    created_by: 'owner-1',
    workspace_id: 'workspace-1',
    allowed_signature_types: allowedTypes,
    workspaces: { name: 'Espacio' },
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
        return { ...chain(existing ? { code_ciphertext: 'encrypted-existing-code', code_lookup: 'old-lookup', code_hash: 'old-hash' } : null),
          update: (row) => { updates.push(row); return chain({ code_ciphertext: 'encrypted-new-code' }); },
          insert: async (row) => {
          inserts.push(row);
          return { error: null };
        } };
      if (table === 'form_public_invitees') return { upsert: async (row) => {
        invitees.push(row); return { error: null };
      } };
      if (table === 'user_profiles') return chain({ full_name: 'Luis Lanzador' });
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
        createPublicCode: () => 'ABCDEFGH',
        decryptPublicCode: (value) => value === 'encrypted-existing-code' ? 'DBX-0123456789ABCDEF12' : 'ABCDEFGH',
        encryptPublicCode: () => 'encrypted-new-code',
        hashPublicCode: () => 'hash',
        publicCodeLookup: () => 'lookup',
        isLegacyPublicCode: (value) => value.startsWith('DBX-'),
      };
    if (name === '@/lib/templates/publication-server')
      return { resolveTemplatePublicationContext: async () => authorized ? { user: { id: 'owner-1' }, canManageResources: true } : null };
    if (name === '@/lib/publicAppUrl') return { getPublicAppUrl: () => 'https://docubox.example' };
    if (name.includes('form-email-template')) return { buildFormEmail };
    throw new Error(`Unexpected import: ${name}`);
  }, exports);
  return {
    exports,
    inserts,
    updates,
    invitees,
    request: { headers: new Headers({ Authorization: 'Bearer owner-token' }),
      nextUrl: { origin: 'https://docubox.example' },
      json: async () => ({ recipient: { email: recipientEmail }, signatureType }) },
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
  assert.equal(response.body.code, 'ABCDEFGH');
  assert.equal(current.inserts.length, 1);
  assert.equal(current.inserts[0].form_id, formId);
  assert.equal(response.body.emails_sent, 2);
  assert.equal(current.invitees[0].recipient_email, 'ana@example.com');
  assert.equal(current.invitees[0].recipient_name, '');
  assert.deepEqual(current.invitees[0].launch_prefill, {});
  assert.equal(current.invitees[0].signature_type, 'autografa_digital');
  assert.equal(deliveredBatch.length, 2);
  assert.deepEqual(deliveredBatch.map((mail) => mail.to), [['ana@example.com'], ['ana@example.com']]);
  assert.doesNotMatch(deliveredBatch[0].html, /ABCDEFGH/);
  assert.match(deliveredBatch[1].html, /ABCDEFGH/);
  assert.match(deliveredBatch[0].html, /Hola,<\/p>/);
  assert.doesNotMatch(deliveredBatch[0].html, /Hola <strong>Participante<\/strong>/);
});

test('a public form requires an approved mobile capture linked to that form', async () => {
  for (const options of [
    { mobileStatus: 'pending' },
    { mobileFormId: '22222222-2222-4222-8222-222222222222' },
    { captureApproved: false },
  ]) {
    const current = fixture(options);
    assert.equal((await current.exports.claimPublicForm(current.request, formId)).status, 422);
    assert.equal(current.inserted.length, 0);
  }
});

test('a selfie submitted without a completed mobile session cannot open the form', async () => {
  const current = fixture();
  current.request.json = async () => ({ code: publicCode, selfie: 'selfie-data' });
  assert.equal((await current.exports.claimPublicForm(current.request, formId)).status, 400);
  assert.equal(current.inserted.length, 0);
});

test('a fresh biometric enrollment opens the form without a second selfie capture', async () => {
  const current = fixture();
  current.request.json = async () => ({ code: publicCode, email: 'ana@example.com', enrollmentToken: 'b'.repeat(64) });
  const response = await current.exports.claimPublicForm(current.request, formId);
  assert.equal(response.status, 200);
  assert.equal(current.inserted[0].liveness_reference, 'enrollment-provider-1');

  const failed = fixture({ enrollmentApproved: false });
  failed.request.json = current.request.json;
  assert.equal((await failed.exports.claimPublicForm(failed.request, formId)).status, 422);
  assert.equal(failed.inserted.length, 0);
});

test('an invalid recipient email cannot activate a public code', async () => {
  const current = codeRouteFixture({ recipientEmail: 'correo-invalido' });
  const response = await current.exports.POST(current.request, current.context);
  assert.equal(response.status, 400);
  assert.equal(current.inserts.length, 0);
  assert.equal(current.invitees.length, 0);
});

test('existing long codes become short without discarding the legacy verifier', async () => {
  const existing = codeRouteFixture({ existing: true });
  assert.equal((await existing.exports.POST(existing.request, existing.context)).body.code, 'ABCDEFGH');
  assert.equal(existing.updates[0].legacy_code_lookup, 'old-lookup');
  assert.equal(existing.updates[0].legacy_code_hash, 'old-hash');
  assert.equal(existing.inserts.length, 0);
  const denied = codeRouteFixture({ authorized: false });
  assert.equal((await denied.exports.POST(denied.request, denied.context)).status, 403);
});

test('public launch offers the same signature methods as private launch', async () => {
  for (const signatureType of ['click_sign', 'efirma_sat']) {
    const current = codeRouteFixture({ signatureType });
    assert.equal((await current.exports.POST(current.request, current.context)).status, 200);
    assert.equal(current.invitees[0].signature_type, signatureType);
    const claimed = fixture({ signatureType });
    assert.equal((await claimed.exports.claimPublicForm(claimed.request, formId)).status, 200);
    assert.equal(claimed.inserted[0].signature_type, signatureType);
  }
});

test('public launch rejects missing or unknown signature types', async () => {
  for (const [signatureType, expectedStatus] of [['', 400], ['unknown', 400]]) {
    const current = codeRouteFixture({ signatureType });
    assert.equal((await current.exports.POST(current.request, current.context)).status, expectedStatus);
    assert.equal(current.invitees.length, 0);
  }
});
