import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const askRoute = read('src/app/api/ai/ask/route.ts');
const chatRoute = read('src/app/api/ai/chat-completion/route.ts');
const speechRoute = read('src/app/api/ai/speech-to-text/route.ts');
const embedRoute = read('src/app/api/ai/embed-document/route.ts');
const queries = read('src/lib/ai/luciaQueries.ts');
const authorization = read('src/lib/ai/luciaAuthorization.ts');
const chat = read('src/components/LucIAChat.tsx');
const migration = read('supabase/migrations/20260904170000_lucia_phase1_security.sql');
const vectorRepairMigration = read(
  'supabase/migrations/20260905200000_fix_secure_vector_operator_resolution.sql'
);
const security = read('src/lib/ai/security.ts');
const markRegistered = read('src/app/api/portal-participante/mark-registered/route.ts');
const publicTokenRoutes = [
  'src/app/api/enrollment/validate-token/route.ts',
  'src/app/api/enrollment/status/route.ts',
  'src/app/api/enrollment/record-start/route.ts',
  'src/app/api/enrollment/process-captures/route.ts',
  'src/app/api/enrollment/log-enrollment/route.ts',
  'src/app/api/enrollment/complete/route.ts',
  'src/app/api/enrollment/cancel-token/route.ts',
  'src/app/api/mobile-upload/submit-id-capture/route.ts',
  'src/app/api/mobile-upload/submit/route.ts',
  'src/app/api/mobile-upload/session-status/route.ts',
  'src/app/api/mobile-upload/session-result/route.ts',
  'src/app/api/mobile-upload/get-file/route.ts',
  'src/app/api/mobile-upload/check-stored-id/route.ts',
  'src/app/api/mobile-upload/cancel-session/route.ts',
].map(read);

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

const rules = loadTypeScriptModule('src/lib/ai/authorizationRules.ts');
const evidence = loadTypeScriptModule('src/lib/ai/evidence.ts');
const redaction = loadTypeScriptModule('src/lib/ai/redaction.ts');

test('authenticated AI endpoints reject anonymous use and client-selected models', () => {
  for (const route of [chatRoute, speechRoute, embedRoute])
    assert.match(route, /requireAiUser\(request\)/);
  assert.match(chatRoute, /GENERIC_AI_ENDPOINT_DISABLED/);
  assert.match(chatRoute, /AI_MODEL_NOT_ALLOWED/);
  assert.match(speechRoute, /provider !== AI_PROVIDER \|\| model !== TRANSCRIPTION_MODEL/);
  assert.match(embedRoute, /CLIENT_PROVIDER_OR_STORAGE_OVERRIDE_FORBIDDEN/);
});

test('AI endpoints enforce payload limits and distributed dimensions', () => {
  assert.match(askRoute, /readLimitedJson<AskBody>\(request, AI_BODY_LIMITS\.ask\)/);
  assert.match(chatRoute, /AI_BODY_LIMITS\.chat/);
  assert.match(speechRoute, /AI_BODY_LIMITS\.audio/);
  assert.match(embedRoute, /AI_BODY_LIMITS\.embed/);
  assert.match(migration, /consume_ai_rate_limit/);
  assert.match(migration, /auth\.jwt\(\) ->> 'role'/);
});

test('LucIA has no generic fallback when workspace context is unavailable', () => {
  assert.doesNotMatch(chat, /getStreamingChatCompletion/);
  assert.doesNotMatch(chat, /GENERAL_SYSTEM_PROMPT/);
  assert.match(chat, /No pude determinar un espacio de trabajo autorizado/);
  assert.match(chat, /workspaceUnavailable/);
  assert.doesNotMatch(chat, /triggerAction|ROUTE_ACTION_INTENTS/);
});

test('document ACL denies same-workspace members without a document grant', () => {
  const base = {
    documentWorkspaceId: 'workspace-a',
    requestedWorkspaceId: 'workspace-a',
    documentOwnerId: 'owner',
    userId: 'member',
    userEmail: 'member@example.test',
    membershipRole: 'member',
    membershipStatus: 'active',
    hidden: false,
    participants: [],
  };
  assert.equal(rules.canReadLuciaDocument(base), false);
  assert.equal(rules.canReadLuciaDocument({ ...base, requestedWorkspaceId: 'workspace-b' }), false);
  assert.equal(
    rules.canReadLuciaDocument({ ...base, hidden: true, documentOwnerId: 'member' }),
    false
  );
});

test('document ACL grants only owners, managers, and active matching participants', () => {
  const base = {
    documentWorkspaceId: 'workspace-a',
    requestedWorkspaceId: 'workspace-a',
    documentOwnerId: 'owner',
    userId: 'participant',
    userEmail: 'participant@example.test',
    membershipRole: 'member',
    membershipStatus: 'active',
    hidden: false,
    participants: [{ email: 'participant@example.test', current_access: true }],
  };
  assert.equal(rules.canReadLuciaDocument(base), true);
  assert.equal(
    rules.canReadLuciaDocument({
      ...base,
      participants: [{ email: base.userEmail, current_access: false }],
    }),
    false
  );
  assert.equal(rules.canReadLuciaDocument({ ...base, userId: 'owner', participants: [] }), true);
  assert.equal(
    rules.canReadLuciaDocument({ ...base, membershipRole: 'admin', participants: [] }),
    true
  );
  assert.equal(rules.canReadLuciaDocument({ ...base, membershipStatus: 'suspended' }), false);
});

test('RAG receives only authorized ids and zero chunks blocks document analysis', () => {
  assert.match(queries, /const ids = allowedIds\(authorization, options\.documentId\)/);
  assert.match(queries, /\.in\('document_id', ids\)/);
  assert.match(migration, /c\.document_id = ANY\(p_allowed_document_ids\)/);
  assert.match(queries, /if \(\s*!authorizedChunks\.length[\s\S]{0,150}return authorizedChunks/);
  const ragImplementation = queries.slice(queries.indexOf('export async function buildRagContext'));
  assert.ok(
    ragImplementation.indexOf('!authorizedChunks.length') <
      ragImplementation.indexOf('await generateQueryEmbedding')
  );
  assert.equal(evidence.checkEvidenceForIntent('document_summary', { rag_context: [] }), false);
  assert.equal(
    evidence.NO_DOCUMENT_CONTENT_RESPONSE,
    'No encontré contenido documental indexado y autorizado para responder eso.'
  );
});

test('sensitive self-profile responses stay in the backend and general prompts exclude PII', () => {
  assert.match(askRoute, /intent === 'user_profile_sensitive'/);
  assert.match(askRoute, /sensitiveResponse\(userContext\)/);
  assert.match(askRoute, /sensitive_value_sent_to_model: false/);
  assert.match(queries, /if \(intent === 'user_profile_sensitive'\)/);
  assert.doesNotMatch(
    queries.match(/if \(intent === 'user_profile'\)[\s\S]*?\n\s{2}\}/)?.[0] || '',
    /curp|rfc|telefono/i
  );
});

test('public capabilities expire or revoke and never broaden their resource scope', () => {
  assert.equal(
    rules.isUsablePublicCapability(
      'active',
      ['active'],
      new Date(Date.now() + 60_000).toISOString()
    ),
    true
  );
  assert.equal(
    rules.isUsablePublicCapability(
      'active',
      ['active'],
      new Date(Date.now() - 60_000).toISOString()
    ),
    false
  );
  assert.equal(
    rules.isUsablePublicCapability('active', ['active'], null, new Date().toISOString()),
    false
  );
  assert.match(authorization, /DOCUMENT_OUTSIDE_TOKEN_SCOPE/);
  assert.match(authorization, /\.eq\('token_hash', tokenHash\)/);
  assert.match(authorization, /isExpired\(participant\.portal_token_expires_at\)/);
  assert.doesNotMatch(askRoute, /token:\s*publicToken[\s\S]{0,300}CONTEXTO AUTORIZADO/);
  assert.match(askRoute, /redactCapabilityFromRoute\(currentRoute\)/);
  assert.match(security, /segments\[2\] = ':token'/);
});

test('enrollment and mobile public capabilities are resolved only by hash', () => {
  for (const route of publicTokenRoutes) {
    assert.doesNotMatch(route, /\.eq\('token',/);
    assert.match(route, /hashCapabilityToken/);
  }
  assert.match(migration, /WHERE token_hash = p_token/);
  assert.doesNotMatch(migration, /WHERE token = p_token/);
});

test('raw public capabilities are removed from routes and stored text', () => {
  const token = 'A'.repeat(48);
  const value = redaction.redactSensitiveText(`/portal-participante/${token}`);
  assert.doesNotMatch(value, new RegExp(token));
  assert.match(value, /\[REDACTADO\]/);
  assert.match(authorization, /currentRoute\.startsWith\('\/registro-participante\/'\)/);
  assert.match(markRegistered, /portal_token_hash: tokenHash/);
  assert.match(markRegistered, /auth\.admin\.getUserById/);
  assert.doesNotMatch(markRegistered, /\.eq\('portal_token',/);
});

test('evidence and post-validation reject unsupported facts', () => {
  const summary = {
    source_ids: ['source-1'],
    document_ids: ['doc-1'],
    chunk_ids: ['chunk-1'],
    document_titles: ['Contrato Uno'],
    dates: ['2026-09-04'],
    statuses: ['completado'],
    signer_names: ['Ana Pérez'],
    quantities: [1],
    permitted_sensitive_values: [],
  };
  assert.equal(
    evidence.postValidateAnswerAgainstEvidence('El estado: cancelado.', summary),
    evidence.NO_EVIDENCE_RESPONSE
  );
  assert.equal(
    evidence.postValidateAnswerAgainstEvidence('Hay 9 documentos.', summary),
    evidence.NO_EVIDENCE_RESPONSE
  );
  assert.equal(
    evidence.postValidateAnswerAgainstEvidence('El firmante: Persona Inventada.', summary),
    evidence.NO_EVIDENCE_RESPONSE
  );
  assert.equal(
    evidence.postValidateAnswerAgainstEvidence('El estado: completado.', summary),
    'El estado: completado.'
  );
});

test('vector RPCs validate auth and ACL and unsafe grants are revoked', () => {
  assert.match(migration, /auth\.uid\(\) IS NULL/);
  assert.match(migration, /public\.can_access_documento\(c\.document_id\)/);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.match_document_chunks[\s\S]*service_role/
  );
  assert.match(migration, /ai_chunks_document_acl_read/);
  assert.match(migration, /ai_chunks_service_role_all[\s\S]{0,100}TO service_role/);
  assert.match(migration, /ai_logs_service_role_all[\s\S]{0,100}TO service_role/);
  assert.doesNotMatch(migration, /SECURITY DEFINER\s+SET search_path = public/g);
  assert.match(vectorRepairMigration, /SET search_path = ''/);
  assert.match(vectorRepairMigration, /OPERATOR\(public\.<=>\)/);
  assert.match(vectorRepairMigration, /public\.can_access_documento\(c\.document_id\)/);
  assert.match(vectorRepairMigration, /p_allowed_document_ids/);
  assert.match(
    vectorRepairMigration,
    /REVOKE ALL ON FUNCTION public\.match_document_chunks[\s\S]*PUBLIC, anon, service_role/
  );
});

test('audit telemetry has the required safe fields', () => {
  for (const field of [
    'provider',
    'model',
    'prompt_version',
    'route',
    'source_ids',
    'document_ids',
    'chunk_ids',
    'input_tokens',
    'output_tokens',
    'estimated_cost_usd',
    'error_code',
    'has_evidence',
  ]) {
    assert.match(migration, new RegExp(field));
  }
  assert.match(queries, /question: redactSensitiveText\(log\.question/);
  assert.match(queries, /response_text: redactSensitiveText\(log\.responseText/);
  assert.match(chat, /estimated_cost_usd: m\.estimatedCostUsd/);
});
