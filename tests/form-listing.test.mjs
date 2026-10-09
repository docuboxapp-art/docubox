import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync('src/app/formularios/page.tsx', 'utf8');

function createListing(initialFavorites = [], description = '', formStatus = 'published', launches = []) {
  const slots = [];
  const effects = [];
  const requests = [];
  const routes = [];
  const savedFavorites = new Set(initialFavorites);
  const form = {
    id: 'form-1', name: 'Solicitud', description, status: formStatus, schema: [],
    settings: { documentTypeId: 'type-1' }, updated_at: '2026-10-06T12:00:00Z',
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
          const data = table === 'form_templates' ? [form]
            : table === 'tipo_documento' ? [{ id: 'type-1', nombre: 'Solicitud de credito' }]
            : table === 'form_tokens' ? launches
            : table === 'user_favorites' ? [...savedFavorites].map((item_id) => ({ item_id })) : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const modules = {
    react: hooks,
    'next/navigation': { useRouter: () => ({ push(route) { routes.push(route); } }) },
    '@/components/AppLayout': { default: () => null, __esModule: true },
    '@/contexts/WorkspaceContext': { useWorkspace: () => ({ activeWorkspace: { id: 'workspace-1' } }) },
    '@/contexts/AuthContext': { useAuth: () => ({ user: { id: 'user-1' } }) },
    '@/lib/supabase/client': { createClient: () => client },
    '@/lib/forms/lifecycle': { formSaveError: (error) => error.message },
    '@/lib/forms/schema': { normalizeFormTemplate: (value) => value },
  };
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', 'document', 'window', compiled)(
    (name) => modules[name] || require(name), exports,
    { addEventListener() {}, removeEventListener() {} },
    { setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {} },
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
  return [...(predicate(node) ? [node] : []), ...elements(node.props.children, predicate)];
}

const favoriteButton = (tree) => elements(tree, (node) => node.type === 'button' && 'aria-pressed' in node.props)[0];
const selectFilter = (listing, tree, value) => {
  elements(tree, (node) => node.type === 'select' && node.props['aria-label'] === 'Filtrar formularios por estado')[0]
    .props.onChange({ target: { value } });
  return listing.render();
};
const clickFavorite = async (tree) => {
  favoriteButton(tree).props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

test('listings have no selection checkboxes and forms show the catalog type name instead of signature', async () => {
  const listing = createListing();
  const tree = await listing.settle();
  assert.equal(elements(tree, (node) => node.type === 'input' && node.props.type === 'checkbox').length, 0);
  assert.ok(elements(tree, (node) => node.props.children === 'Tipo de formulario').length);
  assert.ok(elements(tree, (node) => node.props.children === 'Solicitud de credito').length);
  assert.equal(elements(tree, (node) => node.props.children === 'Firma').length, 0);
  assert.doesNotMatch(readFileSync('src/app/plantillas/page.tsx', 'utf8'), /type="checkbox"|selectedTemplateIds/);
  assert.equal(listing.requests.find((request) => request.table === 'form_templates').filters.workspace_id, 'workspace-1');
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
  assert.ok(elements(tree, (node) => Array.isArray(node.props.children) && node.props.children.includes('No fue posible actualizar tus favoritos.')).length);
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
  const filter = elements(tree, (node) => node.type === 'select' && node.props['aria-label'] === 'Filtrar formularios por estado')[0];
  assert.equal(filter.props.value, 'published');
  assert.deepEqual(filter.props.children.filter(React.isValidElement).map((option) => option.props.children.join('')), [
    'Publicadas (1)', 'Borradores (0)', 'Archivadas (0)', 'Favoritas (1)',
  ]);
  const favoritesTree = selectFilter(listing, tree, 'favorites');
  assert.equal(elements(favoritesTree, (node) => node.type === 'button' && node.props['aria-label'] === 'Vista previa de Solicitud').length, 1);
  await clickFavorite(favoritesTree);
  const emptyFavorites = listing.render();
  assert.equal(elements(emptyFavorites, (node) => node.type === 'button' && node.props['aria-label'] === 'Vista previa de Solicitud').length, 0);
  const updatedFilter = elements(emptyFavorites, (node) => node.type === 'select' && node.props['aria-label'] === 'Filtrar formularios por estado')[0];
  const updatedOptions = updatedFilter.props.children.filter(React.isValidElement).map((option) => option.props.children.join(''));
  assert.ok(updatedOptions.includes('Favoritas (0)'));
});

test('without published forms the initial filter shows every form', async () => {
  const listing = createListing([], '', 'draft');
  const tree = await listing.settle();
  const filter = elements(tree, (node) => node.type === 'select' && node.props['aria-label'] === 'Filtrar formularios por estado')[0];
  assert.equal(filter.props.value, 'all');
  assert.ok(elements(tree, (node) => node.type === 'button' && node.props['aria-label'] === 'Vista previa de Solicitud').length);
  assert.equal(elements(tree, (node) => node.type === 'button' && node.props.disabled && node.props.onClick?.toString().includes('/formularios/lanzar')).length, 1);
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
  const summary = (id) => elements(tree, (node) => node.type === 'button' && node.props['aria-controls'] === id)[0];
  assert.equal(summary('form-summary-metrics').props['aria-expanded'], false);
  assert.equal(summary('response-summary-metrics').props['aria-expanded'], true);
  assert.equal(elements(tree, (node) => node.type === 'button' && node.props['aria-label'] === 'Gestionar 1 respuesta pendiente').length, 1);
  summary('form-summary-metrics').props.onClick();
  tree = listing.render();
  assert.equal(summary('form-summary-metrics').props['aria-expanded'], true);
  assert.deepEqual(elements(tree, (node) => node.props.label && ['Total', 'Publicados', 'Borrador', 'Archivados'].includes(node.props.label)).map((node) => [node.props.label, node.props.value]), [
    ['Total', 1], ['Publicados', 1], ['Borrador', 0], ['Archivados', 0],
  ]);
});

test('closed is not an available filter or lifecycle action', async () => {
  const listing = createListing();
  const tree = await listing.settle();
  assert.equal(elements(tree, (node) => node.type === 'option' && node.props.value === 'closed').length, 0);
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
