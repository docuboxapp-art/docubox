import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync('src/app/formularios/page.tsx', 'utf8');
const compilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX,
  esModuleInterop: true,
};

function loadPureModule(path, resolve = require) {
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions }).outputText;
  new Function('exports', 'require', compiled)(exports, resolve);
  return exports;
}

const listOrder = loadPureModule('src/lib/workspaces/list-order.ts');
const pendingLaunches = loadPureModule('src/lib/forms/pending-launches.ts');
const publicationPolicy = loadPureModule('src/lib/forms/publication-policy.ts');
const paginationDefaults = loadPureModule('src/lib/workspaces/table-pagination.ts');
const catalogFilters = loadPureModule('src/lib/workspaces/catalog-filters.ts');

function createListing(initialFavorites = [], description = '', formStatus = 'published', launches = [], transientLaunchFailures = 0, responses = []) {
  const slots = [];
  const effects = [];
  const requests = [];
  const routes = [];
  const savedFavorites = new Set(initialFavorites);
  const form = {
    id: 'form-1', name: 'Solicitud', description, status: formStatus, schema: [],
    settings: { documentTypeId: 'type-1' }, updated_at: '2026-10-06T12:00:00Z',
    created_at: '2026-10-01T12:00:00Z',
    published_at: formStatus === 'published' ? '2026-10-02T12:00:00Z' : null,
  };
  let cursor = 0;
  let failWrite = false;
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef(initial) { return hooks.useState(() => ({ current: initial }))[0]; },
    useMemo(callback) { return callback(); },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index][i]))) {
        slots[index] = deps;
        effects.push(callback);
      }
    },
    useLayoutEffect(callback, deps) { hooks.useEffect(callback, deps); },
  };
  const client = {
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    from(table) {
      const request = { table, action: 'select', filters: {} };
      const builder = {
        select() { return builder; },
        order() { return builder; },
        eq(key, value) { request.filters[key] = value; return builder; },
        in(key, values) { request.filters[key] = values; return builder; },
        delete() { request.action = 'delete'; return builder; },
        upsert(values, options) { Object.assign(request, { action: 'upsert', values, options }); return builder; },
        then(resolve, reject) {
          requests.push(request);
          if (request.action !== 'select') {
            if (failWrite) return Promise.resolve({ error: { message: 'Denied' } }).then(resolve, reject);
            if (request.action === 'upsert') savedFavorites.add(request.values.item_id);
            else savedFavorites.delete(request.filters.item_id);
            return Promise.resolve({ error: null }).then(resolve, reject);
          }
          if (table === 'form_tokens' && transientLaunchFailures > 0) {
            transientLaunchFailures--;
            return Promise.resolve({ data: null, error: { message: 'Service Unavailable' }, status: 503 }).then(resolve, reject);
          }
          const data = table === 'form_templates' ? [form]
            : table === 'tipo_documento' ? [{ id: 'type-1', nombre: 'Solicitud de credito' }]
            : table === 'form_tokens' ? launches
            : table === 'form_responses' ? responses
            : table === 'user_favorites' ? [...savedFavorites].map((item_id) => ({ item_id })) : [];
          return Promise.resolve({ data, error: null, status: 200 }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const modules = {
    react: hooks,
    'next/navigation': { useRouter: () => ({ push(route) { routes.push(route); } }) },
    '@/components/AppLayout': { default: () => null, __esModule: true },
    '@/components/WorkspaceTableToolbar': loadPureModule('src/components/WorkspaceTableToolbar.tsx', (name) => {
      if (name === './ResponsiveFilterBar' || name === './WorkspaceTableToolbarSelect') return () => null;
      return require(name);
    }),
    '@/lib/workspaces/catalog-filters': catalogFilters,
    '@/components/WorkspaceTableToolbarSelect': { default: () => null, __esModule: true },
    '@/components/ui/BottomNotice': { BottomNotice: () => null },
    '@/components/workspaces/TableScrollArea': { default: ({ children }) => children, __esModule: true },
    '@/components/workspaces/TableSortButton': { TableSortButton: () => null },
    '@/components/workspaces/TablePagination': loadPureModule('src/components/workspaces/TablePagination.tsx', (name) =>
      name === 'react' ? hooks : name === '@/lib/workspaces/table-pagination' ? paginationDefaults : require(name)
    ),
    '@/components/workspaces/ResizableTableHeader': { default: () => null, __esModule: true },
    '@/components/workspaces/useColumnReorder': {
      orderedTableCells: (columns, cells) => columns.map(({ id }) =>
        React.createElement(React.Fragment, { key: id }, cells[id])
      ),
    },
    '@/components/workspaces/useTableColumnLayout': {
      useTableColumnLayout: (columns) => ({ columns, headerProps: () => ({}) }),
    },
    '@/contexts/WorkspaceContext': { useWorkspace: () => ({ activeWorkspace: { id: 'workspace-1' } }) },
    '@/contexts/AuthContext': { useAuth: () => ({ user: { id: 'user-1' } }) },
    '@/hooks/useSummaryExpansion': {
      useSummaryExpansion(_key, initial = false) {
        const [expanded, setExpanded] = hooks.useState(initial);
        return [expanded, () => setExpanded((value) => !value)];
      },
    },
    '@/lib/supabase/client': { createClient: () => client },
    '@/lib/forms/lifecycle': { formSaveError: (error) => error.message },
    '@/lib/forms/pending-launches': pendingLaunches,
    '@/lib/forms/publication-policy': publicationPolicy,
    '@/lib/forms/schema': { normalizeFormTemplate: (value) => value },
    '@/lib/workspaces/list-order': listOrder,
  };
  const compiled = ts.transpileModule(source, { compilerOptions }).outputText;
  const exports = {};
  new Function('require', 'exports', 'document', 'window', 'sessionStorage', compiled)(
    (name) => modules[name] || require(name), exports,
    { addEventListener() {}, removeEventListener() {} },
    { setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {} },
    { getItem: () => null, removeItem() {} },
  );
  const render = () => { cursor = 0; return exports.default(); };
  const settle = async () => {
    render();
    effects.splice(0).forEach((effect) => effect());
    await new Promise((resolve) => setTimeout(resolve, 0));
    return render();
  };
  return { render, settle, requests, routes, savedFavorites, failWrites: () => { failWrite = true; } };
}

function elements(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, predicate));
  if (!React.isValidElement(node)) return [];
  return [...(predicate(node) ? [node] : []), ...elements(node.props.children, predicate), ...elements(node.props.filters, predicate)];
}

const favoriteButton = (tree) => elements(tree, (node) => node.type === 'button' && 'aria-pressed' in node.props)[0];
const getFilter = (tree, label) =>
  elements(tree, (node) => Array.isArray(node.props.filterDefinitions))[0].props.filterDefinitions
    .find((option) => option.label === label);
const statusFilter = (tree) => getFilter(tree, 'Estado');
const selectFilter = (listing, tree, value) => {
  statusFilter(tree).change(value);
  return listing.render();
};
const clickFavorite = async (tree) => {
  favoriteButton(tree).props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const summary = (tree, id) => elements(tree, (node) => node.type === 'button' && node.props['aria-controls'] === id)[0];
function expandResponses(listing, tree) {
  const button = summary(tree, 'response-summary-metrics');
  if (!button.props['aria-expanded']) button.props.onClick();
  return listing.render();
}

test('listings have no selection checkboxes and forms show the catalog type name instead of signature', async () => {
  const listing = createListing();
  const tree = await listing.settle();
  assert.equal(elements(tree, (node) => node.type === 'input' && node.props.type === 'checkbox').length, 0);
  assert.ok(getFilter(tree, 'Tipo de formulario'));
  assert.ok(elements(tree, (node) => node.props.children === 'Solicitud de credito').length);
  assert.equal(elements(tree, (node) => node.props.children === 'Firma').length, 0);
  assert.doesNotMatch(readFileSync('src/app/plantillas/page.tsx', 'utf8'), /type="checkbox"|selectedTemplateIds/);
  assert.equal(listing.requests.find((request) => request.table === 'form_templates').filters.workspace_id, 'workspace-1');
});

test('a temporary launch service error is retried without leaving a false error notice', async () => {
  const listing = createListing([], '', 'published', [], 1);
  await listing.settle();
  await new Promise((resolve) => setTimeout(resolve, 350));
  const tree = expandResponses(listing, listing.render());
  assert.equal(listing.requests.filter((request) => request.table === 'form_tokens').length, 2);
  assert.equal(elements(tree, (node) => node.props.message?.includes('No se pudieron cargar los lanzamientos')).length, 0);
});

test('form favorites persist per user, survive loading, and can be removed', async () => {
  const listing = createListing();
  const tree = await listing.settle();
  assert.equal(favoriteButton(tree).props.disabled, false);
  await clickFavorite(tree);
  assert.ok(listing.savedFavorites.has('form-1'));
  assert.equal(favoriteButton(listing.render()).props['aria-pressed'], true);
  const insert = listing.requests.find((request) => request.action === 'upsert');
  assert.deepEqual(insert.values, { user_id: 'user-1', storage_key: 'formularios', item_id: 'form-1' });
  assert.deepEqual(insert.options, { onConflict: 'user_id,storage_key,item_id' });

  const reloaded = createListing([...listing.savedFavorites]);
  assert.equal(favoriteButton(await reloaded.settle()).props['aria-pressed'], true);

  await clickFavorite(listing.render());
  assert.equal(listing.savedFavorites.size, 0);
  assert.equal(favoriteButton(listing.render()).props['aria-pressed'], false);
  assert.deepEqual(listing.requests.find((request) => request.action === 'delete').filters,
    { user_id: 'user-1', storage_key: 'formularios', item_id: 'form-1' });
});

test('failed favorite writes restore the previous state and report the failure', async () => {
  const listing = createListing();
  await listing.settle();
  listing.failWrites();
  await clickFavorite(listing.render());
  const tree = listing.render();
  assert.equal(favoriteButton(tree).props['aria-pressed'], false);
  assert.equal(favoriteButton(tree).props.disabled, false);
  assert.ok(elements(tree, (node) => node.props.message === 'No fue posible actualizar tus favoritos.').length);
});

test('each form has a direct preview action with its own form id', async () => {
  const listing = createListing();
  const tree = await listing.settle();
  const previews = elements(tree, (node) => node.type === 'button' && node.props.title === 'Vista previa');
  assert.equal(previews.length, 1);
  assert.equal(previews[0].props['aria-label'], 'Vista previa de Solicitud');
  const actions = elements(tree, (node) => node.type === 'div' && node.props.className === 'inline-flex items-center gap-1')[0];
  assert.deepEqual(actions.props.children.filter(React.isValidElement).map((button) => button.props['aria-label']), [
    'Vista previa de Solicitud', 'Lanzar formulario Solicitud', 'Marcar Solicitud como favorito',
    'Abrir Solicitud', 'Más acciones para Solicitud',
  ]);
  previews[0].props.onClick();
  assert.deepEqual(listing.routes, ['/formularios/preview?id=form-1']);
});

test('responses and launch actions respect the form lifecycle', async () => {
  for (const status of ['draft', 'in_review', 'archived']) {
    const listing = createListing([], '', status);
    const tree = selectFilter(listing, await listing.settle(), status);
    assert.equal(elements(tree, (node) => node.type === 'button' && node.props['aria-label']?.startsWith('Lanzar formulario')).length, 0);
    assert.equal(elements(tree, (node) => node.type === 'button' && node.props.onClick?.toString().includes('/formularios/respuestas')).length, 0);
    assert.equal(elements(tree, (node) => node.props['aria-label'] === 'Respuestas no disponibles').length, 1);
  }

  for (const status of ['published', 'paused']) {
    const listing = createListing([], '', status);
    const tree = selectFilter(listing, await listing.settle(), status);
    const responses = elements(tree, (node) => node.type === 'button' && node.props.onClick?.toString().includes('/formularios/respuestas'));
    assert.equal(responses.length, 1);
    responses[0].props.onClick();
    assert.deepEqual(listing.routes, ['/formularios/respuestas?id=form-1']);
    assert.equal(elements(tree, (node) => node.type === 'button' && node.props['aria-label'] === 'Lanzar formulario Solicitud').length, status === 'published' ? 1 : 0);
  }
});

test('status filter shows counts and favorites from the current workspace', async () => {
  const listing = createListing(['form-1']);
  const tree = await listing.settle();
  const filter = statusFilter(tree);
  assert.equal(filter.value, 'published');
  assert.deepEqual(filter.options.map(({ name }) => name), [
    'Todos (1)', 'Publicados (1)', 'Borradores (0)', 'Archivados (0)', 'En revisión (0)', 'Pausados (0)',
  ]);
  getFilter(tree, 'Favoritos').change('yes');
  const favoritesTree = listing.render();
  assert.equal(elements(favoritesTree, (node) => node.type === 'button' && node.props['aria-label'] === 'Vista previa de Solicitud').length, 1);
  await clickFavorite(favoritesTree);
  const emptyFavorites = listing.render();
  assert.equal(elements(emptyFavorites, (node) => node.type === 'button' && node.props['aria-label'] === 'Vista previa de Solicitud').length, 0);
  assert.equal(getFilter(emptyFavorites, 'Favoritos').value, 'yes');
  assert.equal(statusFilter(emptyFavorites).value, 'published');
  getFilter(emptyFavorites, 'Favoritos').clear();
  assert.equal(elements(listing.render(), (node) => node.type === 'button' && node.props['aria-label'] === 'Vista previa de Solicitud').length, 1);
});

test('without published forms the initial filter shows every form', async () => {
  const listing = createListing([], '', 'draft');
  const tree = await listing.settle();
  const filter = statusFilter(tree);
  assert.equal(filter.value, 'all');
  assert.ok(elements(tree, (node) => node.type === 'button' && node.props['aria-label'] === 'Vista previa de Solicitud').length);
  assert.equal(elements(tree, (node) => node.type === 'button' && node.props['aria-label']?.startsWith('Lanzar formulario')).length, 0);
});

test('publication date and form types combine and can be cleared separately', async () => {
  const listing = createListing([], '', 'draft');
  const tree = await listing.settle();
  const rows = (view) => elements(view, (node) => node.props['aria-label'] === 'Vista previa de Solicitud');
  getFilter(tree, 'Tipo de formulario').change('Solicitud de credito');
  getFilter(listing.render(), 'Fecha de publicación').change('none');
  assert.equal(rows(listing.render()).length, 1);
  getFilter(listing.render(), 'Fecha de creación').change('none');
  assert.equal(rows(listing.render()).length, 0);
  getFilter(listing.render(), 'Fecha de creación').clear();
  assert.equal(rows(listing.render()).length, 1);
  assert.deepEqual(getFilter(listing.render(), 'Tipo de formulario').value, ['Solicitud de credito']);
  assert.equal(getFilter(listing.render(), 'Fecha de publicación').value, 'none');
});

test('form and response summaries start in the requested states and count only active pending launches', async () => {
  const launches = [
    { id: 'active', template_id: 'form-1', recipient_email: 'ana@example.com', recipient_name: 'Ana', created_at: '2026-10-09T10:00:00Z', expires_at: '2099-01-01T00:00:00Z', used_at: null },
    { id: 'answered', template_id: 'form-1', recipient_email: 'ben@example.com', recipient_name: 'Ben', created_at: '2026-10-09T10:00:00Z', expires_at: '2099-01-01T00:00:00Z', used_at: '2026-10-09T11:00:00Z' },
    { id: 'expired', template_id: 'form-1', recipient_email: 'cal@example.com', recipient_name: 'Cal', created_at: '2026-10-09T10:00:00Z', expires_at: '2000-01-01T00:00:00Z', used_at: null },
  ];
  const listing = createListing([], '', 'published', launches);
  let tree = await listing.settle();
  tree = await listing.settle();
  assert.equal(summary(tree, 'form-summary-metrics').props['aria-expanded'], false);
  assert.equal(summary(tree, 'response-summary-metrics').props['aria-expanded'], false);
  tree = expandResponses(listing, tree);
  assert.equal(elements(tree, (node) => node.type === 'button' && node.props['aria-label'] === 'Ver 1 respuesta pendiente').length, 1);
  summary(tree, 'form-summary-metrics').props.onClick();
  tree = listing.render();
  assert.equal(summary(tree, 'form-summary-metrics').props['aria-expanded'], true);
  assert.deepEqual(elements(tree, (node) => node.props.label && ['Total', 'Publicados', 'Borrador', 'Archivados'].includes(node.props.label)).map((node) => [node.props.label, node.props.value]), [
    ['Total', 1], ['Publicados', 1], ['Borrador', 0], ['Archivados', 0],
  ]);
});

test('a response after duplicate invitations clears the pending counter for that recipient', async () => {
  const launches = [
    { id: 'older', template_id: 'form-1', recipient_email: 'ANA@example.com', recipient_name: 'Ana', created_at: '2026-10-09T10:00:00Z', expires_at: null, used_at: '2026-10-09T12:00:00Z' },
    { id: 'duplicate', template_id: 'form-1', recipient_email: 'ana@example.com', recipient_name: 'Ana', created_at: '2026-10-09T11:00:00Z', expires_at: null, used_at: null },
  ];
  const responses = [{ template_id: 'form-1', token_id: 'older', respondent_email: 'ana@example.com', submitted_at: '2026-10-09T12:00:00Z' }];
  const listing = createListing([], '', 'published', launches, 0, responses);
  await listing.settle();
  const tree = expandResponses(listing, await listing.settle());
  assert.equal(elements(tree, (node) => node.type === 'button' && node.props['aria-label'] === 'Sin respuestas pendientes').length, 1);
});

test('a new invitation after a response remains pending', async () => {
  const launches = [
    { id: 'newer', template_id: 'form-1', recipient_email: 'ana@example.com', recipient_name: 'Ana', created_at: '2026-10-10T10:00:00Z', expires_at: null, used_at: null },
  ];
  const responses = [{ template_id: 'form-1', token_id: 'older', respondent_email: 'ana@example.com', submitted_at: '2026-10-09T12:00:00Z' }];
  const listing = createListing([], '', 'published', launches, 0, responses);
  await listing.settle();
  const tree = expandResponses(listing, await listing.settle());
  assert.equal(elements(tree, (node) => node.type === 'button' && node.props['aria-label'] === 'Ver 1 respuesta pendiente').length, 1);
});

test('closed is not an available filter or lifecycle action', async () => {
  const listing = createListing();
  const tree = await listing.settle();
  assert.equal(statusFilter(tree).options.some(({ id }) => id === 'closed'), false);
  assert.doesNotMatch(source, /label="Cerrar formulario"|changeStatus\(form, 'closed'\)/);
});

test('form subtext contains only the saved description and is omitted when empty', async () => {
  const descriptionNodes = (tree) => elements(tree, (node) => node.type === 'span' && node.props.className?.includes('!font-normal'));
  for (const description of ['', '   ']) {
    assert.equal(descriptionNodes(await createListing([], description).settle()).length, 0);
  }
  const descriptions = descriptionNodes(await createListing([], 'Descripcion escrita por el usuario').settle());
  assert.equal(descriptions.length, 1);
  assert.equal(descriptions[0].props.children, 'Descripcion escrita por el usuario');
  assert.ok(descriptions[0].props.className.includes('!text-xs'));
});
