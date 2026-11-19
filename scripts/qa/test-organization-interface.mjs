// Isolated browser QA of the real organization components. No production requests,
// real users, emails or credentials. API/database behavior is tested separately.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

const require = createRequire(import.meta.url);
const { chromium } = require('../../.tmp/organization-browser-qa/node_modules/playwright-core');
const output = '.tmp/organization-interface';
await mkdir(output, { recursive: true });
const ws = '11111111-1111-4111-8111-111111111111';
const owner = '22222222-2222-4222-8222-222222222222';
const target = '33333333-3333-4333-8333-333333333333';
const parent = '44444444-4444-4444-8444-444444444444';
const team = '55555555-5555-4555-8555-555555555555';
const permission = '66666666-6666-4666-8666-666666666666';
const role = '77777777-7777-4777-8777-777777777777';
const units = [
  {
    id: parent,
    name: 'Operaciones · Ejemplo',
    unit_type: 'area',
    status: 'active',
    leader_member_id: owner,
  },
  {
    id: team,
    name: 'Legal · Ejemplo',
    unit_type: 'team',
    status: 'active',
    parent_id: parent,
    leader_member_id: owner,
  },
];
const memberRows = [owner, target].map((id, index) => ({
  id,
  role: index ? 'member' : 'owner',
  status: 'active',
  joined_at: '2026-11-17T12:00:00Z',
  user_profiles: {
    full_name: index ? 'Persona de ejemplo' : 'Responsable de ejemplo',
    email: `example${index}@example.invalid`,
  },
}));
let memberships = units.map((unit) => ({ unit_id: unit.id, member_id: owner, is_lead: true }));
let roles = [
  {
    id: role,
    name: 'Consulta · Ejemplo',
    status: 'active',
    scope_type: 'organization',
    is_system: false,
    organization_role_permissions: [{ permission_id: permission }],
  },
];
let selectedRoles = [];
const calls = [];
const permissions = [
  {
    id: permission,
    name: 'Consultar equipos',
    permission_key: 'teams.read',
    category: 'Equipos',
    description: 'Acceso de consulta a los equipos.',
  },
];

await build({
  entryPoints: ['src/lib/organization/catalog.ts'],
  outfile: output + '/catalog.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
});
const { organizationCatalogs } = require('../../' + output + '/catalog.cjs');
const catalogRows = {
  directory: [
    {
      id: target,
      workspace_id: ws,
      full_name: 'Directorio de ejemplo',
      email: 'directory@example.invalid',
      person_type: 'individual',
      relationship_type: 'collaborator',
      status: 'active',
      identity_status: 'not_started',
    },
  ],
  centers: [
    {
      id: parent,
      workspace_id: ws,
      name: 'Centro de ejemplo',
      code: 'EJ-OP',
      currency: 'MXN',
      budget: 1000,
      alert_threshold_percent: 80,
      status: 'active',
    },
  ],
  templates: [
    {
      id: team,
      workspace_id: ws,
      name: 'Invitación de ejemplo',
      template_key: 'organization.invitation',
      subject: 'Invitación de ejemplo',
      body_text: 'Hola {{recipient_name}}',
      legal_version: 1,
      status: 'draft',
    },
  ],
  certificates: [
    {
      id: team,
      workspace_id: ws,
      alias: 'Certificado de ejemplo',
      subject_name: 'Entidad de ejemplo',
      certificate_type: 'institutional',
      status: 'pending',
      custody_type: 'metadata_only',
      environment: 'sandbox',
    },
  ],
  certificate_access: [
    {
      id: parent,
      workspace_id: ws,
      certificate_id: team,
      member_id: owner,
      document_types: ['contract'],
    },
  ],
  networks: [],
  alerts: [],
  policies: [],
  resources: [],
  authorities: [],
  integrations: [],
  domains: [],
};
permissions.push({
  id: '88888888-8888-4888-8888-888888888888',
  name: 'Editar tareas',
  permission_key: 'tasks.edit',
  category: 'Colabora',
  description: 'Editar trabajo autorizado.',
});
const retentionPolicies = [];
let delegationPolicy = { mode: 'DISABLED', allowed_member_ids: [], allowed_roles: [] };
const directoryEvidenceRows = [],
  uploadRequests = [];
let preparedEvidence;
const stubs = {
  'next/link': `import React from 'react';export default function Link({prefetch,...props}){return React.createElement('a',props);}`,
  'next/navigation': `const search=new URLSearchParams(location.search);export const usePathname=()=>location.pathname;export const useSearchParams=()=>search;export const useParams=()=>({section:location.pathname.split('/')[2]});export const useRouter=()=>({push:path=>location.assign(path),refresh:()=>location.reload()});`,
  '@/components/AppLayout': `import React from 'react';export default function Layout({children}){return React.createElement('div',{className:'px-4 py-4 md:py-6 w-full min-w-0'},children);}`,
  '@/contexts/AuthContext': `const value={session:{access_token:'synthetic'},user:{id:'${owner}'}};export const useAuth=()=>value;`,
  '@/contexts/WorkspaceContext': `const ws={id:'${ws}',name:'Organización de ejemplo',workspaceType:'business',role:new URLSearchParams(location.search).has('readonly')?'member':'owner'};export const useWorkspace=()=>({activeWorkspace:ws,loading:false,refreshWorkspaces:async()=>{}});`,
  '@/lib/supabase/client': `const client={storage:{from(){return {uploadToSignedUrl:async(path,token,file)=>{window.__organizationUploadSize=file.size;return {error:null}}}}},rpc(fn){const execute=()=>fetch('/api/qa/rpc?fn='+fn).then(r=>r.json());const q={abortSignal(){return q},then(resolve,reject){return execute().then(resolve,reject)}};return q},from(table){let signal;const execute=()=>fetch('/api/qa/dashboard?table='+table+'&fail='+(location.search.includes('summary_error')?'1':'0'),{signal}).then(r=>r.json());const q={insert(){return q},select(){return q},eq(){return q},in(){return q},gt(){return q},gte(){return q},lte(){return q},is(){return q},or(){return q},order(){return q},range(){return q},limit(){return q},abortSignal(value){signal=value;return q},single:execute,maybeSingle:execute,then(resolve,reject){return execute().then(resolve,reject)}};return q}};export const createClient=()=>client;`,
};
await build({
  stdin: {
    contents: `
  import React from 'react';import {createRoot} from 'react-dom/client';
  import Shell from './src/app/organizacion/_components/OrganizationShell';
  import Structure from './src/app/organizacion/_components/OrganizationStructureAdministration';
  import Member from './src/app/organizacion/_components/OrganizationMemberDetail';
  import DirectoryPerson from './src/app/organizacion/_components/OrganizationDirectoryPerson';
  import Sections from './src/app/organizacion/_components/OrganizationSections';
  import Dashboard from './src/app/organizacion/page';
  import SectionPage from './src/app/organizacion/[section]/page';
  const path=location.pathname;
  createRoot(document.getElementById('root')).render(<Shell>{path==='/organizacion'?<Dashboard/>:path.includes('/directorio/')?<DirectoryPerson personId="${target}"/>:path.includes('/miembros/')?<Member memberId="${target}"/>:path.endsWith('/miembros')?<Sections section="miembros"/>:<SectionPage/>}</Shell>);
`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  outfile: `${output}/app.js`,
  bundle: true,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  plugins: [
    {
      name: 'isolated-contexts',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (a) =>
          Object.hasOwn(stubs, a.path) ? { path: a.path, namespace: 'fixture' } : undefined
        );
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (a) => ({
          contents: stubs[a.path],
          loader: 'js',
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
const css = await postcss([tailwindcss]).process(
  await readFile('src/styles/tailwind.css', 'utf8'),
  { from: 'src/styles/tailwind.css' }
);
await writeFile(
  `${output}/app.css`,
  css.css + '\n' + (await readFile('src/styles/organization.css', 'utf8'))
);
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const send = (data) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(data));
    };
    if (url.pathname === '/app.js' || url.pathname === '/app.css') {
      response.setHeader(
        'content-type',
        url.pathname.endsWith('css') ? 'text/css' : 'text/javascript'
      );
      response.end(await readFile(output + url.pathname));
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/qa/rpc') {
        const fn = url.searchParams.get('fn');
        send({
          data:
            fn === 'get_organization_directory_person'
              ? [catalogRows.directory[0]]
              : fn === 'get_my_organization_permissions'
                ? [
                    { permission_key: 'organization.read' },
                    { permission_key: 'teams.read' },
                    { permission_key: 'roles.read' },
                    { permission_key: 'members.read' },
                  ]
                : fn === 'get_organization_crypto_overview'
                  ? {}
                  : [],
          error: null,
        });
        return;
      }
      if (url.pathname === '/api/qa/dashboard') {
        const table = url.searchParams.get('table');
        const counts = {
          workspace_members: memberRows.length,
          organization_units: units.length,
          organization_invitations: 1,
          organization_roles: roles.length,
        };
        if (url.searchParams.get('fail') === '1' && table === 'organization_units') {
          send({ data: null, count: null, error: { message: 'Synthetic source unavailable' } });
          return;
        }
        const data =
          table === 'organization_directory_evidence'
            ? directoryEvidenceRows
            : table === 'workspaces'
              ? {
                  id: ws,
                  name: 'Organización de ejemplo',
                  security_settings: {},
                  branding_settings: {},
                  organization_settings: {},
                  fiscal_address: {},
                  legal_representative: {},
                  legal_name: 'Organización de ejemplo, S.A. de C.V.',
                  rfc: 'XAXX010101000',
                  contact_email: 'organizacion@example.invalid',
                  kyb_status: 'pending',
                  verification_status: 'not_started',
                }
              : table === 'organization_audit_events'
                ? [
                    {
                      id: 'event-1',
                      summary: 'Se actualizó el equipo Legal',
                      event_type: 'organization.unit.saved',
                      occurred_at: '2026-11-17T19:00:00Z',
                    },
                    {
                      id: 'event-2',
                      summary: 'Se configuraron los permisos de consulta',
                      event_type: 'organization.role.saved',
                      occurred_at: '2026-11-17T18:00:00Z',
                    },
                  ]
                : table === 'workspace_members'
                  ? memberRows
                  : catalogRows[
                      Object.keys(organizationCatalogs).find(
                        (key) => organizationCatalogs[key].table === table
                      )
                    ] || [];
        send({ data, count: counts[table] ?? null, error: null });
        return;
      }
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      if (url.pathname === '/api/organizacion/retention-policies') {
        if (request.method === 'POST') {
          const row = { ...body, id: crypto.randomUUID(), version: 1, status: 'active' };
          retentionPolicies.push(row);
          send({ success: true, data: row });
        } else send({ success: true, enabled: true, data: retentionPolicies });
        return;
      }
      if (url.pathname === '/api/organizacion/delegation-policy') {
        if (request.method === 'PATCH') delegationPolicy = body;
        send({ success: true, data: delegationPolicy });
        return;
      }
      if (url.pathname === '/api/organizacion/directory-evidence/upload') {
        uploadRequests.push({ method: request.method, bytes: Buffer.byteLength(raw) });
        if (request.method === 'POST') {
          preparedEvidence = { ...body, id: crypto.randomUUID(), status: 'pending' };
          send({
            ticket: 'synthetic-ticket',
            bucket: 'organization-evidence',
            path: 'synthetic.pdf',
            token: 'synthetic-storage-capability',
          });
        } else {
          directoryEvidenceRows.push(preparedEvidence);
          send({ success: true, id: preparedEvidence.id });
        }
        return;
      }

      if (request.method === 'POST') calls.push({ path: url.pathname, body });
      if (url.pathname.endsWith('/catalog')) {
        const resource = url.searchParams.get('resource') || body.resource;
        const config = organizationCatalogs[resource];
        if (request.method === 'POST') {
          const rows = (catalogRows[resource] ||= []);
          const record = rows.find((row) => row.id === body.id);
          if (body.action === 'remove') rows.splice(rows.indexOf(record), 1);
          else if (record) Object.assign(record, body.values || { status: body.status });
          else rows.push({ id: crypto.randomUUID(), workspace_id: ws, ...body.values });
          send({ success: true, id: body.id });
          return;
        }
        send({
          success: true,
          data: (catalogRows[resource] || []).filter(
            (row) => !url.searchParams.get('id') || row.id === url.searchParams.get('id')
          ),
          title: config.title,
          fields: config.fields,
          statuses: config.statuses || [],
          sensitive: config.sensitive,
          versioned: config.versioned,
          canManage: true,
          canCreate: config.create,
          options: {
            members: memberRows.map((row) => ({
              value: row.id,
              label: row.user_profiles.full_name,
            })),
            certificates: [{ value: team, label: 'Certificado de ejemplo' }],
            units: units.map((row) => ({ value: row.id, label: row.name })),
          },
        });
        return;
      }
      if (
        [
          '/profile',
          '/api-keys',
          '/webhooks',
          '/workflows',
          '/governance-defaults',
          '/custody-transfers',
          '/continuity',
          '/billing',
        ].some((path) => url.pathname === '/api/organizacion' + path)
      ) {
        send({
          success: true,
          data: url.pathname.endsWith('/continuity') ? { jobs: [], transfers: [] } : [],
          evidence: [],
          history: [],
          defaults: { workflow_id: null, signature_policy_id: null },
          builder_enabled: true,
          builder_capabilities: {
            notification_channels: ['in_app', 'email'],
            action_types: ['activity'],
            webhooks: [],
          },
        });
        return;
      }
      if (url.pathname.endsWith('/reauthenticate')) {
        send({
          success: true,
          token: 'synthetic-confirmation',
          expires_at: '2099-01-01T00:00:00Z',
        });
        return;
      }
      if (url.pathname.endsWith('/structure')) {
        if (request.method === 'POST') {
          if (body.action === 'save_unit') {
            const id = body.unit.id || crypto.randomUUID();
            const next = { ...body.unit, id, status: 'active' };
            const index = units.findIndex((u) => u.id === id);
            if (index < 0) units.push(next);
            else units[index] = next;
            const members = [
              ...new Set(
                [...body.member_ids, next.leader_member_id, next.deputy_member_id].filter(Boolean)
              ),
            ];
            memberships = memberships
              .filter((m) => m.unit_id !== id)
              .concat(
                members.map((member) => ({
                  unit_id: id,
                  member_id: member,
                  is_lead: member === next.leader_member_id,
                }))
              );
            send({ success: true, id });
            return;
          }
          if (body.action === 'save_role') {
            const id = body.role.id || crypto.randomUUID();
            roles = roles
              .filter((r) => r.id !== id)
              .concat({
                ...body.role,
                id,
                status: 'active',
                is_system: false,
                organization_role_permissions: body.permission_ids.map((permission_id) => ({
                  permission_id,
                })),
              });
            send({ success: true, id });
            return;
          }
        }
        send({
          success: true,
          data: url.searchParams.get('resource') === 'roles' ? roles : units,
          members: memberRows,
          memberships,
          cost_centers: [],
          permissions,
          member_counts: {},
          scope_units: units,
          capabilities: {
            canManage:
              !url.searchParams.has('readonly') && !request.headers.referer?.includes('readonly'),
          },
        });
        return;
      }
      if (url.pathname === `/api/organizacion/members/${target}`) {
        if (body.action === 'set_units')
          memberships = memberships
            .filter((m) => m.member_id !== target)
            .concat(
              body.unit_ids.map((unit_id) => ({ unit_id, member_id: target, is_lead: false }))
            );
        if (body.action === 'set_roles') selectedRoles = body.role_ids;
        send({
          success: true,
          data: {
            member: memberRows[1],
            roles: selectedRoles.map((role_id) => ({ role_id })),
            units: memberships.filter((m) => m.member_id === target),
            available_roles: roles,
            available_units: units,
            capabilities: { manageRoles: true, manageTeams: true, updateMember: false },
            security: null,
          },
        });
        return;
      }
      if (url.pathname === '/api/organizacion/members') {
        send({ success: true, data: memberRows, invitations: [], roles, units });
        return;
      }
      response.writeHead(404);
      response.end();
      return;
    }
    response.setHeader('content-type', 'text/html');
    response.end(
      '<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>'
    );
  } catch {
    response.writeHead(500);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browserCache = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const installedShell = (await readdir(browserCache).catch(() => []))
  .filter((name) => name.startsWith('chromium_headless_shell-'))
  .sort()
  .at(-1);
const browser = await chromium.launch({
  executablePath:
    process.env.DOCUBOX_QA_BROWSER_EXECUTABLE ||
    (installedShell
      ? join(
          browserCache,
          installedShell,
          'chrome-headless-shell-win64',
          'chrome-headless-shell.exe'
        )
      : undefined),
  headless: true,
  timeout: 20000,
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
page.on('pageerror', (error) => errors.push(error.message));
const results = [];
try {
  await page.goto(base + '/organizacion/equipos');
  await page
    .getByRole('button', { name: 'Nueva unidad', exact: true })
    .waitFor({ state: 'visible' });
  await page.getByLabel('Nombre', { exact: true }).fill('Equipo de prueba visual');
  await page.getByRole('combobox', { name: 'Responsable', exact: true }).selectOption(owner);
  await page.getByRole('button', { name: 'Guardar unidad', exact: true }).click();
  await page.getByRole('button', { name: /Equipo de prueba visual/ }).waitFor();
  const saved = units.find((u) => u.name === 'Equipo de prueba visual');
  assert.ok(saved);
  assert.ok(memberships.some((m) => m.unit_id === saved.id && m.member_id === owner && m.is_lead));
  await page.reload();
  await page.getByRole('button', { name: /Equipo de prueba visual/ }).click();
  assert.equal(
    await page.getByLabel('Nombre', { exact: true }).inputValue(),
    'Equipo de prueba visual'
  );
  results.push('crear y recargar equipo; responsable incluido');
  for (const [name, width, height] of [
    ['desktop', 1440, 1000],
    ['tablet', 820, 1180],
    ['phone', 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Horizontal overflow at ${name}`
    );
    await page.screenshot({ path: `${output}/teams-${name}.png`, fullPage: true });
  }
  results.push('sin desbordamiento horizontal en escritorio, tablet y teléfono');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base + '/organizacion/roles');
  await page.getByLabel('Nombre', { exact: true }).fill('Rol de prueba visual');
  await page.getByLabel('Consultar equipos').check();
  await page.getByRole('button', { name: 'Guardar rol', exact: true }).click();
  await page.getByLabel('Contraseña', { exact: true }).fill('synthetic-test-only');
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await page.getByRole('button', { name: /Rol de prueba visual/ }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: /Rol de prueba visual/ }).click();
  assert.equal(await page.getByLabel('Consultar equipos').isChecked(), true);
  results.push('crear rol, confirmar y conservar permisos al recargar');
  await page.getByRole('button', { name: 'Nuevo rol', exact: true }).click();
  await page.getByLabel('Nombre', { exact: true }).fill('Alcance de prueba');
  await page.getByLabel('Alcance', { exact: true }).selectOption('units');
  await page.getByLabel('Legal · Ejemplo', { exact: true }).check();
  await page.getByLabel('Editar tareas').check();
  assert.equal(await page.getByLabel('Consultar equipos').isDisabled(), true);
  await page.getByRole('button', { name: 'Guardar rol', exact: true }).click();
  await page.getByLabel('Contraseña', { exact: true }).fill('synthetic-test-only');
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await page.getByLabel('Contraseña', { exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /Alcance de prueba/ }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: /Alcance de prueba/ }).click();
  assert.equal(await page.getByLabel('Alcance', { exact: true }).inputValue(), 'units');
  assert.equal(await page.getByLabel('Legal · Ejemplo', { exact: true }).isChecked(), true);
  results.push('el alcance por unidades y los permisos de recursos se conservan al recargar');
  await page.getByLabel('Alcance', { exact: true }).selectOption('custom');
  await page.getByLabel('Elementos propios', { exact: true }).check();
  await page.getByLabel('Elementos asignados', { exact: true }).check();
  await page.getByRole('button', { name: 'Guardar rol', exact: true }).click();
  await page.getByLabel('Contraseña', { exact: true }).fill('synthetic-test-only');
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await page.getByLabel('Contraseña', { exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /Alcance de prueba/ }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: /Alcance de prueba/ }).click();
  assert.equal(await page.getByLabel('Elementos propios', { exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel('Elementos asignados', { exact: true }).isChecked(), true);
  await page.getByLabel('Elementos propios', { exact: true }).uncheck();
  await page.reload();
  await page.getByRole('button', { name: /Alcance de prueba/ }).click();
  assert.equal(await page.getByLabel('Elementos propios', { exact: true }).isChecked(), true);
  results.push('el alcance personalizado se guarda y los cambios sin guardar no persisten');
  for (const size of [
    { width: 390, height: 844 },
    { width: 820, height: 1180 },
  ]) {
    await page.setViewportSize(size);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: output + '/role-scope-' + size.width + '.png', fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  results.push('el editor de alcances conserva sus controles en teléfono y tablet');

  await page.goto(base + '/organizacion/equipos?readonly=1');
  await page.getByRole('button', { name: 'Nueva unidad', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Nueva unidad', exact: true }).isDisabled(),
    true
  );
  assert.equal(await page.getByLabel('Nombre', { exact: true }).isDisabled(), true);
  results.push('consulta sin controles de edición habilitados');
  await page.goto(base + `/organizacion/miembros/${target}`);
  await page.getByRole('button', { name: 'Equipos', exact: true }).click();
  await page.getByLabel('Legal · Ejemplo').check();
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Equipos', exact: true }).click();
  assert.equal(await page.getByLabel('Legal · Ejemplo').isChecked(), true);
  results.push('asignar miembro a equipo y conservar selección al recargar');
  await page.getByRole('button', { name: 'Roles y alcance', exact: true }).click();
  await page.getByLabel('Rol de prueba visual').check();
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByLabel('Contraseña', { exact: true }).fill('synthetic-test-only');
  await page.getByRole('button', { name: /Confirmar y/ }).click();
  await page.waitForFunction(() => !document.querySelector('input[type="password"]'));
  await page.reload();
  await page.getByRole('button', { name: 'Roles y alcance', exact: true }).click();
  assert.equal(await page.getByLabel('Rol de prueba visual').isChecked(), true);
  results.push('asignar rol al miembro con confirmación y conservarlo al recargar');
  await page.goto(base + '/organizacion/miembros');
  await page.getByRole('link', { name: 'Persona de ejemplo', exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Administrar', exact: true }).count(), 2);
  results.push('listado de miembros enlaza ambos detalles');
  await page.goto(base + '/organizacion');
  await page.getByRole('heading', { name: 'Panel de administración', exact: true }).waitFor();
  await page.getByText('Se actualizó el equipo Legal', { exact: true }).waitFor();
  const adminNav = page.getByRole('navigation', {
    name: 'Administración de la organización',
    exact: true,
  });
  assert.equal(await adminNav.getByRole('link').count(), 17);
  await adminNav.getByRole('searchbox', { name: 'Buscar sección', exact: true }).fill('permisos');
  assert.equal(await adminNav.getByRole('link').count(), 1);
  assert.equal(
    await adminNav.getByRole('link', { name: 'Roles y permisos', exact: true }).count(),
    1
  );
  await adminNav.getByRole('button', { name: 'Limpiar búsqueda de secciones' }).click();
  assert.equal(await adminNav.getByRole('link').count(), 17);
  assert.equal(await page.locator('.organization-shortcut').count(), 6);
  results.push(
    'las 17 secciones siguen accesibles; búsqueda de navegación y accesos rápidos funcionan'
  );
  for (const [name, width, height] of [
    ['desktop', 1440, 1000],
    ['tablet', 820, 1180],
    ['phone', 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Dashboard overflow at ${name}`
    );
    if (name !== 'desktop') {
      const summary = page.locator('.organization-mobile-navigation > summary');
      await summary.click();
      const mobileNav = page.getByRole('navigation', {
        name: 'Secciones de la organización',
        exact: true,
      });
      assert.equal(await mobileNav.getByRole('link').count(), 17);
      await mobileNav.getByRole('searchbox', { name: 'Buscar sección' }).fill('areas');
      assert.equal(
        await mobileNav.getByRole('link', { name: 'Equipos y áreas', exact: true }).count(),
        1
      );
      await mobileNav.getByRole('button', { name: 'Limpiar búsqueda de secciones' }).click();
      await mobileNav.getByRole('searchbox', { name: 'Buscar sección' }).press('Escape');
      assert.equal(
        await page.locator('.organization-mobile-navigation').evaluate((el) => el.open),
        false
      );
    }
    await page.screenshot({ path: `${output}/dashboard-${name}.png`, fullPage: true });
  }
  results.push('panel y menú desplegable comprobados en teléfono y tablet, sin perder secciones');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.organization-shortcut[href="/organizacion/equipos"]').click();
  await page.getByRole('heading', { name: 'Equipos y áreas', exact: true }).waitFor();
  await page
    .getByRole('navigation', { name: 'Administración de la organización', exact: true })
    .getByRole('link', { name: 'Resumen', exact: true })
    .click();
  await page.getByRole('heading', { name: 'Panel de administración', exact: true }).waitFor();
  results.push('los accesos rápidos y el regreso al resumen navegan a la sección correspondiente');
  await page.goto(base + '/organizacion?readonly=1');
  await page.getByRole('heading', { name: 'Panel de administración', exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelector('.organization-dashboard')?.getAttribute('aria-busy') === 'false'
  );
  assert.equal(await page.locator('.organization-shortcut').count(), 3);
  assert.equal(await page.getByRole('link', { name: 'Ver auditoría', exact: true }).count(), 0);
  results.push('el panel y la navegación respetan los permisos del miembro');
  await page.goto(base + '/organizacion?summary_error=1');
  await page.getByRole('alert').waitFor();
  const teamStat = page
    .locator('.organization-stat-card')
    .filter({ has: page.getByRole('heading', { name: 'Equipos y áreas', exact: true }) });
  assert.equal(await teamStat.locator('.organization-stat-value').innerText(), '—');
  results.push('una fuente caída muestra aviso y dato no disponible en lugar de un cero falso');
  await page.goto(base + '/organizacion');
  await page.getByText('Se actualizó el equipo Legal', { exact: true }).waitFor();
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({
    path: `${output}/dashboard-dark.png`,
    fullPage: true,
    animations: 'disabled',
  });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  results.push('modo oscuro sin desbordamiento ni errores de interfaz');
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  for (const section of [
    'perfil',
    'directorio',
    'facultades',
    'flujos',
    'politicas-firma',
    'recursos',
    'continuidad',
    'seguridad',
    'certificados',
    'integraciones',
    'marca-comunicaciones',
    'plan-consumo',
    'auditoria',
  ]) {
    await page.goto(base + '/organizacion/' + section);
    await page.waitForLoadState('networkidle');
    assert.equal(await page.getByRole('alert').count(), 0, section + ' has load error');
    const sectionTabs = await page.getByRole('tab').count();
    for (let index = 0; index < sectionTabs; index++) {
      await page.getByRole('tab').nth(index).click();
      await page.waitForLoadState('networkidle');
      assert.equal(
        await page.getByRole('alert').count(),
        0,
        section + ' tab ' + index + ' has load error'
      );
    }
    if (sectionTabs) await page.getByRole('tab').first().click();
    assert.ok(
      (await page.locator('main h1,main h2,.organization-section-header h1').count()) ||
        (await page.getByRole('heading').count()),
      section + ' heading missing'
    );
    for (const [name, width, height] of [
      ['tablet', 820, 1180],
      ['phone', 390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        section + ' overflow ' + name
      );
      await page.screenshot({
        path: output + '/' + section + '-' + name + '.png',
        fullPage: true,
        animations: 'disabled',
      });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  results.push(
    'las 17 secciones cargan sin errores y conservan su navegación en teléfono y tablet'
  );
  await page.goto(base + '/organizacion/directorio');
  await page.getByRole('button', { name: 'Editar Directorio de ejemplo' }).click();
  await page
    .getByRole('dialog')
    .getByLabel(/^Nombre completo/)
    .fill('Directorio actualizado');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Guardar cambios', exact: true })
    .click();
  await page.getByText('Directorio actualizado', { exact: true }).waitFor();
  await page.reload();
  await page.getByText('Directorio actualizado', { exact: true }).waitFor();
  results.push('editar directorio y conservar cambios al recargar');
  await page.goto(base + '/organizacion/plan-consumo');
  await page.getByRole('tab', { name: 'Centros de costo', exact: true }).click();
  await page.getByRole('button', { name: 'Editar Centro de costo', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel(/^Nombre\*?$/)
    .fill('Centro actualizado');
  await page.getByRole('dialog').getByLabel('Presupuesto', { exact: true }).fill('2500');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Guardar cambios', exact: true })
    .click();
  await page.getByText('EJ-OP · Centro actualizado', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('tab', { name: 'Centros de costo', exact: true }).click();
  await page.getByText('EJ-OP · Centro actualizado', { exact: true }).waitFor();
  results.push('editar centro de costo y conservar presupuesto al recargar');
  await page.goto(base + '/organizacion/marca-comunicaciones');
  await page.getByRole('tab', { name: 'Plantillas de comunicación', exact: true }).click();
  await page.getByRole('button', { name: 'Editar Plantilla de comunicación', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel(/^Asunto/)
    .fill('Asunto actualizado');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Guardar cambios', exact: true })
    .click();
  await page.getByText(/Asunto actualizado · versión/).waitFor();
  await page.reload();
  await page.getByRole('tab', { name: 'Plantillas de comunicación', exact: true }).click();
  await page.getByText(/Asunto actualizado · versión/).waitFor();
  results.push('editar plantilla de comunicación y conservarla al recargar');
  await page.goto(base + '/organizacion/certificados');
  await page.getByRole('tab', { name: 'Permisos de uso', exact: true }).click();
  await page.getByRole('button', { name: 'Editar Permiso de certificado', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Límite monetario', { exact: true }).fill('1500');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Guardar cambios', exact: true })
    .click();
  await page.getByRole('dialog').getByLabel('Contraseña', { exact: true }).fill('synthetic-only');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirmar y guardar', exact: true })
    .click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.reload();
  await page.getByRole('tab', { name: 'Permisos de uso', exact: true }).click();
  await page.getByRole('button', { name: 'Editar Permiso de certificado', exact: true }).click();
  assert.equal(
    await page.getByRole('dialog').getByLabel('Límite monetario', { exact: true }).inputValue(),
    '1500'
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Revocar permiso', exact: true })
    .click();
  await page.getByRole('dialog').getByLabel('Contraseña', { exact: true }).fill('synthetic-only');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirmar y guardar', exact: true })
    .click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(catalogRows.certificate_access.length, 0);
  results.push(
    'editar y revocar permiso de certificado con confirmación; conservar monto al recargar'
  );
  await page.getByRole('button', { name: 'Nuevo permiso', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel(/^Certificado/)
    .selectOption(team);
  await page
    .getByRole('dialog')
    .getByRole('combobox', { name: 'Miembro', exact: true })
    .selectOption(owner);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Guardar cambios', exact: true })
    .click();
  await page.getByRole('dialog').getByLabel('Contraseña', { exact: true }).fill('synthetic-only');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirmar y guardar', exact: true })
    .click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.reload();
  await page.getByRole('tab', { name: 'Permisos de uso', exact: true }).click();
  await page.getByRole('button', { name: 'Editar Permiso de certificado', exact: true }).waitFor();
  assert.equal(catalogRows.certificate_access.length, 1);
  results.push('crear permiso de certificado con confirmación y conservarlo al recargar');
  await page.goto(base + '/organizacion/directorio');
  for (const close of ['cancel', 'escape', 'x', 'backdrop']) {
    await page.getByRole('button', { name: 'Editar Directorio actualizado', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByLabel(/^Nombre completo/)
      .fill('Cambio descartado');
    if (close === 'cancel')
      await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
    else if (close === 'escape') await page.getByRole('dialog').press('Escape');
    else if (close === 'x')
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Cerrar editor', exact: true })
        .click();
    else await page.mouse.click(4, 4);
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.reload();
    await page.getByText('Directorio actualizado', { exact: true }).waitFor();
    assert.equal(catalogRows.directory[0].full_name, 'Directorio actualizado');
  }
  results.push('cancelar, Escape, X y clic fuera descartan cambios del editor después de recargar');
  await page.goto(base + '/organizacion/directorio/33333333-3333-4333-8333-333333333333');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Documentos probatorios', exact: true }).click();
  await page.getByRole('button', { name: 'Cargar evidencia', exact: true }).click();
  await page.getByLabel('Nombre visible', { exact: true }).fill('PDF sintético de 5 MB');
  const synthetic = Buffer.alloc(5 * 1024 * 1024);
  synthetic.write('%PDF-1.7');
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: synthetic });
  await page.getByRole('button', { name: 'Resguardar archivo', exact: true }).click();
  await page
    .getByText('El archivo quedó resguardado y pendiente de validación.', { exact: true })
    .waitFor();
  assert.equal(await page.evaluate(() => window.__organizationUploadSize), synthetic.length);
  assert.ok(uploadRequests.every((row) => row.bytes < 16000));
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Documentos probatorios', exact: true }).click();
  await page.getByText('PDF sintético de 5 MB', { exact: true }).waitFor();
  results.push(
    'carga directa de 5 MB; solicitudes JSON pequeñas y evidencia conservada al recargar'
  );
  await page.goto(base + '/organizacion/seguridad');
  await page.getByRole('tab', { name: 'Retención', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva política', exact: true }).click();
  await page.getByLabel('Nombre', { exact: true }).fill('QA retención interna');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByText('QA retención interna', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('tab', { name: 'Retención', exact: true }).click();
  await page.getByText('QA retención interna', { exact: true }).waitFor();
  assert.equal(retentionPolicies.length, 1);
  results.push('crear política de retención y conservarla al recargar');
  await page.getByRole('tab', { name: 'Delegación', exact: true }).click();
  await page.getByRole('button', { name: /Miembros de la organización Permite delegar/ }).click();
  await page.getByRole('button', { name: 'Guardar política', exact: true }).click();
  await page.getByText('Política de delegación actualizada.', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('tab', { name: 'Delegación', exact: true }).click();
  assert.equal(delegationPolicy.mode, 'ORGANIZATION_ONLY');
  results.push('guardar delegación interna y conservarla al recargar');
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/results.json`,
    JSON.stringify(
      {
        isolated: true,
        results,
        errors,
        mutations: calls.map((c) => ({ path: c.path, action: c.body.action || 'reauthenticate' })),
      },
      null,
      2
    )
  );
  console.log(JSON.stringify({ isolated: true, passed: results, errors }));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  await writeFile(`${output}/failure.txt`, await page.locator('body').ariaSnapshot());
  throw error;
} finally {
  await browser.close();
  server.close();
}
