// Isolated HTTP-cookie -> server page -> actual participant UI integration.
// The provider/database boundary is simulated here; real RPC guards are tested
// separately in rollback-only SQL. No live invitation or biometric is modified.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { NextRequest } from 'next/server.js';
import { renderToStaticMarkup } from 'react-dom/server';

const runtime = `export class CaseRuntimeError extends Error {
 constructor(code,message,status=409){super(message);this.code=code;this.status=status;}
} export const record=x=>x&&typeof x==='object'?x:{};
export const runtimeHeaders={'Cache-Control':'private, no-store'};
export const runtimeFailure=e=>({status:e.status||503,body:{code:e.code,error:e.message}});`;
const stubs = {
  'server-only': 'export {};',
  'next/headers': 'export const cookies=async()=>globalThis.__casePostIdentity.jar;',
  'next/server': "export {NextRequest,NextResponse} from 'next/server.js';",
  'next/navigation': "export function notFound(){throw Error('NOT_FOUND');}",
  '@supabase/ssr': 'export const createServerClient=()=>globalThis.__casePostIdentity.service;',
  '@/lib/supabase/server':
    'export const createServiceClient=()=>globalThis.__casePostIdentity.service;export const createAnonClient=createServiceClient;',
  '@/lib/supabase/client': 'export const createClient=()=>({});',
  './runtime.server': runtime,
  '@/lib/case-files/runtime.server': runtime,
  '@/lib/security/server-rate-limit': 'export const consumeServerRateLimit=async()=>true;',
  '@/lib/identity/capture-crypto': 'export const captureEncryptionKey=()=>null;',
  '@/lib/identity/stored-identity': 'export const findStoredIdentity=async()=>null;',
  '@/components/ui/AppLogo':
    "import {createElement} from 'react';export default()=>createElement('span',null,'Docubox');",
  './CaseEntryGate':
    "import {createElement} from 'react';export default()=>createElement('div',{'data-case-gate':'true'},'Verificar identidad del expediente');",
};
await build({
  stdin: {
    contents: `export {POST} from './src/app/api/public/case-entry/route';
    export {default as Page} from './src/app/expediente/[token]/page';
    export {getCaseEntryState,caseEntryCookie,caseEntryAccessCookie,signCaseEntryCode} from './src/lib/case-files/entry.server';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  jsx: 'automatic',
  outfile: '.tmp/case-post-identity-unit.cjs',
  plugins: [
    {
      name: 'isolated-boundaries',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) =>
          Object.hasOwn(stubs, args.path)
            ? { path: args.path, namespace: 'test-boundary' }
            : undefined
        );
        b.onLoad({ filter: /.*/, namespace: 'test-boundary' }, (args) => ({
          contents: stubs[args.path],
          loader: 'js',
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
const api = createRequire(import.meta.url)('../.tmp/case-post-identity-unit.cjs');
const token = 'a'.repeat(64),
  codeHash = 'b'.repeat(64),
  capture = 'c'.repeat(64);
const hash = createHash('sha256').update(token).digest('hex');
const captureHash = createHash('sha256').update(capture).digest('hex');
const oldSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'isolated-test-only-secret-with-enough-entropy';
test.after(() => {
  if (oldSecret === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = oldSecret;
  delete globalThis.__casePostIdentity;
});
function setup(providerApproved = true) {
  const values = new Map(),
    expiry = new Date(Date.now() + 3600000).toISOString();
  const user = {
    id: 'test-actor',
    email: 'participant@example.invalid',
    email_confirmed_at: expiry,
    is_anonymous: false,
  };
  const ctx = {
    case: { id: 'test-case' },
    invitation: { id: 'test-invitation', recipient: user.email, expires_at: expiry },
  };
  const portal = {
    title: 'Expediente de prueba',
    folio: 'QA-001',
    status: 'integrating',
    progress: 0,
    sender: 'Responsable QA',
    participantName: 'Participante QA',
    role: 'subject',
    expiresAt: expiry,
    requirements: [
      {
        id: 'test-requirement',
        title: 'Documento solicitado',
        required: true,
        status: 'pending',
        canSubmit: true,
      },
    ],
    forms: [
      {
        id: 'test-form',
        title: 'Formulario vinculado',
        required: true,
        status: 'pending',
        canSubmit: true,
      },
    ],
  };
  const h = {
    providerApproved,
    authorized: false,
    calls: [],
    portal,
    jar: {
      get: (name) => (values.has(name) ? { name, value: values.get(name) } : undefined),
      getAll: () => [...values].map(([name, value]) => ({ name, value })),
      set: (name, value) => values.set(name, value),
    },
  };
  h.service = {
    from(table) {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          error: null,
          data:
            table === 'case_launches'
              ? { access_mode: 'public', require_liveness: true }
              : { id: user.id },
        }),
      };
      return q;
    },
    auth: { admin: { getUserById: async () => ({ data: { user }, error: null }) } },
    async rpc(name, args) {
      h.calls.push({ name, args });
      if (name === 'case_portal_context') return { data: ctx, error: null };
      if (name === 'case_portal_authorize_actor') {
        if (args.p_capture_hash === captureHash && h.providerApproved) h.authorized = true;
        return {
          data: h.authorized ? { authorized: true } : { authorized: false, reason: 'liveness' },
          error: null,
        };
      }
      if (name === 'case_invitation_portal') return { data: portal, error: null };
      throw Error('Unexpected RPC ' + name);
    },
  };
  h.jar.set(api.caseEntryCookie(hash), api.signCaseEntryCode(hash, codeHash, Date.now() + 1800000));
  globalThis.__casePostIdentity = h;
  return h;
}
const request = () =>
  new NextRequest('https://example.test/api/public/case-entry', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-case-invitation': token,
      origin: 'https://example.test',
    },
    body: JSON.stringify({ action: 'complete', mobileSessionToken: capture }),
  });
const pageHtml = async () =>
  renderToStaticMarkup(await api.Page({ params: Promise.resolve({ token }) }));

test('approved scoped identity writes the browser grant and the next server render opens the case portal', async () => {
  const h = setup();
  const response = await api.POST(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.ready, true);
  const grant = response.cookies.get(api.caseEntryAccessCookie(hash));
  assert.ok(grant);
  assert.equal(grant.httpOnly, true);
  assert.equal(grant.secure, true);
  assert.equal(grant.sameSite, 'lax');
  h.jar.set(grant.name, grant.value);
  const html = await pageHtml();
  assert.match(html, /Tu participación en el expediente/);
  assert.match(html, /Entregar al expediente/);
  assert.match(html, /Responder formulario vinculado/);
  assert.match(html, /Avance del expediente/);
  assert.doesNotMatch(html, /data-case-gate|\/formulario-publico\//);
  assert.ok(
    h.calls.some(
      (c) => c.name === 'case_portal_authorize_actor' && c.args.p_capture_hash === captureHash
    )
  );
});
test('an unapproved capture cannot set a browser grant or render delivery controls', async () => {
  setup(false);
  const response = await api.POST(request());
  assert.equal((await response.json()).data.ready, false);
  assert.equal(response.cookies.get(api.caseEntryAccessCookie(hash)), undefined);
  const html = await pageHtml();
  assert.match(html, /data-case-gate="true"/);
  assert.doesNotMatch(html, /Entregar al expediente|Responder formulario vinculado/);
});
test('an approval from another browser does not replace the matching browser cookie', async () => {
  const h = setup();
  h.authorized = true;
  assert.equal((await api.getCaseEntryState(hash)).ready, false);
  assert.match(await pageHtml(), /data-case-gate="true"/);
});
