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
const chat = read('src/components/LucIAChat.tsx');
const provider = read('src/contexts/LuciaAssistantContext.tsx');
const askRoute = read('src/app/api/ai/ask/route.ts');
const queries = read('src/lib/ai/luciaQueries.ts');
const evidence = read('src/lib/ai/evidence.ts');

function pageFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return pageFiles(absolute);
    return entry.name === 'page.tsx' ? [absolute] : [];
  });
}

function sampleRoute(file) {
  const directory = path.relative(path.join(root, 'src/app'), path.dirname(file));
  const segments = directory
    .split(path.sep)
    .filter((segment) => segment !== '.' && !segment.startsWith('[[...'))
    .map((segment) => (segment.startsWith('[') ? 'sample-resource' : segment));
  return `/${segments.join('/')}`;
}

test('moduleCapabilities covers every real page route with an explicit policy', () => {
  const routes = pageFiles(path.join(root, 'src/app')).map(sampleRoute);
  assert.ok(routes.length >= 100);
  for (const route of routes) {
    const capability = capabilities.resolveLuciaCapability(route);
    assert.notEqual(capability.moduleKey, 'unsupported', `Missing capability for ${route}`);
  }
});

test('every capability contains the complete Phase 2 contract and read-only actions', () => {
  const required = [
    'routePattern',
    'canonicalRoute',
    'moduleKey',
    'moduleName',
    'accessMode',
    'luciaMode',
    'moduleStatus',
    'dataAvailability',
    'scope',
    'purpose',
    'entities',
    'dataSources',
    'requiredContext',
    'suggestedPrompts',
    'allowedReadActions',
    'disallowedActions',
    'sensitiveFields',
    'evidenceRequirements',
  ];
  for (const capability of capabilities.MODULE_CAPABILITIES) {
    for (const field of required)
      assert.ok(field in capability, `${field} missing in ${capability.routePattern}`);
    assert.equal(
      capability.allowedReadActions.some((action) =>
        /crear|editar|eliminar|firmar|enviar/i.test(action)
      ),
      false,
      `Write action exposed in ${capability.routePattern}`
    );
  }
});

test('redirect aliases resolve to canonical routes and are never primary modules', () => {
  const expected = new Map([
    ['/documents-dashboard', '/inicio'],
    ['/pending-tasks', '/mis-tareas'],
    ['/participation-requests', '/mis-solicitudes'],
    ['/notifications', '/notificaciones'],
    ['/notificationes', '/notificaciones'],
    ['/sign-up-login-screen', '/login'],
  ]);
  for (const [route, canonical] of expected) {
    const capability = capabilities.resolveLuciaCapability(route);
    assert.equal(capability.accessMode, 'redirect_alias');
    assert.equal(capability.luciaMode, 'disabled');
    assert.equal(capability.canonicalRoute, canonical);
  }
});

test('control-plane routes are disabled and public verification is deterministic', () => {
  for (const route of [
    '/panel',
    '/panel/users',
    '/admin',
    '/superadmin/audit',
    '/admin/security/crypto-e2e',
  ]) {
    const capability = capabilities.resolveLuciaCapability(route);
    assert.equal(capability.accessMode, 'privileged_admin');
    assert.equal(capability.luciaMode, 'disabled');
  }
  for (const route of [
    '/verificar-documento',
    '/verificar-documento/folio-1',
    '/verificar-certificacion',
    '/verificar-certificacion/id-1',
    '/verificar-certificacion/c/token-1',
    '/verify/promissory-note/token-1',
    '/notificacion/token-1',
    '/validar-formulario/id-1',
    '/validar-expediente/id-1',
  ]) {
    const capability = capabilities.resolveLuciaCapability(route);
    assert.equal(capability.accessMode, 'public_deterministic');
    assert.equal(capability.luciaMode, 'deterministic_only');
    assert.equal(capability.assistantPlacement, 'none');
  }
});

test('public-token route context never exposes the raw capability', () => {
  const rawToken = 'raw-token-that-must-not-be-forwarded-1234567890';
  const context = classifier.buildRouteContext(
    `/form/${rawToken}`,
    undefined,
    undefined,
    rawToken,
    { token: rawToken },
    { step: 'campos', token: rawToken }
  );
  assert.equal(context.accessMode, 'public_token');
  assert.deepEqual(context.currentResourceIds, {});
  assert.equal(JSON.stringify(context).includes(rawToken), false);
  assert.match(chat, /sanitizedRouteParams/);
  assert.match(chat, /filter\(\(\[key\]\) => !\/token\/i\.test\(key\)\)/);
});

test('suggested prompts and intents change with the current module', () => {
  const home = capabilities.resolveLuciaCapability('/inicio');
  const viewer = capabilities.resolveLuciaCapability('/visor-documento/doc-1');
  const billing = capabilities.resolveLuciaCapability('/facturacion');
  assert.notDeepEqual(home.suggestedPrompts, viewer.suggestedPrompts);
  assert.notDeepEqual(viewer.suggestedPrompts, billing.suggestedPrompts);
  assert.equal(
    classifier.classifyIntent('¿Qué requiere atención?', classifier.buildRouteContext('/inicio'))
      .intent,
    'home_summary'
  );
  assert.equal(
    classifier.classifyIntent(
      'Resume este documento',
      classifier.buildRouteContext('/visor-documento/doc-1')
    ).intent,
    'document_summary'
  );
  assert.equal(
    classifier.classifyIntent('¿Cuánto he consumido?', classifier.buildRouteContext('/facturacion'))
      .intent,
    'billing_usage'
  );
});

test('buildRouteContext resolves canonical module and sanitized resource ids', () => {
  const context = classifier.buildRouteContext('/documentos/doc-123/versiones');
  assert.equal(context.moduleKey, 'documents');
  assert.equal(context.canonicalRoute, '/documentos/[documentId]/versiones');
  assert.deepEqual(context.currentResourceIds, { documentId: 'doc-123' });
  assert.equal(
    context.availableActions.some((action) => /eliminar|editar|firmar/i.test(action)),
    false
  );
});

test('the client mounts once, reads route params, and has no generic endpoint fallback', () => {
  assert.match(provider, /resolveLuciaCapability\(pathname\)/);
  assert.match(provider, /capability\.assistantPlacement === 'floating'/);
  assert.match(chat, /usePathname\(\)/);
  assert.match(chat, /useParams</);
  assert.match(chat, /moduleConfig\.luciaMode === 'disabled'/);
  assert.match(chat, /moduleConfig\.luciaMode === 'deterministic_only'/);
  assert.doesNotMatch(
    chat,
    /api\/ai\/chat-completion|getStreamingChatCompletion|GENERAL_SYSTEM_PROMPT/
  );
});

test('structured and RAG contexts enforce authorization before data access', () => {
  assert.match(
    queries,
    /if \(!isAuthorizedWorkspace\(authorization, workspaceId, userId\)\) return null/
  );
  assert.match(queries, /const ids = allowedIds\(authorization/);
  assert.match(queries, /\.in\('document_id', ids\)/);
  assert.match(queries, /authorization\.workspace_id !== workspaceId/);
  assert.match(queries, /RAG_MODULES\.has\(options\.routeContext\.moduleKey\)/);
  assert.doesNotMatch(queries, /select\('\*'\)/);
});

test('strict evidence prevents model calls without authorized context', () => {
  const evidenceCheck = askRoute.indexOf('if (!hasEvidence)');
  const modelCall = askRoute.indexOf('await completion');
  assert.ok(evidenceCheck >= 0 && modelCall > evidenceCheck);
  assert.match(askRoute, /DOCUMENT_RAG_INTENTS\.has\(intent\)/);
  assert.match(evidence, /case 'document_summary':[\s\S]{0,120}rag\.length > 0/);
  assert.match(askRoute, /intent === 'user_profile_sensitive'/);
  assert.match(askRoute, /sensitive_value_sent_to_model: false/);
});

test('server routing blocks disabled modes and records contextual telemetry', () => {
  const deterministicGuard = askRoute.indexOf("capability.luciaMode === 'deterministic_only'");
  const modelCall = askRoute.indexOf('await completion');
  assert.ok(deterministicGuard >= 0 && deterministicGuard < modelCall);
  assert.match(askRoute, /LUCIA_DISABLED_FOR_ROUTE/);
  assert.match(askRoute, /PUBLIC_TOKEN_MODE_REQUIRED/);
  assert.match(askRoute, /AUTHENTICATED_MODE_REQUIRED/);
  for (const field of [
    'moduleKey',
    'canonicalRoute',
    'luciaMode',
    'capabilityVersion',
    'suggestedPromptUsed',
    'context_size',
    'evidence_status',
  ])
    assert.match(askRoute, new RegExp(field));
});
