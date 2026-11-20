import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const key = '__collaborationAccessRecoveryQA';
async function bundle(entry, name, stubs) {
  await build({
    entryPoints: [entry],
    outfile: `.tmp/${name}.cjs`,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    jsx: 'automatic',
    plugins: [
      {
        name: 'recovery-boundaries',
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) =>
            Object.hasOwn(stubs, a.path) ? { path: a.path, namespace: 'qa' } : undefined
          );
          b.onLoad({ filter: /.*/, namespace: 'qa' }, (a) => ({
            contents: stubs[a.path],
            loader: 'js',
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  return require(`../.tmp/${name}.cjs`);
}
// Exercise the actual async provider with a minimal hook-state driver. Network
// and session acquisition are simulated; this does not certify React scheduling.
const provider = await bundle('src/contexts/CollaborationContext.tsx', 'colabora-access-recovery', {
  react: `const h=()=>globalThis.${key};export const createContext=()=>({Provider:'provider'});export const useContext=()=>h().view;export const useMemo=f=>f();export const useCallback=f=>f;export const useEffect=f=>{h().effect=f};export function useState(initial){const s=h(),i=s.cursor++;if(!(i in s.slots))s.slots[i]=initial;return [s.slots[i],v=>{s.slots[i]=typeof v==='function'?v(s.slots[i]):v}]}export function useRef(initial){const s=h(),i=s.cursor++;if(!(i in s.slots))s.slots[i]={current:initial};return s.slots[i]}`,
  '@/contexts/WorkspaceContext': `export const useWorkspace=()=>globalThis.${key}.workspace;`,
  '@/lib/supabase/client': `export const createClient=()=>globalThis.${key}.client;`,
});
const shell = await bundle(
  'src/app/colabora/_components/ColaboraShell.tsx',
  'colabora-access-shell-recovery',
  {
    'next/link': `import React from 'react';export default function Link(p){return React.createElement('a',p)}`,
    'next/navigation': `export const usePathname=()=>'/colabora';export const useRouter=()=>({push(){}});`,
    '@/components/AppLayout': `import React from 'react';export default function Layout(p){return React.createElement('div',null,p.children)}`,
    '@/contexts/WorkspaceContext': `export const useWorkspace=()=>({...globalThis.${key}.workspace,refreshWorkspaces:async()=>{}});`,
    '@/contexts/CollaborationContext': `export const CollaborationProvider=p=>p.children;export const useCollaboration=()=>globalThis.${key}.view;`,
    '@/lib/collaboration/client': `export const useCollaborationApi=()=>async()=>{throw Error('No product activation permitted in this test')};`,
  }
);
const realFetch = globalThis.fetch;
const access = {
  eligible: true,
  accessible: true,
  writeAllowed: false,
  code: 'READ_ONLY',
  membershipRole: 'owner',
  commercialTier: 'standard',
  subscriptionStatus: 'expired',
  entitlements: {},
  permissions: [],
};
function setup() {
  const h = {
    slots: [],
    cursor: 0,
    calls: [],
    workspace: {
      activeWorkspace: { id: 'org-a', workspaceType: 'business', name: 'QA' },
      loading: false,
    },
    client: {
      auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic' } } }) },
    },
  };
  globalThis[key] = h;
  h.render = () => {
    h.cursor = 0;
    h.view = provider.CollaborationProvider({ children: null }).props.value;
    return h.view;
  };
  h.response = () => Response.json({ access, settings: null });
  globalThis.fetch = async (url, init) => {
    h.calls.push({ url, init });
    return h.response(url);
  };
  h.render();
  return h;
}
test.after(() => {
  globalThis.fetch = realFetch;
  delete globalThis[key];
});

test('a 503 closes access and renders recovery instead of an unavailable-product offer', async () => {
  const h = setup();
  h.response = () => Response.json({ error: 'private provider message' }, { status: 503 });
  await h.view.refresh();
  h.render();
  assert.equal(h.view.loading, false);
  assert.equal(h.view.can('tasks.create', true), false);
  assert.equal(h.view.access.accessible, false);
  assert.ok(h.view.error);
  const html = renderToStaticMarkup(React.createElement(shell.default, null, 'Protected content'));
  assert.match(html, /Acceso temporalmente no disponible|Reintentar/);
  assert.doesNotMatch(
    html,
    /Iniciar prueba|Complemento no disponible|Protected content|private provider message/
  );
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].init.cache, 'no-store');
  assert.ok(h.calls[0].init.signal instanceof AbortSignal);
});

test('retry restores actual read-only access without granting writes or starting a trial', async () => {
  const h = setup();
  h.response = () => {
    throw new TypeError('network');
  };
  await h.view.refresh();
  h.render();
  assert.ok(h.view.error);
  h.response = () => Response.json({ access, settings: { timezone: 'America/Mazatlan' } });
  await h.view.refresh();
  h.render();
  assert.equal(h.view.error, '');
  assert.equal(h.view.access.code, 'READ_ONLY');
  assert.equal(h.view.can('tasks.view'), true);
  assert.equal(h.view.can('tasks.create', true), false);
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls.every((c) => c.init.method === undefined));
});

test('workspace loading remains loading and personal workspaces do not request organization access', async () => {
  const h = setup();
  h.workspace.loading = true;
  h.render();
  await h.view.refresh();
  h.render();
  assert.equal(h.view.loading, true);
  assert.equal(h.view.error, '');
  assert.equal(h.calls.length, 0);
  h.workspace = { activeWorkspace: { id: 'personal', workspaceType: 'personal' }, loading: false };
  h.render();
  await h.view.refresh();
  h.render();
  assert.equal(h.view.access.code, 'ORGANIZATION_REQUIRED');
  assert.equal(h.view.loading, false);
  assert.equal(h.calls.length, 0);
});

test('late access from another organization cannot replace a newer denial', async () => {
  const h = setup();
  let deliver;
  h.response = () =>
    new Promise((resolve) => {
      deliver = resolve;
    });
  const previous = h.view.refresh();
  await Promise.resolve();
  h.workspace = { activeWorkspace: { id: 'org-b', workspaceType: 'business' }, loading: false };
  h.render();
  h.response = () => Response.json({ error: 'denied' }, { status: 403 });
  await h.view.refresh();
  h.render();
  deliver(
    Response.json({
      access: { ...access, writeAllowed: true },
      settings: { confidential: 'org-a' },
    })
  );
  await previous;
  h.render();
  assert.equal(h.view.access.accessible, false);
  assert.equal(h.view.settings, null);
  assert.ok(h.view.error);
});

test('missing sessions and malformed successful responses stay closed', async () => {
  const h = setup();
  h.client.auth.getSession = async () => ({ data: { session: null } });
  await h.view.refresh();
  h.render();
  assert.equal(h.calls.length, 0);
  assert.ok(h.view.error);
  h.client.auth.getSession = async () => ({ data: { session: { access_token: 'synthetic' } } });
  h.response = () => Response.json({ success: true });
  await h.view.refresh();
  h.render();
  assert.equal(h.view.access.accessible, false);
  assert.ok(h.view.error);
});

test('provider cleanup ignores a response arriving after unmount', async () => {
  const h = setup();
  let deliver;
  h.response = () =>
    new Promise((resolve) => {
      deliver = resolve;
    });
  const cleanup = h.effect();
  await new Promise((resolve) => setImmediate(resolve));
  cleanup();
  const before = JSON.stringify(h.slots);
  deliver(Response.json({ access, settings: null }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(JSON.stringify(h.slots), before);
});
