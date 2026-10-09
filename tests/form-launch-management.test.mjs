import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { buildFormEmail } from '../supabase/functions/_shared/form-email-template.ts';

const source = readFileSync('src/app/api/formularios/lanzamientos/[launchId]/route.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const launchId = '11111111-1111-4111-8111-111111111111';

function fixture({ authorized = true, used = false, expired = false, self = false, noExpiry = false } = {}) {
  const updates = [];
  const emails = [];
  const launch = { id: launchId, template_id: 'form-1', recipient_name: 'Ana', recipient_email: 'ana@example.com', token: 'private-token', expires_at: noExpiry ? null : expired ? '2000-01-01T00:00:00Z' : '2099-01-01T00:00:00Z', used_at: used ? '2026-10-09T12:00:00Z' : null, launcher_name: 'Carlos Lanzador', sent_to_self: self };
  const service = {
    from(table) {
      assert.ok(['form_tokens', 'user_profiles'].includes(table));
      if (table === 'user_profiles') {
        const profileBuilder = {
          select() { return profileBuilder; },
          eq() { return profileBuilder; },
          maybeSingle() { return Promise.resolve({ data: { full_name: 'Carlos Lanzador' }, error: null }); },
        };
        return profileBuilder;
      }
      let action = 'select';
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        is() { return builder; },
        gt() { return builder; },
        update(value) { action = 'update'; updates.push(value); return builder; },
        maybeSingle() { return Promise.resolve({ data: action === 'update' ? { id: launchId } : launch, error: null }); },
      };
      return builder;
    },
  };
  const user = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from(table) {
      assert.equal(table, 'form_templates');
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        maybeSingle() { return Promise.resolve({ data: authorized ? { id: 'form-1', name: 'Solicitud', status: 'published', workspaces: { name: 'Mi espacio' } } : null, error: null }); },
      };
      return builder;
    },
  };
  const exports = {};
  new Function('require', 'exports', 'fetch', compiled)((name) => {
    if (name === 'next/server') return { NextResponse: { json(body, options = {}) { return { body, status: options.status || 200 }; } } };
    if (name === '@/lib/supabase/server') return { createAnonClient: () => user, createServiceClient: () => service };
    if (name === '@/lib/publicAppUrl') return { getPublicAppUrl: () => 'https://app.docubox.mx' };
    if (name === '../../../../../../supabase/functions/_shared/form-email-template') return { buildFormEmail };
    throw new Error(`Unexpected import: ${name}`);
  }, exports, async (_url, options) => { emails.push(options); return { ok: true }; });
  const req = { headers: new Headers({ authorization: 'Bearer user-token' }) };
  const context = { params: Promise.resolve({ launchId }) };
  return { exports, req, context, updates, emails };
}

test('pending links can be cancelled only when the caller can access the form', async () => {
  const denied = fixture({ authorized: false });
  assert.equal((await denied.exports.DELETE(denied.req, denied.context)).status, 403);
  assert.equal(denied.updates.length, 0);

  const valid = fixture();
  assert.equal((await valid.exports.DELETE(valid.req, valid.context)).status, 200);
  assert.equal(valid.updates.length, 1);
  assert.ok(new Date(valid.updates[0].expires_at).getTime() <= Date.now());
});

test('a self-addressed reminder retains the launcher identity and states there is no deadline', async () => {
  const previous = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-key';
  try {
    const current = fixture({ self: true, noExpiry: true });
    const response = await current.exports.POST(current.req, current.context);
    assert.equal(response.status, 200);
    const html = JSON.parse(current.emails[0].body).html;
    assert.match(html, /Carlos Lanzador \(tú\)/);
    assert.match(html, /solicitaste para ti/);
    assert.match(html, /Sin fecha límite/);
  } finally {
    if (previous === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous;
  }
});

test('answered and expired links cannot be managed', async () => {
  for (const options of [{ used: true }, { expired: true }]) {
    const current = fixture(options);
    assert.equal((await current.exports.DELETE(current.req, current.context)).status, 409);
    assert.equal(current.updates.length, 0);
  }
});

test('a reminder reuses the authorized active link without exposing its token in the response', async () => {
  const previous = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-key';
  try {
    const current = fixture();
    const response = await current.exports.POST(current.req, current.context);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { success: true });
    assert.equal(current.emails.length, 1);
    assert.match(JSON.parse(current.emails[0].body).html, /https:\/\/app\.docubox\.mx\/portal-formulario\/private-token/);
    assert.match(JSON.parse(current.emails[0].body).html, /Carlos Lanzador/);
    assert.doesNotMatch(JSON.parse(current.emails[0].body).html, /Solicitado por<\/td>.*Mi espacio/);
  } finally {
    if (previous === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous;
  }
});
