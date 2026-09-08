import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20260905174616_lucia_document_intelligence.sql');
const service = read('src/lib/ai/documentIntelligence.ts');
const schemasSource = read('src/lib/ai/documentIntelligenceSchemas.ts');
const queries = read('src/lib/ai/luciaQueries.ts');
const evidenceSource = read('src/lib/ai/evidence.ts');
const capabilitiesSource = read('src/lib/ai/moduleCapabilities.ts');
const embedRoute = read('src/app/api/ai/embed-document/route.ts');
const analyzeRoute = read('src/app/api/ai/document-intelligence/analyze/route.ts');
const readRoute = read('src/app/api/ai/document-intelligence/[documentId]/route.ts');
const compareRoute = read('src/app/api/ai/document-intelligence/compare-versions/route.ts');
const feature = read('src/lib/ai/documentIntelligenceFeature.ts');

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

const schemas = loadTypeScriptModule('src/lib/ai/documentIntelligenceSchemas.ts');
const classifier = loadTypeScriptModule('src/lib/ai/luciaIntentClassifier.ts');
const capabilities = loadTypeScriptModule('src/lib/ai/moduleCapabilities.ts');
const featureModule = loadTypeScriptModule('src/lib/ai/documentIntelligenceFeature.ts');

const uuid = '11111111-1111-4111-8111-111111111111';
const evidence = [{ chunk_id: uuid, page_number: 1, quote: 'Contenido verificable' }];

test('migration creates seven intelligence tables and version-aware chunks', () => {
  for (const table of [
    'ai_document_profiles',
    'ai_document_extracted_fields',
    'ai_document_entities',
    'ai_document_obligations',
    'ai_document_classifications',
    'ai_document_completeness_checks',
    'ai_document_processing_jobs',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
    assert.match(migration, new RegExp(`'${table}'`));
  }
  for (const column of [
    'document_version_id',
    'document_hash',
    'content_hash',
    'extraction_method',
  ]) {
    assert.match(migration, new RegExp(column));
  }
});

test('intelligence tables expose authorized reads only', () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /public\.can_access_documento\(p_document_id\)/);
  assert.match(migration, /wm\.status = 'active'/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.%I FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.%I TO authenticated/);
  assert.match(migration, /GRANT ALL ON TABLE public\.%I TO service_role/);
  assert.doesNotMatch(migration, /FOR INSERT TO authenticated|FOR UPDATE TO authenticated/);
});

test('classification taxonomy is general and requires evidence', () => {
  for (const type of [
    'contrato',
    'carta',
    'documento_fiscal',
    'identificacion',
    'evidencia',
    'pagare',
    'otro',
  ]) {
    assert.ok(schemas.DOCUMENT_TYPES.includes(type));
  }
  const valid = {
    detected_document_type: 'carta',
    detected_document_category: 'administracion',
    language: 'es',
    confidence: 0.8,
    reason: 'La fuente contiene formato epistolar.',
    suggested_tags: ['correspondencia'],
    suggested_folder: 'Cartas',
    sensitivity: 'internal',
    retention_category: 'normal',
    evidence,
  };
  assert.equal(schemas.documentClassificationSchema.safeParse(valid).success, true);
  assert.equal(
    schemas.documentClassificationSchema.safeParse({ ...valid, evidence: [] }).success,
    false
  );
});

test('structured extraction rejects malformed values and impossible dates before persistence', () => {
  const field = {
    field_key: 'fecha_emision',
    field_label: 'Fecha de emision',
    field_value: '31 de febrero de 2026',
    normalized_value: '2026-02-31',
    value_type: 'date',
    confidence: 0.7,
    chunk_id: uuid,
    page_number: 1,
    evidence_text: '31 de febrero de 2026',
  };
  assert.equal(schemas.documentFieldsSchema.safeParse({ fields: [field] }).success, true);
  assert.equal(schemas.isPossibleIsoDate(field.normalized_value), false);
  assert.equal(
    schemas.documentFieldsSchema.safeParse({ fields: [{ ...field, chunk_id: 'bad' }] }).success,
    false
  );
  assert.match(service, /SENSITIVE_FIELD_TYPES\.has\(field\.value_type\)/);
  assert.match(service, /INSUFFICIENT_EVIDENCE/);
});

test('strict provider JSON schema and source validation guard every persisted analysis', () => {
  assert.match(service, /type: 'json_schema'/);
  assert.match(service, /strict: true/);
  assert.match(service, /JSON\.parse\(raw\)/);
  assert.match(service, /validateEvidenceReferences/);
  assert.match(service, /evidenceIds\(source\)\.has\(field\.chunk_id\)/);
  assert.match(service, /change\.version_a_evidence\.length > 0/);
  assert.match(service, /change\.version_b_evidence\.length > 0/);
  assert.match(schemasSource, /z\.string\(\)\.date\(\)\.nullable\(\)/);
});

test('service enforces user, workspace, document ACL and exact version chunks', () => {
  assert.match(service, /authorization\.user_id !== userId/);
  assert.match(service, /authorization\.workspace_id !== workspaceId/);
  assert.match(service, /assertAuthorizedDocument\(context\.authorization, documentId\)/);
  assert.match(service, /authorization\.is_public_token_flow/);
  assert.match(service, /eq\('document_version_id', context\.documentVersionId/);
  assert.match(service, /DOCUMENT_NOT_INDEXED/);
  assert.match(service, /VERSION_NOT_FOUND/);
});

test('document analysis never creates operational tasks or mutates document metadata', () => {
  assert.doesNotMatch(service, /from\(['"]tareas['"]\)/);
  assert.doesNotMatch(service, /from\(['"]documentos['"]\)\s*\.update/);
  assert.match(service, /suggested_task/);
  assert.match(analyzeRoute, /writesAppliedToDocument: false/);
});

test('all Phase 4 endpoints authenticate, authorize, and rate limit', () => {
  for (const route of [analyzeRoute, readRoute, compareRoute]) {
    assert.match(route, /requireAiUser\(request\)/);
    assert.match(route, /buildLuciaAuthorizationContext/);
    assert.match(route, /authorization\.denied_reason/);
    assert.match(route, /enforceAiRateLimits/);
    assert.doesNotMatch(route, /body\.userId|parsed\.data\.userId/);
  }
});

test('document intelligence is protected by a backend-only feature flag', () => {
  assert.match(feature, /process\.env\.LUCIA_DOCUMENT_INTELLIGENCE_ENABLED === 'true'/);
  assert.match(feature, /La inteligencia documental aún no está activa en este entorno\./);
  assert.match(service, /isDocumentIntelligenceEnabled\(\)/);
  assert.match(queries, /DOCUMENT_INTELLIGENCE_DISABLED/);
  assert.match(queries, /DOCUMENT_INTELLIGENCE_INTENTS\.has\(options\.intent\)/);
  for (const route of [analyzeRoute, readRoute, compareRoute]) {
    assert.ok(
      route.indexOf('requireAiUser(request)') < route.indexOf('isDocumentIntelligenceEnabled()')
    );
    assert.match(route, /DOCUMENT_INTELLIGENCE_DISABLED/);
  }

  const original = process.env.LUCIA_DOCUMENT_INTELLIGENCE_ENABLED;
  delete process.env.LUCIA_DOCUMENT_INTELLIGENCE_ENABLED;
  assert.equal(featureModule.isDocumentIntelligenceEnabled(), false);
  process.env.LUCIA_DOCUMENT_INTELLIGENCE_ENABLED = 'false';
  assert.equal(featureModule.isDocumentIntelligenceEnabled(), false);
  process.env.LUCIA_DOCUMENT_INTELLIGENCE_ENABLED = 'true';
  assert.equal(featureModule.isDocumentIntelligenceEnabled(), true);
  if (original === undefined) delete process.env.LUCIA_DOCUMENT_INTELLIGENCE_ENABLED;
  else process.env.LUCIA_DOCUMENT_INTELLIGENCE_ENABLED = original;
});

test('indexing records versions and hashes without deleting other versions', () => {
  assert.match(embedRoute, /document_version_id: source\.versionId/);
  assert.match(embedRoute, /document_hash: source\.sha256/);
  assert.match(embedRoute, /content_hash: computeChunkContentHash/);
  assert.match(embedRoute, /eq\('document_version_id', source\.versionId\)/);
  assert.match(embedRoute, /deletion = source\.versionId[\s\S]*const deleted = await deletion/);
});

test('new intents classify document intelligence prompts', () => {
  const route = classifier.buildRouteContext(`/visor-documento/${uuid}`);
  const cases = new Map([
    ['Genera ficha inteligente', 'document_intelligence_profile'],
    ['¿Qué tipo de documento es este?', 'document_classification'],
    ['Extrae los datos importantes', 'document_extracted_fields'],
    ['¿Qué obligaciones contiene?', 'document_obligations'],
    ['¿Está completo este documento?', 'document_completeness'],
    ['¿Qué carpeta recomiendas?', 'document_folder_suggestions'],
    ['¿Qué etiquetas debería tener?', 'document_tag_suggestions'],
    ['Compara esta versión con la anterior', 'document_version_comparison'],
    ['Muéstrame las fuentes de la respuesta', 'document_evidence_sources'],
  ]);
  for (const [question, intent] of cases) {
    assert.equal(classifier.classifyIntent(question, route).intent, intent);
  }
});

test('LucIA reads specialized intelligence before generic module context', () => {
  const implementation = queries.slice(
    queries.indexOf('export async function buildStructuredContext')
  );
  assert.ok(
    implementation.indexOf('DOCUMENT_INTELLIGENCE_INTENTS.has(intent)') <
      implementation.indexOf('SPECIALIZED_CONTEXT_MODULES.has(moduleKey)')
  );
  for (const table of [
    'ai_document_profiles',
    'ai_document_extracted_fields',
    'ai_document_obligations',
    'ai_document_classifications',
    'ai_document_completeness_checks',
  ]) {
    assert.match(queries, new RegExp(table));
  }
  assert.match(evidenceSource, /source_type:[\s\S]*'document_chunk'/);
  assert.match(evidenceSource, /document_version_id/);
  assert.match(evidenceSource, /page_number/);
});

test('suggested prompts appear only through enabled module capabilities', () => {
  const viewer = capabilities.resolveLuciaCapability(`/visor-documento/${uuid}`);
  assert.equal(viewer.luciaMode, 'enabled');
  assert.ok(viewer.suggestedPrompts.includes('Genera ficha inteligente'));
  assert.ok(viewer.suggestedPrompts.includes('Detecta obligaciones'));
  assert.match(capabilitiesSource, /Clasifica documentos sin tipo/);
  for (const route of ['/validar-formulario/test', '/validar-expediente/test']) {
    const capability = capabilities.resolveLuciaCapability(route);
    assert.equal(capability.luciaMode, 'deterministic_only');
    assert.deepEqual(capability.suggestedPrompts, []);
  }
});

test('quality scores remain explicitly orientative and no secrets enter telemetry', () => {
  assert.match(service, /Los scores son orientativos y no constituyen dictamen legal o fiscal/);
  assert.match(service, /responseText: '\[structured document intelligence omitted\]'/);
  assert.match(service, /evidence_status: 'verified'/);
  assert.match(service, /evidence_status: 'error'/);
  assert.doesNotMatch(service, /contextUsed:\s*\{[^}]*content:/s);
  for (const secret of ['otp', 'private_key', 'certificate_private', 'password']) {
    assert.doesNotMatch(service, new RegExp(`contextUsed:[\\s\\S]{0,600}${secret}`, 'i'));
  }
});
