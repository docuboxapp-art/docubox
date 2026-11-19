import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url),
  key = '__colaboraFormSubmitQA';
const original = { Deno: globalThis.Deno, fetch: globalThis.fetch, error: console.error };
globalThis.Deno = {
  env: {
    get(name) {
      return {
        SUPABASE_URL: 'https://synthetic.invalid',
        SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
      }[name];
    },
  },
};
const buildOptions = {
  entryPoints: ['supabase/functions/form-submit/index.ts'],
  outfile: '.tmp/colabora-form-submit-edge.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  plugins: [
    {
      name: 'edge-qa',
      setup(b) {
        b.onResolve({ filter: /^https:\/\/deno\.land\/std@.*\/http\/server\.ts$/ }, () => ({
          path: 'serve',
          namespace: 'qa',
        }));
        b.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js@/ }, () => ({
          path: 'supabase',
          namespace: 'qa',
        }));
        b.onLoad({ filter: /.*/, namespace: 'qa' }, (args) => ({
          loader: 'js',
          contents:
            args.path === 'serve'
              ? `export const serve=handler=>globalThis.${key}Handler=handler;`
              : `export const createClient=()=>globalThis.${key}.client;`,
        }));
      },
    },
  ],
};
await build(buildOptions);
require('../.tmp/colabora-form-submit-edge.cjs');
const handler = globalThis[key + 'Handler'];
await build({
  ...buildOptions,
  entryPoints: ['supabase/functions/get-form-schema/index.ts'],
  outfile: '.tmp/colabora-form-schema-edge.cjs',
});
require('../.tmp/colabora-form-schema-edge.cjs');
const schemaHandler = globalThis[key + 'Handler'];
globalThis.fetch = async () => {
  globalThis[key].pdfCalls++;
  return Response.json({ error: 'Synthetic generator unavailable' }, { status: 503 });
};
console.error = (...args) => globalThis[key]?.logs.push(args);
function setup() {
  const h = {
    inserts: [],
    updates: [],
    logs: [],
    pdfCalls: 0,
    insertError: null,
    preference: false,
  };
  h.user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'recipient@example.invalid',
    email_confirmed_at: '2026-01-01T00:00:00Z',
  };
  h.token = {
    id: '22222222-2222-4222-8222-222222222222',
    access_mode: 'private',
    recipient_email: h.user.email,
    recipient_user_id: null,
    attempts: 0,
    used_at: null,
    expires_at: '2099-01-01T00:00:00Z',
    form_templates: {
      id: '33333333-3333-4333-8333-333333333333',
      workspace_id: '44444444-4444-4444-8444-444444444444',
      status: 'published',
      name: 'Synthetic linked form',
      created_by: '55555555-5555-4555-8555-555555555555',
      settings: { requiresSignature: false },
      schema: [],
    },
  };
  h.client = {
    auth: {
      getUser: async (token) => ({
        data: { user: token === 'valid' ? h.user : null },
        error: null,
      }),
    },
    from(table) {
      let operation = 'select',
        values;
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        insert(v) {
          operation = 'insert';
          values = v;
          return q;
        },
        update(v) {
          operation = 'update';
          values = v;
          return q;
        },
        single: execute,
        maybeSingle: execute,
        then(resolve, reject) {
          return execute().then(resolve, reject);
        },
      };
      async function execute() {
        if (operation === 'insert') {
          h.inserts.push({ table, values });
          return table === 'form_responses'
            ? {
                data: { id: '66666666-6666-4666-8666-666666666666', ...values },
                error: h.insertError,
              }
            : { data: { id: '77777777-7777-4777-8777-777777777777' }, error: null };
        }
        if (operation === 'update') {
          h.updates.push({ table, values });
          return { data: null, error: null };
        }
        return {
          data:
            table === 'form_tokens'
              ? h.token
              : table === 'notification_preferences'
                ? { in_app_enabled: h.preference }
                : null,
          error: null,
        };
      }
      return q;
    },
  };
  globalThis[key] = h;
  return h;
}
const request = (headers = { Authorization: 'Bearer valid' }) =>
  new Request('https://synthetic.invalid/functions/v1/form-submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({
      token: 'synthetic-private-capability',
      response_data: { reference: 'Synthetic answer' },
    }),
  });
test.after(() => {
  globalThis.Deno = original.Deno;
  globalThis.fetch = original.fetch;
  console.error = original.error;
  delete globalThis[key];
  delete globalThis[key + 'Handler'];
});
test('a private submission records submitted status and the verified actor even when PDF generation fails', async () => {
  const h = setup(),
    response = await handler(request());
  assert.equal(response.status, 200);
  const payload = await response.json(),
    insert = h.inserts.find((x) => x.table === 'form_responses');
  assert.equal(insert.values.status, 'submitted');
  assert.equal(insert.values.respondent_user_id, h.user.id);
  assert.equal(insert.values.respondent_email, h.user.email);
  assert.equal(payload.signature_required, false);
  assert.equal(payload.redirect_to_sign, false);
  assert.ok(h.updates.some((x) => x.values.used_at));
  assert.equal(h.pdfCalls, 1);
});
test('omitting the optional signature choice keeps its existing required default', async () => {
  const h = setup();
  h.token.form_templates.settings = {};
  const response = await handler(request());
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.signature_required, true);
  assert.equal(payload.redirect_to_sign, true);
});
test('missing authentication and another recipient cannot submit a private linked form', async () => {
  let h = setup();
  assert.equal((await handler(request({}))).status, 401);
  assert.equal(h.inserts.length, 0);
  h = setup();
  h.user.email = 'other@example.invalid';
  assert.equal((await handler(request())).status, 403);
  assert.equal(h.inserts.length, 0);
});
test('public access retains the separate identity-verification requirement', async () => {
  const h = setup();
  h.token.access_mode = 'public';
  h.token.recipient_user_id = h.user.id;
  h.token.liveness_verified_at = null;
  const response = await handler(request({}));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'LIVENESS_REQUIRED');
  assert.equal(h.inserts.length, 0);
});
test('used and expired capabilities cannot create another response', async () => {
  let h = setup();
  h.token.used_at = new Date().toISOString();
  assert.equal((await handler(request())).status, 409);
  assert.equal(h.inserts.length, 0);
  h = setup();
  h.token.expires_at = '2000-01-01T00:00:00Z';
  assert.equal((await handler(request())).status, 410);
  assert.equal(h.inserts.length, 0);
});
test('duplicate responses retain conflict handling and error logs omit private database messages', async () => {
  let h = setup();
  h.insertError = { code: '23505', message: 'Synthetic private row contents' };
  assert.equal((await handler(request())).status, 409);
  assert.equal(h.pdfCalls, 0);
  assert.ok(!JSON.stringify(h.logs).includes('private row contents'));
  h = setup();
  h.insertError = { code: '23514', message: 'Synthetic private row contents' };
  assert.equal((await handler(request())).status, 500);
  assert.ok(!JSON.stringify(h.logs).includes('private row contents'));
});
test('the response notification follows preferences and does not disclose captured answers', async () => {
  const h = setup();
  h.preference = true;
  assert.equal((await handler(request())).status, 200);
  const notification = h.inserts.find((x) => x.table === 'notifications');
  assert.equal(notification.values.event_type, 'form.response.submitted');
  assert.ok(!JSON.stringify(notification.values).includes('Synthetic answer'));
  assert.equal(h.inserts.filter((x) => x.table === 'signature_requests').length, 0);
});

test('the deployed schema contract exposes the same optional signature choice used at submission', async () => {
  const h = setup();
  let response = await schemaHandler(
    new Request(
      'https://synthetic.invalid/functions/v1/get-form-schema?token=synthetic-private-capability',
      { headers: { Authorization: 'Bearer valid' } }
    )
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).settings.requiresSignature, false);
  h.token.form_templates.settings = {};
  response = await schemaHandler(
    new Request(
      'https://synthetic.invalid/functions/v1/get-form-schema?token=synthetic-private-capability',
      { headers: { Authorization: 'Bearer valid' } }
    )
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).settings.requiresSignature, true);
});

test('schema retrieval preserves private-recipient authentication before exposing form settings', async () => {
  const h = setup();
  let response = await schemaHandler(
    new Request(
      'https://synthetic.invalid/functions/v1/get-form-schema?token=synthetic-private-capability'
    )
  );
  assert.equal(response.status, 401);
  h.user.email = 'other@example.invalid';
  response = await schemaHandler(
    new Request(
      'https://synthetic.invalid/functions/v1/get-form-schema?token=synthetic-private-capability',
      { headers: { Authorization: 'Bearer valid' } }
    )
  );
  assert.equal(response.status, 403);
});
