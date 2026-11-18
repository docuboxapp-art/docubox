// Browser checks of the actual Colabora components with isolated, persistent fixtures.
// No production data, actual emails, identity verification or signatures.
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
const out = '.tmp/colabora-interface';
await mkdir(out, { recursive: true });
const ws = '11111111-1111-4111-8111-111111111111',
  actor = '22222222-2222-4222-8222-222222222222',
  form = '33333333-3333-4333-8333-333333333333',
  doc = '44444444-4444-4444-8444-444444444444';
const stubs = {
  'next/link': `import React from 'react';export default function Link({prefetch,...props}){return React.createElement('a',props)}`,
  'next/navigation': `const search=new URLSearchParams(location.search),params={section:location.pathname.split('/')[2],id:location.pathname.split('/')[3]};export const usePathname=()=>location.pathname;export const useSearchParams=()=>search;export const useParams=()=>params;export const useRouter=()=>({push:p=>location.assign(p),refresh:()=>location.reload()});`,
  '@/components/AppLayout': `import React from 'react';export default function AppLayout({children}){return <div className="px-4 py-4 md:py-6">{children}</div>}`,
  '@/components/ui/AppLogo': `export default function AppLogo(){return <span>Docubox</span>}`,
  '@/contexts/WorkspaceContext': `const activeWorkspace={id:'${ws}',name:'Organización de ejemplo',workspaceType:'business',role:'owner'};export const useWorkspace=()=>({activeWorkspace,loading:false,refreshWorkspaces:async()=>{}});`,
  '@/contexts/CollaborationContext': `import React from 'react';const access={eligible:true,accessible:true,writeAllowed:!location.search.includes('readonly'),code:'OK',commercialTier:'pro',canManageSubscription:true,membershipRole:'owner',permissions:[],entitlements:Object.fromEntries(['collaboration_analytics','collaboration_external_rooms','collaboration_automations','collaboration_advanced_workflows'].map(k=>[k,{status:'active',access_level:'advanced'}]))};export const CollaborationProvider=({children})=>children;const can=(permission,write=false)=>!write||access.writeAllowed;export const useCollaboration=()=>({access,settings:{default_due_days:5,default_sla_hours:72,retention_days:365,timezone:'America/Mexico_City'},loading:false,can,refresh:async()=>{}});`,
  '@/lib/supabase/client': `const client={auth:{getSession:async()=>({data:{session:{access_token:'synthetic'}}})}};export const createClient=()=>client;`,
};
await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Shell from './src/app/colabora/_components/ColaboraShell';import Dashboard from './src/app/colabora/page';import List from './src/app/colabora/[section]/page';import Detail from './src/app/colabora/[section]/[id]/page';import Forms from './src/app/colabora/formularios/page';import Settings from './src/app/colabora/configuracion/page';import Setup from './src/app/colabora/configuracion-inicial/page';import Reports from './src/app/colabora/reportes/page';import Public from './src/app/solicitud/[publicToken]/page';import PublicRoom from './src/app/sala/[publicToken]/page';const p=location.pathname.split('/').filter(Boolean);const params=Promise.resolve({publicToken:p[1]});createRoot(document.getElementById('root')).render(p[0]==='solicitud'?<Public params={params}/>:p[0]==='sala'?<PublicRoom params={params}/>:<Shell>{p.length===1?<Dashboard/>:p[1]==='formularios'?<Forms/>:p[1]==='configuracion'?<Settings/>:p[1]==='configuracion-inicial'?<Setup/>:p[1]==='reportes'?<Reports/>:p.length>2?<Detail/>:<List/>}</Shell>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  outfile: out + '/app.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  plugins: [
    {
      name: 'fixtures',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (a) =>
          Object.hasOwn(stubs, a.path) ? { path: a.path, namespace: 'fixture' } : undefined
        );
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (a) => ({
          contents: stubs[a.path],
          loader: 'tsx',
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
  out + '/app.css',
  css.css + '\n' + (await readFile('src/styles/colabora.css', 'utf8'))
);
const members = [
  {
    user_id: actor,
    role: 'owner',
    user_profiles: { full_name: 'Responsable de ejemplo', email: 'responsable@example.invalid' },
  },
];
let next = 1;
const requests = [],
  calls = [];
const summary = {
  counters: { assigned_to_me: 1, due_soon: 1, overdue: 0, blocked: 0, reviews: 0, requests: 1 },
  tasks: [],
  reviews: [],
  spaces: [],
  activity: [],
  members,
};
const roomComments = [];
const taskRows = [
  {
    id: doc,
    workspace_id: ws,
    title: 'Tarea de lote',
    estado: 'nueva',
    prioridad: 'media',
    optimistic_version: 1,
  },
];
const milestoneRows = [
  {
    id: doc,
    title: 'Hito de ejemplo',
    source_type: 'milestone',
    status: 'upcoming',
    due_at: '2099-01-01T00:00:00Z',
    space_id: null,
  },
];
const resourceRows = {
  spaces: [
    {
      id: doc,
      name: 'Equipo de ejemplo',
      status: 'active',
      space_type: 'project',
      confidentiality: 'internal',
    },
  ],
  versions: [
    {
      id: doc,
      document_id: doc,
      version_number: 1,
      status: 'draft',
      documentos: { nombre: 'Documento de ejemplo' },
    },
  ],
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const send = (payload, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (url.pathname === '/app.js' || url.pathname === '/app.css') {
      res.setHeader('content-type', url.pathname.endsWith('css') ? 'text/css' : 'text/javascript');
      res.end(await readFile(out + url.pathname));
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      let body = {};
      if (req.method !== 'GET') {
        let text = '';
        for await (const chunk of req) text += chunk;
        body = JSON.parse(text || '{}');
      }
      calls.push({ path: url.pathname, method: req.method, body, search: url.search });
      if (url.pathname === '/api/colabora/overview') return send({ data: summary });
      if (url.pathname === '/api/colabora/catalog') {
        const type = url.searchParams.get('type');
        return send({
          data:
            type === 'members'
              ? members
              : type === 'forms'
                ? [{ id: form, name: 'Formulario de ejemplo', status: 'published' }]
                : [{ id: doc, nombre: 'Documento de ejemplo', estado: 'enviado' }],
        });
      }
      if (url.pathname === '/api/colabora/forms')
        return send({
          data: [
            {
              id: form,
              name: 'Formulario de ejemplo',
              status: 'published',
              version_number: 1,
              revision_number: 1,
              request_count: 2,
              response_count: 1,
              updated_at: '2026-11-18T00:00:00Z',
            },
          ],
        });
      if (url.pathname === '/api/colabora/reports')
        return send({
          data: {
            rows: [{ metric: 'Tareas activas', value: 1 }],
            generated_at: '2026-11-18T00:00:00Z',
          },
        });
      if (url.pathname === '/api/colabora/invitations')
        return send({
          status: 'sent',
          message: 'Invitación de ejemplo enviada.',
          path: '/solicitud/renewed-synthetic-token',
        });
      if (url.pathname.startsWith('/api/colabora/details/requests/')) {
        const row = requests.find((r) => r.id === url.pathname.split('/').at(-1));
        if (!row) return send({ error: 'No existe' }, 404);
        if (req.method === 'PATCH') {
          if (body.action === 'add_item')
            row.items.push({
              ...body.item,
              id: 'item-' + next++,
              status: 'pending',
              position: row.items.length,
            });
          if (body.action === 'edit_item')
            Object.assign(
              row.items.find((i) => i.id === body.item_id),
              body.item
            );
          if (body.action === 'remove_item')
            row.items = row.items.filter((i) => i.id !== body.item_id);
          if (body.action === 'cancel') row.status = 'cancelled';
        }
        return send({ data: { resource: row, items: row.items, activity: [] } });
      }
      if (url.pathname === '/api/colabora/resources/requests') {
        if (req.method === 'POST') {
          const row = {
            ...body,
            id: 'request-' + next++,
            folio: 'COL-QA-' + next,
            status: 'sent',
            invitation_status: body.send_invitation ? 'sent' : 'not_requested',
            created_at: '2026-11-18T00:00:00Z',
            items: body.items.map((i, n) => ({
              ...i,
              id: 'item-' + next++,
              status: 'pending',
              position: n,
            })),
          };
          requests.push(row);
          return send({
            data: row,
            credentials: { path: '/solicitud/synthetic-request-token' },
            invitation: {
              status: row.invitation_status,
              message: 'Solicitud de ejemplo guardada.',
            },
          });
        }
        return send({
          data: requests.filter(
            (r) => !url.searchParams.get('status') || r.status === url.searchParams.get('status')
          ),
        });
      }
      if (url.pathname.startsWith('/api/colabora/resources/'))
        return send({ data: resourceRows[url.pathname.split('/').at(-1)] || [] });
      if (url.pathname === '/api/colabora/calendar') return send({ data: milestoneRows });
      if (url.pathname.startsWith('/api/colabora/milestones/')) {
        milestoneRows[0].status = 'completed';
        return send({ success: true });
      }
      if (url.pathname === '/api/colabora/tasks/bulk') {
        const result = body.items.map((item) => {
          const row = taskRows.find((row) => row.id === item.id);
          if (!row || row.optimistic_version !== item.optimistic_version)
            return { id: item.id, success: false, code: 'task_version_conflict' };
          if (body.prioridad) row.prioridad = body.prioridad;
          if (body.action === 'start') row.estado = 'en_proceso';
          row.optimistic_version++;
          return { id: item.id, success: true, data: row };
        });
        return send({
          data: result,
          succeeded: result.filter((row) => row.success).length,
          failed: result.filter((row) => !row.success).length,
        });
      }
      if (url.pathname === '/api/colabora/tasks') {
        const filtered = taskRows.filter(
          (row) =>
            !url.searchParams.get('priority') || row.prioridad === url.searchParams.get('priority')
        );
        return send({ data: filtered, total: filtered.length });
      }
      if (url.pathname === '/api/colabora/access') return send({ success: true });
      if (url.pathname.startsWith('/api/public/colabora/rooms/')) {
        if (req.method === 'POST' && body.action === 'comment') {
          roomComments.push({
            id: 'comment-' + next++,
            body: body.body,
            created_at: '2026-11-18T00:00:00Z',
          });
          return send({ success: true });
        }
        return send({
          authenticated: true,
          comments_allowed: true,
          comments: roomComments,
          room: {
            name: 'Sala de ejemplo',
            purpose: 'Colaboración con el equipo',
            terms_required: false,
            downloads_allowed: false,
            watermark_enabled: true,
          },
          guest: { name: 'Invitado de ejemplo', terms_accepted: true },
          resources: [],
        });
      }
      if (url.pathname.startsWith('/api/public/colabora/requests/')) {
        if (url.pathname.endsWith('/action'))
          return send({ url: '/portal-formulario/synthetic-private-form' });
        return send({
          authenticated: true,
          recipient_name: 'Persona de ejemplo',
          request: { folio: 'COL-QA', title: 'Solicitud de ejemplo', status: 'in_progress' },
          items: [
            {
              id: 'public-doc',
              item_type: 'document',
              title: 'Archivo de ejemplo',
              required: true,
              status: 'pending',
              files: [],
            },
            {
              id: 'public-form',
              item_type: 'form',
              title: 'Formulario de ejemplo',
              required: true,
              status: 'pending',
              files: [],
            },
          ],
        });
      }
      return send({ error: 'Fixture not implemented' }, 404);
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>'
    );
  } catch (error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: error.message }));
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const cache = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData/Local'), 'ms-playwright');
const folder = (await readdir(cache))
  .filter((n) => n.startsWith('chromium_headless_shell-'))
  .sort()
  .at(-1);
const executablePath = join(
  cache,
  folder,
  'chrome-headless-shell-win64',
  'chrome-headless-shell.exe'
);
const browser = await chromium.launch({ executablePath, headless: true });
let checks = 0;
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => errors.push(e.message));
  const visit = async (path) => {
    await page.goto(origin + path);
    await page.waitForLoadState('networkidle');
  };
  const check = (message) => {
    checks++;
    console.log('PASS ' + message);
  };
  for (const section of [
    '',
    'tareas',
    'revisiones',
    'espacios',
    'calendario',
    'actividad',
    'formularios',
    'solicitudes',
    'reportes',
    'salas',
    'automatizaciones',
    'negociacion',
    'comites',
    'cierres',
    'configuracion',
  ]) {
    await visit('/colabora' + (section ? '/' + section : ''));
    await page.locator('main').waitFor();
    assert.equal(await page.getByText('Seccion no disponible', { exact: true }).count(), 0);
    check('screen ' + (section || 'resumen'));
  }
  await visit('/colabora/calendario');
  await page.getByRole('button', { name: 'Completar hito Hito de ejemplo' }).click();
  await page.getByRole('table').getByText('Completado', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('table').getByText('Completado', { exact: true }).waitFor();
  check('calendar milestone completion survives reload');
  await visit('/colabora/tareas');
  await page
    .getByRole('checkbox', { name: 'Seleccionar tarea Tarea de lote', exact: true })
    .check();
  await page.getByLabel('Acción para tareas seleccionadas').selectOption('priority');
  await page.getByLabel('Prioridad del lote').selectOption('critica');
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await page.getByRole('status').getByText('1 tarea actualizada.', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('table').getByText('Crítica', { exact: true }).waitFor();
  assert.equal(taskRows[0].prioridad, 'critica');
  assert.equal(taskRows[0].optimistic_version, 2);
  check('bulk task priority survives reload and clears selection');
  await page.getByLabel('Filtrar prioridad de tareas').selectOption('media');
  await page.getByText('No hay tareas', { exact: true }).waitFor();
  await page.getByLabel('Filtrar prioridad de tareas').selectOption('critica');
  await page.getByRole('table').getByText('Tarea de lote', { exact: true }).waitFor();
  await page.getByLabel('Filtrar prioridad de tareas').selectOption('');
  check('task priority filter updates the datatable through the API');
  assert.equal(
    await page
      .getByRole('checkbox', { name: 'Seleccionar tarea Tarea de lote', exact: true })
      .isChecked(),
    false
  );
  await visit('/colabora/reportes');
  for (const format of ['pdf', 'xlsx']) {
    await page.getByLabel('Formato de exportación').selectOption(format);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    assert.ok((await pending).suggestedFilename().endsWith('.' + format));
  }
  check('PDF and Excel export controls initiate their selected downloads');
  await visit('/colabora/solicitudes');
  await page.getByRole('button', { name: 'Crear solicitud', exact: true }).click();
  const drawer = page.getByRole('dialog');
  await drawer.waitFor();
  await drawer.locator('[name=title]').fill('Solicitud de prueba aislada');
  await drawer.locator('[name=recipient_name]').fill('Persona de ejemplo');
  await drawer.locator('[name=recipient_email]').fill('persona@example.invalid');
  await drawer.locator('[name=send_invitation]').uncheck();
  await drawer
    .getByLabel('Nombre del requisito', { exact: true })
    .first()
    .fill('Documento solicitado');
  await drawer.getByRole('button', { name: 'Agregar requisito', exact: true }).click();
  const cards = drawer.locator('fieldset select');
  await cards.last().selectOption('form');
  await drawer
    .getByLabel('Nombre del requisito', { exact: true })
    .last()
    .fill('Formulario solicitado');
  await drawer.locator('fieldset select').last().selectOption(form);
  await drawer.getByRole('button', { name: 'Crear', exact: true }).click();
  await page.waitForTimeout(100);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].items.length, 2);
  assert.equal(requests[0].items[1].form_template_id, form);
  check('mixed request saved with a published form');
  await page.keyboard.press('Escape');
  await visit('/colabora/solicitudes/' + requests[0].id);
  await page.getByRole('heading', { name: 'Requisitos y entregas' }).waitFor();
  check('request detail reload');
  await page.getByRole('button', { name: 'Agregar requisito', exact: true }).click();
  let modal = page.getByRole('dialog', { name: 'Agregar requisito', exact: true });
  await modal.getByLabel('Nombre del requisito', { exact: true }).fill('Tercero de ejemplo');
  await modal.getByRole('button', { name: 'Guardar requisito', exact: true }).click();
  await page.getByText('Tercero de ejemplo', { exact: true }).waitFor();
  assert.equal(requests[0].items.length, 3);
  check('requirement added and persisted');
  await page.getByRole('button', { name: 'Editar requisito Tercero de ejemplo' }).click();
  modal = page.getByRole('dialog', { name: 'Editar requisito', exact: true });
  await modal.getByLabel('Nombre del requisito', { exact: true }).fill('Cambio descartado');
  await page.keyboard.press('Escape');
  assert.equal(requests[0].items[2].title, 'Tercero de ejemplo');
  check('Escape discards requirement changes');
  await page.getByRole('button', { name: 'Editar requisito Tercero de ejemplo' }).click();
  modal = page.getByRole('dialog', { name: 'Editar requisito', exact: true });
  await modal.getByLabel('Nombre del requisito', { exact: true }).fill('Requisito editado');
  await modal.getByRole('button', { name: 'Guardar requisito', exact: true }).click();
  await page.getByText('Requisito editado', { exact: true }).waitFor();
  await page.reload();
  await page.getByText('Requisito editado', { exact: true }).waitFor();
  check('requirement edit survives reload');
  await page.getByRole('button', { name: 'Enviar invitación', exact: true }).click();
  await page.getByRole('textbox', { name: 'Enlace renovado de la solicitud' }).waitFor();
  assert.match(
    await page.getByRole('textbox', { name: 'Enlace renovado de la solicitud' }).inputValue(),
    /solicitud\/renewed/
  );
  check('renewal retains the one-time link');
  for (const size of [
    { width: 390, height: 844 },
    { width: 820, height: 1180 },
  ]) {
    await page.setViewportSize(size);
    await visit('/colabora/tareas');
    await page
      .getByRole('checkbox', { name: 'Seleccionar tarea Tarea de lote', exact: true })
      .check();
    await page.getByLabel('Acción para tareas seleccionadas').selectOption('due');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    await page
      .getByRole('checkbox', { name: 'Seleccionar tarea Tarea de lote', exact: true })
      .uncheck();
    check('bulk task toolbar fits ' + size.width);
    for (const path of [
      '/colabora',
      '/colabora/solicitudes',
      '/colabora/solicitudes/' + requests[0].id,
      '/colabora/formularios',
      '/colabora/configuracion',
      '/colabora/tareas',
      '/colabora/revisiones',
      '/colabora/espacios',
      '/colabora/calendario',
      '/colabora/actividad',
      '/colabora/reportes',
      '/colabora/salas',
      '/colabora/automatizaciones',
      '/colabora/negociacion',
      '/colabora/comites',
      '/colabora/cierres',
    ]) {
      await visit(path);
      if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))) {
        console.log(
          JSON.stringify(
            await page.evaluate(() => ({
              width: innerWidth,
              scroll: document.documentElement.scrollWidth,
              large: [...document.querySelectorAll('body *')]
                .filter((e) => e.getBoundingClientRect().right > innerWidth + 2)
                .slice(0, 15)
                .map((e) => ({
                  tag: e.tagName,
                  cls: e.className,
                  width: e.getBoundingClientRect().width,
                  right: e.getBoundingClientRect().right,
                })),
            }))
          )
        );
        await page.screenshot({ path: out + '/overflow.png', fullPage: true });
        throw Error('Page overflow ' + size.width + ' ' + path);
      }
    }
    await visit('/colabora/solicitudes/' + requests[0].id);
    await page.screenshot({ path: out + '/colabora-' + size.width + '.png', fullPage: true });
    check('phone/tablet ' + size.width);
  }
  await visit('/colabora/solicitudes?readonly=1');
  assert.equal(await page.getByRole('button', { name: 'Crear solicitud', exact: true }).count(), 0);
  check('read-only has no creation action');
  await visit('/solicitud/synthetic-request-token');
  await page.getByText('Archivo de ejemplo', { exact: true }).waitFor();
  assert.equal(await page.locator('input[type=file]').count(), 1);
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: /Responder formulario/ }).click();
  const popup = await popupPromise;
  await popup.waitForURL('**/portal-formulario/synthetic-private-form');
  check('participant form opens the canonical private portal');
  await popup.close();
  await page.screenshot({ path: out + '/tablet-request.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await visit('/solicitud/synthetic-request-token');
  await page.screenshot({ path: out + '/phone-request.png', fullPage: true });
  await visit('/sala/synthetic-room-token');
  await page.getByLabel('Nuevo comentario').fill('Comentario desde el portal');
  await page.getByRole('button', { name: 'Enviar comentario' }).click();
  await page.getByText('Comentario desde el portal', { exact: true }).waitFor();
  await page.reload();
  await page.getByText('Comentario desde el portal', { exact: true }).waitFor();
  assert.equal(roomComments.length, 1);
  check('guest comments persist after reload');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  await page.screenshot({ path: out + '/phone-room.png', fullPage: true });
  assert.deepEqual(errors, []);
  check('no client runtime errors');
  console.log(
    JSON.stringify({ checks, requests: requests.length, emailsSent: 0, realSignatures: 0 })
  );
  await context.close();
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
