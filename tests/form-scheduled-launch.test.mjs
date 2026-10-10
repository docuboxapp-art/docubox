import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const scheduledSource = ts.transpileModule(readFileSync('src/app/api/formularios/lanzamientos/programar/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const dispatchSource = ts.transpileModule(readFileSync('src/app/api/internal/form-launch-dispatch/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
class MockNextResponse {
  constructor(body, options = {}) { this.body = body; this.status = options.status || 200; }
  static json(body, options = {}) { return new MockNextResponse(body, options); }
}
const nextServer = { NextResponse: MockNextResponse };

function scheduleFixture() {
  const inserted = [];
  const rpcCalls = [];
  const template = {
    id: 'form-1', workspace_id: 'workspace-1', status: 'published',
    settings: { accessMode: 'private', configureLinkExpiration: true, allowedSignatureTypes: ['click_sign'] },
    allowed_signature_types: ['click_sign'],
  };
  const userClient = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'owner@example.com' } }, error: null }) },
    from(table) {
      assert.equal(table, 'form_templates');
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: template, error: null }) };
      return query;
    },
  };
  const service = {
    rpc: async (name, params) => { rpcCalls.push([name, params]); return { error: null }; },
    from(table) {
      if (table === 'user_profiles') {
        const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { full_name: 'Solicitante' } }) };
        return query;
      }
      assert.equal(table, 'form_send_schedules');
      const query = { insert(row) { inserted.push(row); return query; }, select: () => query, single: async () => ({ data: { id: 'schedule-1', scheduled_at: inserted.at(-1).scheduled_at, status: 'scheduled' }, error: null }) };
      return query;
    },
  };
  const exports = {};
  new Function('require', 'exports', 'process', scheduledSource)((name) => {
    if (name === 'next/server') return nextServer;
    if (name === '@/lib/supabase/server') return { createAnonClient: () => userClient, createServiceClient: () => service };
    if (name === '@/lib/datetime') return { isSupportedTimeZone: (value) => value === 'America/Chihuahua' };
    if (name === '@/lib/publicAppUrl') return { getPublicAppUrl: () => 'https://docubox.example' };
    throw new Error(`Unexpected import: ${name}`);
  }, exports, process);
  const request = (scheduledAt, signatureType = 'click_sign') => ({
    headers: new Headers({ authorization: 'Bearer user-token' }),
    json: async () => ({
      template_id: 'form-1', recipient_name: 'Ana', recipient_email: 'ANA@example.com',
      signature_type: signatureType, require_liveness: true, expiration_hours: 24,
      scheduled_at: scheduledAt, timezone: 'America/Chihuahua',
    }),
  });
  return { exports, request, inserted, rpcCalls };
}

test('scheduled launch saves the delivery time without sending or minting a token early', async () => {
  const oldResend = process.env.RESEND_API_KEY;
  const oldCron = process.env.CRON_SECRET;
  process.env.RESEND_API_KEY = 'resend-test';
  process.env.CRON_SECRET = 'cron-secret-long-enough';
  try {
    const current = scheduleFixture();
    const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const response = await current.exports.POST(current.request(scheduledAt));
    assert.equal(response.status, 201);
    assert.equal(current.inserted.length, 1);
    assert.equal(current.inserted[0].scheduled_at, scheduledAt);
    assert.equal(current.inserted[0].recipient_email, 'ana@example.com');
    assert.equal(current.inserted[0].expiration_hours, 24);
    assert.equal(current.rpcCalls[0][0], 'configure_form_dispatch');
    assert.equal(current.rpcCalls[0][1].p_url, 'https://docubox.example/api/internal/form-launch-dispatch');

    const otherSignature = await current.exports.POST(current.request(scheduledAt, 'efirma_sat'));
    assert.equal(otherSignature.status, 201);
    assert.equal(current.inserted[1].signature_type, 'efirma_sat');

    const invalid = await current.exports.POST(current.request(new Date(Date.now() - 60_000).toISOString()));
    assert.equal(invalid.status, 400);
    assert.equal(current.inserted.length, 2);
  } finally {
    if (oldResend === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = oldResend;
    if (oldCron === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = oldCron;
  }
});

test('dispatch requires a fresh signed cron request before claiming sends', async () => {
  let claims = 0;
  const secret = 'cron-secret-long-enough';
  const service = { rpc: async (name) => {
    if (name === 'get_form_dispatch_secret') return { data: secret, error: null };
    claims++;
    return { data: [], error: null };
  } };
  const exports = {};
  new Function('require', 'exports', 'process', 'Buffer', dispatchSource)((name) => {
    if (name === 'node:crypto') return { createHmac, timingSafeEqual: (a, b) => a.equals(b) };
    if (name === 'next/server') return nextServer;
    if (name === '@/lib/supabase/server') return { createServiceClient: () => service };
    if (name === '@/lib/publicAppUrl') return { getPublicAppUrl: () => 'https://docubox.example' };
    if (name.endsWith('form-email-template')) return { buildFormEmail: () => '' };
    throw new Error(`Unexpected import: ${name}`);
  }, exports, process, Buffer);
  const unauthenticated = await exports.POST({ headers: new Headers() });
  assert.equal(unauthenticated.status, 404);
  assert.equal(claims, 0);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', secret).update(timestamp).digest('hex');
  const authenticated = await exports.POST({ headers: new Headers({ 'x-docubox-cron-timestamp': timestamp, 'x-docubox-cron-signature': signature }) });
  assert.equal(authenticated.status, 200);
  assert.equal(claims, 1);
});

test('due dispatch creates a private token and sends one invitation with expiry from delivery', async () => {
  const previous = Object.fromEntries(['CRON_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY'].map((key) => [key, process.env[key]]));
  Object.assign(process.env, { CRON_SECRET: 'cron-secret-long-enough', SUPABASE_SERVICE_ROLE_KEY: 'service-key', RESEND_API_KEY: 'resend-key' });
  const updates = [];
  const tokens = [];
  const emails = [];
  const schedule = {
    id: 'schedule-1', template_id: 'form-1', workspace_id: 'workspace-1', requested_by: 'user-1',
    requester_name: 'Solicitante', recipient_name: 'Ana', recipient_email: 'ana@example.com',
    signature_type: 'click_sign', require_liveness: true, expiration_hours: 2,
    delivery_expires_at: null, token_id: null, attempt_count: 1,
  };
  const service = {
    rpc: async () => ({ data: [schedule], error: null }),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'owner@example.com' } }, error: null }) } },
    from(table) {
      if (table === 'form_templates') {
        const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: {
          id: 'form-1', name: 'Solicitud', status: 'published', workspace_id: 'workspace-1',
          settings: { accessMode: 'private', configureLinkExpiration: true }, workspaces: { name: 'Mi espacio' },
        }, error: null }) };
        return query;
      }
      if (table === 'form_tokens') {
        const query = { upsert(row) { tokens.push(row); return query; }, select: () => query, single: async () => ({ data: { id: 'token-1' }, error: null }) };
        return query;
      }
      assert.equal(table, 'form_send_schedules');
      const query = {
        update(value) { updates.push(value); return query; }, eq: () => query,
        then(resolve) { resolve({ error: null }); },
      };
      return query;
    },
  };
  const exports = {};
  new Function('require', 'exports', 'process', 'Buffer', 'fetch', dispatchSource)((name) => {
    if (name === 'node:crypto') return { createHmac, timingSafeEqual: (a, b) => a.equals(b) };
    if (name === 'next/server') return nextServer;
    if (name === '@/lib/supabase/server') return { createServiceClient: () => service };
    if (name === '@/lib/publicAppUrl') return { getPublicAppUrl: () => 'https://docubox.example' };
    if (name.endsWith('form-email-template')) return { buildFormEmail: ({ requesterName, expiresAt }) => `${requesterName}:${expiresAt}` };
    throw new Error(`Unexpected import: ${name}`);
  }, exports, process, Buffer, async (_url, options) => { emails.push(options); return { ok: true }; });
  try {
    const response = await exports.POST({ headers: new Headers({ authorization: 'Bearer cron-secret-long-enough' }) });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { claimed: 1, sent: 1, failed: 0 });
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].recipient_email, 'ana@example.com');
    assert.equal(tokens[0].launched_by_user_id, 'user-1');
    assert.ok(new Date(tokens[0].expires_at).getTime() > Date.now() + 110 * 60_000);
    assert.equal(emails.length, 1);
    assert.equal(emails[0].headers['Idempotency-Key'], 'form-schedule-schedule-1');
    assert.match(JSON.parse(emails[0].body).html, /Solicitante/);
    assert.equal(updates.at(-1).status, 'sent');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
