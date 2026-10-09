import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { buildFormEmail } from '../supabase/functions/_shared/form-email-template.ts';

const source = readFileSync('supabase/functions/generate-form-token/index.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(recipientEmail) {
  let handler;
  let storedToken;
  let sentEmail;
  const template = {
    id: 'form-1', name: 'Formulario de prueba', status: 'published',
    settings: { accessMode: 'private', configureLinkExpiration: false },
    form_schema: { fields: [] }, workspaces: { name: 'Espacio Personal' },
  };
  const userClient = {
    auth: { getUser: async () => ({ data: { user: {
      id: 'launcher-1', email: 'luis@example.com', user_metadata: { full_name: 'Otro nombre' },
    } }, error: null }) },
    from(table) {
      assert.equal(table, 'form_templates');
      const query = { select: () => query, eq: () => query, single: async () => ({ data: template, error: null }) };
      return query;
    },
  };
  const service = {
    from(table) {
      if (table === 'user_profiles') {
        const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { full_name: 'Luis Lanzador' }, error: null }) };
        return query;
      }
      assert.equal(table, 'form_tokens');
      const query = {
        insert: (row) => { storedToken = row; return query; },
        select: () => query,
        single: async () => ({ data: { id: 'token-1' }, error: null }),
        delete: () => query,
        eq: () => query,
      };
      return query;
    },
  };
  const exports = {};
  new Function('require', 'exports', 'fetch', 'Deno', 'crypto', compiled)(
    (name) => {
      if (name.includes('/http/server.ts')) return { serve: (callback) => { handler = callback; } };
      if (name.includes('supabase-js')) return { createClient: (_url, key) => key === 'service-key' ? service : userClient };
      if (name === '../_shared/form-signature-policy.ts') return { requiresFormSignature: () => true };
      if (name === '../_shared/client-ip.ts') return { getClientIp: () => '127.0.0.1' };
      if (name === '../_shared/form-email-template.ts') return { buildFormEmail };
      throw new Error(`Unexpected import: ${name}`);
    },
    exports,
    async (_url, options) => { sentEmail = JSON.parse(options.body); return { ok: true }; },
    { env: { get: (name) => ({
      SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      SUPABASE_ANON_KEY: 'anon-key', RESEND_API_KEY: 'resend-test-key',
      NEXT_PUBLIC_SITE_URL: 'https://example.docubox.mx',
    })[name] } },
    globalThis.crypto,
  );
  return {
    send: () => handler(new Request('https://example.supabase.co/functions/v1/generate-form-token', {
      method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: 'form-1', recipient_email: recipientEmail, recipient_name: 'Participante',
        signature_type: 'click_sign', notification_method: 'email',
      }),
    })),
    token: () => storedToken,
    email: () => sentEmail,
  };
}

test('the first invitation identifies the actual launcher and does not invent an expiry', async () => {
  const current = fixture('ana@example.com');
  const response = await current.send();
  assert.equal(response.status, 200, await response.text());
  assert.equal(current.token().launched_by_user_id, 'launcher-1');
  assert.equal(current.token().launcher_name, 'Luis Lanzador');
  assert.equal(current.token().sent_to_self, false);
  assert.equal(current.token().expires_at, null);
  assert.match(current.email().html, /Solicitado por/);
  assert.match(current.email().html, /Luis Lanzador/);
  assert.match(current.email().html, /Sin fecha límite/);
  assert.doesNotMatch(current.email().html, /Solicitado por<\/td>.*Espacio Personal/);
});

test('the first invitation explains when the launcher sent the form to their own account', async () => {
  const current = fixture(' LUIS@example.com ');
  const response = await current.send();
  assert.equal(response.status, 200, await response.text());
  assert.equal(current.token().sent_to_self, true);
  assert.equal(current.token().recipient_email, 'luis@example.com');
  assert.match(current.email().html, /Luis Lanzador \(tú\)/);
  assert.match(current.email().html, /tu propia cuenta/);
  assert.match(current.email().subject, /Tienes un formulario por completar/);
});
