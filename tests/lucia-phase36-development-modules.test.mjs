import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function loadTypeScriptModule(relativePath) {
  const output = buildSync({
    entryPoints: [path.join(root, relativePath)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    write: false,
  }).outputFiles[0].text;
  const commonJsModule = { exports: {} };
  new Function('module', 'exports', 'require', output)(
    commonJsModule,
    commonJsModule.exports,
    require
  );
  return commonJsModule.exports;
}

const capabilities = loadTypeScriptModule('src/lib/ai/moduleCapabilities.ts');
const classifier = loadTypeScriptModule('src/lib/ai/luciaIntentClassifier.ts');
const evidence = loadTypeScriptModule('src/lib/ai/evidence.ts');
const queries = read('src/lib/ai/luciaQueries.ts');
const askRoute = read('src/app/api/ai/ask/route.ts');

const modules = [
  ['/notificaciones-certificadas', 'certified_notifications'],
  ['/firmas-masivas', 'batch_signatures'],
  ['/credit-titles', 'credit_titles'],
];

test('roadmap modules remain visible and explicitly in development', () => {
  for (const [route, moduleKey] of modules) {
    const capability = capabilities.resolveLuciaCapability(route);
    assert.equal(capability.moduleKey, moduleKey);
    assert.equal(capability.moduleStatus, 'in_development');
    assert.equal(capability.dataAvailability, 'schema_unavailable');
    assert.notEqual(capability.luciaMode, 'disabled');
  }
});

test('design questions and operational questions use different intents', () => {
  const cases = [
    [
      '/notificaciones-certificadas',
      '¿Cómo debería funcionar notificaciones certificadas?',
      '¿Qué notificaciones certificadas tengo pendientes?',
      'certified_notification_status',
    ],
    [
      '/firmas-masivas',
      'Diseña el flujo de firmas masivas.',
      '¿Qué lote de firmas masivas falló?',
      'batch_signature_status',
    ],
    ['/credit-titles', 'Define títulos de crédito.', '¿Qué pagarés vencen?', 'credit_title_status'],
  ];
  for (const [route, designQuestion, operationalQuestion, operationalIntent] of cases) {
    const context = classifier.buildRouteContext(route);
    assert.equal(classifier.classifyIntent(designQuestion, context).intent, 'module_design_help');
    assert.equal(classifier.classifyIntent(operationalQuestion, context).intent, operationalIntent);
  }
});

test('development status is orientational evidence but not operational evidence', () => {
  const context = {
    route_context: {
      moduleKey: 'certified_notifications',
      moduleStatus: 'in_development',
    },
    structured_context: {
      module: 'certified_notifications',
      module_status: 'in_development',
      data_availability: 'schema_unavailable',
      operational_data: false,
      error_code: 'SCHEMA_UNAVAILABLE',
      row_count: 0,
      evidence_sources: [],
    },
    rag_context: [],
  };
  assert.equal(evidence.checkEvidenceForIntent('module_design_help', context), true);
  assert.equal(evidence.checkEvidenceForIntent('certified_notification_status', context), false);
});

test('schema absence becomes typed development context and a non-generative operational response', () => {
  assert.match(queries, /module_status: 'in_development'/);
  assert.match(queries, /data_availability: 'schema_unavailable'/);
  assert.match(queries, /operational_data: false/);
  assert.match(
    askRoute,
    /Este módulo todavía no tiene datos operativos disponibles en este entorno\./
  );
  const evidenceGuard = askRoute.indexOf('if (!hasEvidence)');
  const modelCall = askRoute.indexOf('await completion');
  assert.ok(evidenceGuard >= 0 && modelCall > evidenceGuard);
  assert.match(askRoute, /developmentUnavailable \? 200/);
  assert.match(askRoute, /model_called: false/);
});

test('development demos are labelled and excluded from production', () => {
  const helper = read('src/lib/product/developmentModules.ts');
  assert.match(helper, /process\.env\.NODE_ENV !== 'production'/);
  for (const file of [
    'src/app/notificaciones-certificadas/page.tsx',
    'src/app/firmas-masivas/page.tsx',
    'src/app/credit-titles/page.tsx',
    'src/app/credit-titles/promissory-notes/page.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /DEVELOPMENT_DEMO_DATA_ENABLED/);
  }
  assert.match(read('src/app/firmas-masivas/components/BulkSignaturesUI.tsx'), /Datos de ejemplo/);
  for (const file of [
    'src/app/notificaciones-certificadas/components/NotificaUI.tsx',
    'src/app/firmas-masivas/components/BulkSignaturesUI.tsx',
    'src/app/credit-titles/components/CreditTitlesUI.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /En construcción/);
    assert.match(source, /DEVELOPMENT_MODULE_MESSAGE/);
  }
});
