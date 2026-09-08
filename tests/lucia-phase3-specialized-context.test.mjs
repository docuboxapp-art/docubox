import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read(
  'supabase/migrations/20260905070112_lucia_phase3_specialized_context_rpcs.sql'
);
const queries = read('src/lib/ai/luciaQueries.ts');
const askRoute = read('src/app/api/ai/ask/route.ts');
const security = read('src/lib/ai/security.ts');
const capabilitiesSource = read('src/lib/ai/moduleCapabilities.ts');

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

const evidence = loadTypeScriptModule('src/lib/ai/evidence.ts');
const capabilities = loadTypeScriptModule('src/lib/ai/moduleCapabilities.ts');

const rpcSignatures = new Map([
  ['get_lucia_organization_context', 'UUID, TEXT, UUID'],
  ['get_lucia_collaboration_context', 'UUID, TEXT, UUID'],
  ['get_lucia_case_file_context', 'UUID, UUID'],
  ['get_lucia_certification_context', 'UUID, UUID'],
  ['get_lucia_certified_notification_context', 'UUID, UUID'],
  ['get_lucia_batch_signature_context', 'UUID, UUID'],
  ['get_lucia_credit_title_context', 'UUID, UUID'],
  ['get_lucia_form_context', 'UUID, UUID'],
  ['get_lucia_report_context', 'UUID, TEXT, JSONB'],
  ['get_lucia_billing_context', 'UUID'],
]);

function functionBlock(name) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `${name} is missing`);
  const next = migration.indexOf('\nCREATE OR REPLACE FUNCTION public.', start + 1);
  return migration.slice(start, next === -1 ? migration.length : next);
}

test('all ten Phase 3 RPCs authenticate and authorize inside PostgreSQL', () => {
  for (const name of rpcSignatures.keys()) {
    const block = functionBlock(name);
    assert.match(block, /SECURITY DEFINER/);
    assert.match(block, /SET search_path = ''/);
    assert.match(block, /auth\.uid\(\)/);
    assert.match(block, /private\.lucia_workspace_role\(p_workspace_id\)/);
    assert.match(block, /workspace_id/);
  }
});

test('RPC execution is closed to PUBLIC, anon, and service_role', () => {
  for (const [name, signature] of rpcSignatures) {
    assert.match(
      migration,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${name}\\(${signature.replaceAll(' ', '\\s*')}\\) FROM PUBLIC, anon, service_role`
      )
    );
    assert.match(
      migration,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${name}\\(${signature.replaceAll(' ', '\\s*')}\\) TO authenticated`
      )
    );
  }
});

test('specialized payloads omit raw capabilities and unnecessary PII', () => {
  for (const forbidden of [
    "'token'",
    "'token_hash'",
    "'verification_code'",
    "'email'",
    "'phone'",
    "'rfc'",
    "'curp'",
    "'ip_address'",
    "'user_agent'",
    "'response_data'",
    "'signature_images'",
    "'private_key'",
    "'storage_path'",
    "'canonical_data'",
  ]) {
    assert.doesNotMatch(migration, new RegExp(`jsonb_build_object\\([^;]*${forbidden}`));
  }
  assert.match(functionBlock('get_lucia_certified_notification_context'), /recipient_count/);
  assert.doesNotMatch(
    functionBlock('get_lucia_form_context'),
    /fr\.(response_data|respondent_name|respondent_email|signature_images)/
  );
  assert.doesNotMatch(
    functionBlock('get_lucia_credit_title_context'),
    /ct\.(public_token|canonical_data|current_holder_name)/
  );
});

test('missing remote module schemas produce typed errors instead of empty arrays', () => {
  for (const name of [
    'get_lucia_certified_notification_context',
    'get_lucia_batch_signature_context',
    'get_lucia_credit_title_context',
  ]) {
    const block = functionBlock(name);
    assert.match(block, /to_regclass\(/);
    assert.match(block, /'SCHEMA_UNAVAILABLE'/);
  }
});

test('buildStructuredContext calls specialized RPCs before generic contexts', () => {
  const implementation = queries.slice(
    queries.indexOf('export async function buildStructuredContext')
  );
  const specialized = implementation.indexOf('SPECIALIZED_CONTEXT_MODULES.has(moduleKey)');
  const homeFallback = implementation.indexOf("['home_summary', 'reports_summary']");
  const genericClient = implementation.indexOf('const supabase = createServiceClient()');
  assert.ok(specialized >= 0 && specialized < homeFallback && specialized < genericClient);
  for (const name of rpcSignatures.keys()) assert.match(queries, new RegExp(name));
  assert.match(queries, /Authorization: `Bearer \$\{opts\.accessToken\}`/);
  assert.match(askRoute, /accessToken,\s*\n\s*routeContext/);
});

test('specialized evidence requires permission, rows, and valid sources', () => {
  const base = {
    route_context: { moduleKey: 'forms' },
    structured_context: {
      module: 'forms',
      workspace_id: 'workspace-1',
      permission: { can_view: true },
      row_count: 1,
      error_code: null,
      evidence_sources: [{ source: 'form_templates', source_id: 'form-1' }],
    },
    rag_context: [],
  };
  assert.equal(evidence.checkEvidenceForIntent('forms_help', base), true);
  assert.equal(
    evidence.checkEvidenceForIntent('forms_help', {
      ...base,
      structured_context: { ...base.structured_context, permission: { can_view: false } },
    }),
    false
  );
  assert.equal(
    evidence.checkEvidenceForIntent('forms_help', {
      ...base,
      structured_context: { ...base.structured_context, evidence_sources: [] },
    }),
    false
  );
  assert.equal(
    evidence.checkEvidenceForIntent('forms_help', {
      ...base,
      structured_context: { ...base.structured_context, error_code: 'NO_DATA' },
    }),
    false
  );
});

test('context and provider failures remain differentiated and telemetered', () => {
  for (const code of [
    'NO_DATA',
    'RESOURCE_ACCESS_DENIED',
    'RESOURCE_NOT_FOUND_OR_DENIED',
    'RESOURCE_NOT_INDEXED',
    'TOKEN_EXPIRED',
    'MODULE_NOT_SUPPORTED',
    'SCHEMA_UNAVAILABLE',
    'SUPABASE_RPC_ERROR',
    'AI_PROVIDER_ERROR',
  ]) {
    assert.match(`${queries}\n${askRoute}`, new RegExp(code));
  }
  assert.match(security, /accessTokenExpired\(accessToken\)/);
  assert.match(security, /AiRequestError\('TOKEN_EXPIRED', 401\)/);
  for (const field of [
    'moduleKey',
    'intent',
    'route',
    'resource_id',
    'context_rpc',
    'context_latency_ms',
    'row_count',
    'context_error_code',
    'model_used',
    'evidence_status',
  ]) {
    assert.match(askRoute, new RegExp(field));
  }
});

test('public validators stay deterministic and never call generative AI', () => {
  for (const route of ['/validar-formulario/form-id', '/validar-expediente/case-id']) {
    const capability = capabilities.resolveLuciaCapability(route);
    assert.equal(capability.accessMode, 'public_deterministic');
    assert.equal(capability.luciaMode, 'deterministic_only');
    assert.equal(capability.assistantPlacement, 'none');
  }
  assert.match(capabilitiesSource, /moduleKey: 'public_verification'/);
  assert.match(askRoute, /Esta pantalla usa una verificación determinista/);
});
