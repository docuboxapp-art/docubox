import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync('src/app/formularios/respuestas/page.tsx', 'utf8');

function createResponsesPage(status) {
  const slots = [];
  const effects = [];
  const queriedTables = [];
  let cursor = 0;
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index][i]))) {
        slots[index] = deps;
        effects.push(callback);
      }
    },
    useMemo(callback) { return callback(); },
  };
  const client = {
    from(table) {
      queriedTables.push(table);
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        single() { return Promise.resolve({ data: { name: 'Solicitud', status }, error: null }); },
        order() { return Promise.resolve({ data: [] }); },
      };
      return builder;
    },
  };
  const modules = {
    react: hooks,
    'next/navigation': { useRouter: () => ({ push() {} }), useSearchParams: () => ({ get: () => 'form-1' }) },
    '@/components/AppLayout': { default: () => null, __esModule: true },
    '@/lib/supabase/client': { createClient: () => client },
  };
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', compiled)((name) => modules[name] || require(name), exports);
  const render = () => {
    cursor = 0;
    return exports.default().props.children.type();
  };
  const settle = async () => {
    render();
    effects.splice(0).forEach((effect) => effect());
    await new Promise((resolve) => setTimeout(resolve, 0));
    return render();
  };
  return { settle, queriedTables };
}

function textOf(node) {
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (!React.isValidElement(node)) return typeof node === 'string' ? node : '';
  return textOf(node.props.children);
}

test('draft and archived forms cannot load responses through a direct URL', async () => {
  for (const status of ['draft', 'in_review', 'archived']) {
    const page = createResponsesPage(status);
    const tree = await page.settle();
    assert.deepEqual(page.queriedTables, ['form_templates']);
    assert.match(textOf(tree), /Respuestas no disponibles/);
  }
});

test('published and paused forms retain access to existing responses', async () => {
  for (const status of ['published', 'paused']) {
    const page = createResponsesPage(status);
    const tree = await page.settle();
    assert.deepEqual(page.queriedTables, ['form_templates', 'form_responses']);
    assert.doesNotMatch(textOf(tree), /Respuestas no disponibles/);
  }
});
