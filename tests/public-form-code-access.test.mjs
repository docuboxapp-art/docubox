import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const nodeRequire = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync('src/lib/forms/public-code-access.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const formId = '11111111-1111-4111-8111-111111111111';
const request = { headers: new Headers({ 'x-forwarded-for': '203.0.113.10' }) };

function fixture({ failures = 0, boundCode = true, profile = true, legacy = false,
  signatureType = 'autografa_digital', allowedTypes = ['autografa_digital'] } = {}) {
  const attempts = [];
  const rows = {
    form_public_invitees: [{ form_id: formId, recipient_email: 'ana@example.com',
      recipient_name: 'Ana', code_lookup: boundCode ? 'ABCD2345' : null,
      code_hash: boundCode ? 'matching-hash' : null, signature_type: signatureType }],
    form_public_access_codes: legacy ? [{ form_id: formId, code_lookup: 'ABCD2345',
      code_hash: 'matching-hash' }] : [],
    user_profiles: profile ? [{ id: 'user-1', email: 'ana@example.com', full_name: 'Ana' }] : [],
    form_templates: [{ id: formId, status: 'published', settings: {},
      allowed_signature_types: allowedTypes }],
  };
  const service = {
    from(table) {
      if (table === 'form_public_code_attempts') return {
        select: () => ({ eq: () => ({ eq: () => ({ gte: async () => ({ count: failures, error: null }) }) }) }),
        insert: async (row) => { attempts.push(row); return { error: null }; },
      };
      const filters = [];
      const query = {
        select: () => query,
        eq: (field, value) => { filters.push([field, value]); return query; },
        or: () => query,
        maybeSingle: async () => ({ data: (rows[table] || []).find((row) =>
          filters.every(([field, value]) => row[field] === value)) || null, error: null }),
      };
      return query;
    },
  };
  const exports = {};
  new Function('require', 'exports', source)((name) => {
    if (name === 'server-only') return {};
    if (name === 'node:crypto') return nodeRequire(name);
    if (name === '@/lib/supabase/server') return {};
    if (name === './public-access-code') return {
      normalizePublicCode: (value) => String(value || '').trim().toUpperCase(),
      isValidPublicCode: (value) => /^[A-Z0-9]{8}$/.test(value),
      publicCodeLookup: (value) => value,
      matchesPublicCode: (_code, hash) => hash === 'matching-hash',
      matchesStoredPublicCode: (_code, access) => access.code_hash === 'matching-hash',
    };
    throw new Error(`Unexpected import: ${name}`);
  }, exports);
  return { service, exports, attempts };
}

test('the individual code identifies its invitee without an app session', async () => {
  const current = fixture();
  const access = await current.exports.verifyPublicCode(current.service, request,
    { code: 'ABCD2345', email: 'ANA@example.com', formId });
  assert.equal(access.userId, 'user-1');
  assert.equal(access.recipientBound, true);
  assert.equal(access.signatureType, 'autografa_digital');
  assert.equal(current.attempts[0].succeeded, true);
});

test('a new invitee can validate the code before creating an account', async () => {
  const current = fixture({ profile: false });
  const access = await current.exports.verifyPublicCode(current.service, request,
    { code: 'ABCD2345', email: 'ana@example.com', formId });
  assert.equal(access.userId, null);
  assert.equal(access.recipientBound, true);
  assert.equal(current.attempts[0].user_id, null);
});

test('an individual code cannot be used with another recipient email', async () => {
  const current = fixture();
  await assert.rejects(current.exports.verifyPublicCode(current.service, request,
    { code: 'ABCD2345', email: 'otra@example.com', formId }), { status: 403 });
  assert.equal(current.attempts[0].succeeded, false);
});

test('the shared legacy code only works for an invited recipient without a new individual code', async () => {
  const current = fixture({ boundCode: false, legacy: true });
  const access = await current.exports.verifyPublicCode(current.service, request,
    { code: 'ABCD2345', email: 'ana@example.com', formId });
  assert.equal(access.recipientBound, false);
  assert.equal(access.userId, 'user-1');
});

test('too many failed attempts stop code checks before identity lookup', async () => {
  const current = fixture({ failures: 10 });
  await assert.rejects(current.exports.verifyPublicCode(current.service, request,
    { code: 'ABCD2345', email: 'ana@example.com', formId }), { status: 429 });
  assert.equal(current.attempts.length, 0);
});

test('the individual code carries its configured signature method', async () => {
  for (const signatureType of ['click_sign', 'efirma_sat']) {
    const current = fixture({ signatureType });
    const access = await current.exports.verifyPublicCode(current.service, request,
      { code: 'ABCD2345', email: 'ana@example.com', formId });
    assert.equal(access.signatureType, signatureType);
  }
});

test('the code cannot be claimed with an unknown signature method', async () => {
  const current = fixture({ signatureType: 'unknown' });
  await assert.rejects(current.exports.verifyPublicCode(current.service, request,
    { code: 'ABCD2345', email: 'ana@example.com', formId }), { status: 409 });
});
