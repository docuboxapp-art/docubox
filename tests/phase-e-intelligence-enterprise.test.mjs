import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const migration = await read(
  '../supabase/migrations/20260914033655_phase_e_intelligence_enterprise_integrations.sql'
);
const flags = await read('../src/lib/phase-e/feature-flags.ts');
const intelligence = await read('../src/lib/ai/documentIntelligence.ts');
const intentClassifier = await read('../src/lib/ai/luciaIntentClassifier.ts');
const luciaQueries = await read('../src/lib/ai/luciaQueries.ts');
const evidence = await read('../src/lib/ai/evidence.ts');
const contractualSchema = await read('../src/lib/ai/contractIntelligenceSchemas.ts');
const reviewRoute = await read(
  '../src/app/api/ai/document-intelligence/[documentId]/review/route.ts'
);
const automation = await read('../src/lib/collaboration/automation.ts');
const automationContracts = await read('../src/lib/collaboration/automation-contracts.ts');
const bulkRoute = await read('../src/app/api/bulk-signatures/route.ts');
const bulkNew = await read('../src/app/firmas-masivas/nueva/page.tsx');
const bulkList = await read('../src/app/firmas-masivas/page.tsx');
const publicApi = await read('../src/lib/public-api/server.ts');
const sendRoute = await read('../src/app/api/v1/documents/[documentId]/send/route.ts');
const scheduleRoute = await read('../src/app/api/v1/documents/[documentId]/schedule/route.ts');
const webhookRoute = await read('../src/app/api/v1/webhooks/route.ts');
const openApi = await read('../docs/api/openapi-v1.yaml');
const ssoRoute = await read('../src/app/api/organizacion/sso/route.ts');
const ssoCallback = await read('../src/app/auth/sso/callback/route.ts');
const convergence = await read('../docs/architecture/PHASE_E_RUNTIME_CONVERGENCE.md');
const workflowBuilderMigration = await read(
  '../supabase/migrations/20260914054518_auth_e_001_workflow_builder_canonical_runtime.sql'
);

test('Phase E migration is additive and preserves signed artifacts', () => {
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
  assert.doesNotMatch(migration, /UPDATE public\.(?:evidence_packages|nom151|pades)/i);
  assert.doesNotMatch(migration, /ByteRange|signed_pdf|kms_hsm/i);
});

test('contractual analysis is versioned, deterministic and source preserving', () => {
  assert.match(intelligence, /contractual_analysis/);
  assert.match(intelligence, /configurationHash/);
  assert.match(intelligence, /runKey/);
  assert.match(intelligence, /requestedEventId/);
  assert.match(intelligence, /DOCUMENT_NOT_COMPLETED/);
  assert.match(intelligence, /'completado', 'completed'/);
  assert.doesNotMatch(intelligence, /from\('documentos'\)\s*\.update/);
  assert.doesNotMatch(intelligence, /like\('field_key', 'contract_%'\)/);
});

test('contractual schema requires provenance, confidence and evidence', () => {
  assert.match(contractualSchema, /source_kind/);
  assert.match(contractualSchema, /confidence/);
  assert.match(contractualSchema, /evidence_text/);
  assert.match(contractualSchema, /not_found/);
  assert.match(contractualSchema, /explicit/);
  assert.match(contractualSchema, /inference/);
});

test('human review is append-only and authorized', () => {
  assert.match(migration, /ai_document_fact_reviews/);
  assert.match(migration, /can_read_document_intelligence/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.ai_document_fact_reviews/);
  assert.match(reviewRoute, /buildLuciaAuthorizationContext/);
  assert.match(reviewRoute, /authorization\.denied_reason/);
  assert.match(reviewRoute, /reviewed_value/);
  assert.match(reviewRoute, /lucia_contractual_/);
  assert.doesNotMatch(reviewRoute, /\.update\(|\.delete\(/);
});

test('LucIA agreement action reuses the existing automation engine', () => {
  assert.match(automationContracts, /trigger_lucia_contractual/);
  assert.match(automation, /analyzeContractualDocument/);
  assert.match(automation, /requestedEventId/);
  assert.doesNotMatch(automation, /new AutomationEngine/);
});

test('contract queries reuse LucIA retrieval and authorize documents before service reads', () => {
  assert.match(intentClassifier, /contractual_search/);
  assert.match(intentClassifier, /contratos que vencen/);
  assert.match(luciaQueries, /DOCUMENT_INTELLIGENCE_INTENTS/);
  assert.match(luciaQueries, /allowedIds\(authorization, documentId\)/);
  assert.match(luciaQueries, /latestContractualRuns/);
  assert.match(luciaQueries, /contractual_reviews/);
  assert.match(luciaQueries, /PHASE_E_FEATURES\.contractualIntelligence/);
  assert.match(evidence, /case 'contractual_search'/);
});

test('bulk campaign inputs are transactional and server-side', () => {
  assert.match(bulkRoute, /create_bulk_campaign_with_recipients/);
  assert.match(bulkRoute, /validateBulkRecipients/);
  assert.match(migration, /uq_bulk_campaign_source_row_hash/);
  assert.match(migration, /bulk_campaign_imports/);
  assert.doesNotMatch(bulkNew, /localStorage/);
  assert.doesNotMatch(bulkList, /localStorage/);
});

test('bulk execution is implemented under the existing disabled-by-default feature flag', () => {
  assert.match(convergence, /AUTH-E-002/);
  assert.match(convergence, /IMPLEMENTED_UNDER_FEATURE_FLAG/);
  assert.match(migration, /'bulk_signature_runtime',[\s\S]*?FALSE, 0, '\{\}'/);
});

test('public API hashes credentials, scopes access and fails closed on limiter outage', () => {
  assert.match(publicApi, /createHash\('sha256'\)/);
  assert.match(publicApi, /insufficient_scope/);
  assert.match(publicApi, /consumeServerRateLimit/);
  assert.match(publicApi, /rate_limit_unavailable/);
  assert.match(publicApi, /\.eq\('workspace_id', context\.credential\.workspace_id\)/);
});

test('public API writes are idempotent and failed attempts are retryable', () => {
  assert.match(publicApi, /canonicalize/);
  assert.match(publicApi, /status === 'failed'/);
  assert.match(publicApi, /staleProcessing/);
  assert.match(publicApi, /failPublicApiIdempotency/);
  assert.match(sendRoute, /failPublicApiIdempotency/);
  assert.match(scheduleRoute, /failPublicApiIdempotency/);
  assert.match(webhookRoute, /failPublicApiIdempotency/);
});

test('public API exposes a versioned documented surface using existing services', () => {
  assert.match(openApi, /openapi: 3\.1\.0/);
  assert.match(openApi, /url: \/api\/v1/);
  assert.match(openApi, /\/documents:/);
  assert.match(openApi, /\/participants/);
  assert.match(openApi, /\/send/);
  assert.match(openApi, /\/schedule/);
  assert.match(openApi, /\/evidence/);
  assert.match(openApi, /\/webhooks:/);
  assert.match(sendRoute, /deliverDocumentInvitations/);
});

test('SSO configuration uses existing auth and one-time hashed test state', () => {
  assert.match(ssoRoute, /authorizeOrganizationRequest/);
  assert.match(ssoRoute, /requireOrganizationReauthentication/);
  assert.match(ssoRoute, /PHASE_E_FEATURES\.organizationSso/);
  assert.match(ssoRoute, /createHash\('sha256'\)/);
  assert.match(ssoCallback, /exchangeCodeForSession/);
  assert.match(ssoCallback, /PHASE_E_FEATURES\.organizationSso/);
  assert.match(ssoCallback, /expected_provider_id/);
  assert.match(ssoCallback, /workspace_members/);
  assert.match(ssoCallback, /status', 'active'/);
  assert.doesNotMatch(migration, /sso.*secret[^\n]*TEXT/i);
});

test('SSO JIT and broad enforcement are not overstated', () => {
  assert.match(ssoRoute, /jit_provisioning: false/);
  assert.match(convergence, /AUTH-E-003/);
  assert.match(convergence, /Enforcement and JIT provisioning remain disabled/);
});

test('all Phase E feature flags remain disabled by default', () => {
  for (const flag of [
    'lucia_contractual',
    'bulk_signature_runtime',
    'organization_sso',
    'public_api_v1',
    'workflow_builder',
  ]) {
    assert.match(migration, new RegExp(`'${flag}',[\\s\\S]*?FALSE, 0`));
    assert.match(flags, new RegExp(flag));
  }
  assert.match(migration, /flag_key,[\s\S]*?global_enabled,[\s\S]*?rollout_percentage/);
  assert.match(flags, /\.select\('global_enabled,rollout_percentage'\)/);
  assert.match(flags, /\.eq\('flag_key', featureKey\)/);
});

test('Workflow Builder resolves AUTH-E-001 on the canonical runtime', () => {
  assert.match(convergence, /AUTH-E-001/);
  assert.match(convergence, /workflow_flows/);
  assert.match(convergence, /organization_workflow_instances/);
  assert.match(convergence, /ONE_CANONICAL_RUNTIME: YES/);
  assert.match(migration, /'workflow_builder', 'Workflow Builder'/);
  assert.match(workflowBuilderMigration, /advance_due_organization_workflow_steps/);
  assert.doesNotMatch(
    workflowBuilderMigration,
    /CREATE TABLE.*(?:builder_workflow_instances|workflow_engine_v[23])/is
  );
});
