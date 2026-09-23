import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const migration = await read(
  '../supabase/migrations/20260913234153_auth_003_atomic_participant_completion.sql'
);
const historicalReferenceBackfill = await read(
  '../supabase/migrations/20260920210443_backfill_historical_participant_reference_ids.sql'
);
const committedMetadataFix = await read(
  '../supabase/migrations/20260920223942_fix_atomic_participant_completion_metadata.sql'
);
const completionRetryFix = await read(
  '../supabase/migrations/20260920225409_repair_completion_retry_signature_binding.sql'
);
const completionRoute = await read('../src/app/api/firma/completion/route.ts');
const finalizeEvidence = await read('../src/app/api/firma/finalize-evidence/route.ts');
const signingPage = await read('../src/app/firmar-documento/[id]/page.tsx');

test('AUTH-003 creates one server-only operational claim ledger', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.participant_completion_attempts/);
  assert.match(migration, /participant_completion_one_active_idx[\s\S]*WHERE status = 'claimed'/);
  assert.match(migration, /UNIQUE\(document_id, idempotency_key\)/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.participant_completion_attempts FROM PUBLIC, anon, authenticated/
  );
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE[\s\S]*TO service_role/);
  assert.match(migration, /CREATE TRIGGER protect_committed_participation_response/);
  assert.match(migration, /CREATE TRIGGER enforce_atomic_participant_completion/);
  assert.match(migration, /ATOMIC_PARTICIPANT_COMPLETION_REQUIRED/);
});

test('claim is document, participant, tenant, version and kiosk scoped', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.claim_participant_completion/);
  assert.match(migration, /FROM public\.documentos document[\s\S]*FOR UPDATE/);
  assert.match(migration, /reference\.workspace_id IS DISTINCT FROM v_document\.workspace_id/);
  assert.match(
    migration,
    /participant ->> 'participant_ref_id' = p_participant_reference_id::TEXT/
  );
  assert.match(migration, /ORDER BY version\.version_number DESC/);
  assert.match(migration, /session\.status = 'started'/);
  assert.match(migration, /session\.expires_at > CURRENT_TIMESTAMP/);
});

test('operational commit couples evidence, response, JSONB state, kiosk and events', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.commit_participant_completion/);
  assert.match(migration, /evidence\.evidence_role = 'FINAL_SIGNATURE'/);
  assert.match(
    migration,
    /evidence\.document_version_id IS NOT DISTINCT FROM v_attempt\.document_version_id/
  );
  assert.match(migration, /INSERT INTO public\.participation_responses/);
  assert.match(migration, /UPDATE public\.documentos[\s\S]*SET participantes = v_participants/);
  assert.match(migration, /UPDATE public\.in_person_signing_sessions session/);
  assert.match(migration, /'participant\.completion_committed'/);
  assert.match(migration, /'workflow\.advance_requested'/);
  assert.match(migration, /INSERT INTO public\.document_activity_log/);
});

test('commit is idempotent and rejects terminal or mismatched completion', () => {
  assert.match(migration, /IF v_attempt\.status = 'committed' THEN/);
  assert.match(migration, /'idempotent', true/);
  assert.match(migration, /COMPLETION_DOCUMENT_NOT_ELIGIBLE/);
  assert.match(migration, /COMPLETION_DOCUMENT_VERSION_MISMATCH/);
  assert.match(migration, /COMPLETION_EVIDENCE_SCOPE_INVALID/);
  assert.match(migration, /COMPLETION_PARTICIPANT_NOT_ELIGIBLE/);
  assert.match(migration, /COMMITTED_PARTICIPATION_RESPONSE_IMMUTABLE/);
  assert.match(migration, /PARTICIPATION_COMPLETION_SERVER_ONLY/);
});

test('phase D can append only server-owned actor metadata after atomic commit', () => {
  assert.match(committedMetadataFix, /current_user = 'service_role'/);
  assert.match(committedMetadataFix, /effective_actor_user_id/);
  assert.match(committedMetadataFix, /delegation_id/);
  assert.match(committedMetadataFix, /witness_completed/);
  assert.match(
    committedMetadataFix,
    /to_jsonb\(NEW\) - v_server_metadata_columns[\s\S]*to_jsonb\(OLD\) - v_server_metadata_columns/
  );
  assert.match(committedMetadataFix, /COMMITTED_PARTICIPATION_RESPONSE_IMMUTABLE/);
});

test('an active uncommitted retry can reconcile its signature method', () => {
  assert.match(completionRetryFix, /v_attempt\.status = 'claimed'/);
  assert.match(
    completionRetryFix,
    /v_attempt\.signature_method IS DISTINCT FROM NULLIF\(v_method, ''\)/
  );
  assert.match(completionRetryFix, /v_attempt\.signature_evidence_id IS NULL/);
  assert.match(completionRetryFix, /v_attempt\.participation_response_id IS NULL/);
  assert.match(completionRetryFix, /SET signature_method = NULLIF\(v_method, ''\)/);
});

test('completion API authenticates, authorizes and rate limits before service-role RPCs', () => {
  const authentication = completionRoute.indexOf('await requireCompletionAuthentication(request)');
  const payloadParsing = completionRoute.indexOf('await request.json()');
  assert.ok(authentication > -1 && payloadParsing > authentication);
  assert.match(completionRoute, /requireDocumentAccess\(request, documentId\)/);
  assert.match(completionRoute, /consumeServerRateLimit/);
  assert.match(completionRoute, /document_participant_references/);
  assert.match(completionRoute, /assertKioskDocumentScope/);
  assert.match(completionRoute, /service\.rpc\('claim_participant_completion'/);
  assert.match(completionRoute, /service\.rpc\('commit_participant_completion'/);
});

test('historical participants receive the stable reference required by atomic completion', () => {
  assert.match(historicalReferenceBackfill, /participant_ref_id/);
  assert.match(historicalReferenceBackfill, /document_participant_references/);
  assert.match(historicalReferenceBackfill, /documentos_updated_at/);
  assert.match(historicalReferenceBackfill, /HISTORICAL_PARTICIPANT_REFERENCE_BACKFILL_INCOMPLETE/);
});

test('completion API classifies structured Supabase errors by their message code', () => {
  assert.match(completionRoute, /typeof error === 'object' && 'message' in error/);
  assert.match(completionRoute, /COMPLETION_PARTICIPANT_NOT_ELIGIBLE/);
});

test('Click & Sign evidence reuses the operational attempt identity', () => {
  assert.match(finalizeEvidence, /requestedAttemptId/);
  assert.match(finalizeEvidence, /\.eq\('capture_id', signatureId\)/);
  assert.match(finalizeEvidence, /SIGNATURE_ATTEMPT_CONFLICT/);
  assert.match(finalizeEvidence, /capture_id: signatureId/);
  assert.match(finalizeEvidence, /signature_id: signatureId/);
});

test('autograph retry preserves its capture and supersedes an uncommitted binding', () => {
  assert.match(signingPage, /persisted\.autographEvidenceId/);
  assert.match(signingPage, /activeAutographEvidenceId/);
  assert.match(signingPage, /autographEvidenceId: evidenceId/);
  assert.match(signingPage, /completionSignedAt: null/);
  assert.match(finalizeEvidence, /candidate\.data\.signature_id \|\| signatureId/);
  assert.match(finalizeEvidence, /effectiveSignatureId = randomUUID\(\)/);
  assert.match(finalizeEvidence, /SUPERSEDED_BY_SIGNATURE_RETRY/);
});

test('signing flow orders claim, evidence, commit, routing and final certification', () => {
  const claim = signingPage.indexOf("action: 'claim'");
  const evidence = signingPage.indexOf("fetch('/api/firma/finalize-evidence'", claim);
  const commit = signingPage.indexOf("action: 'commit'", evidence);
  const routing = signingPage.indexOf("fetch('/api/documentos/advance-participation'", commit);
  const seal = signingPage.indexOf('/seal-signatures', commit);
  assert.ok(
    claim > -1 && evidence > claim && commit > evidence && routing > commit && seal > commit
  );
  assert.doesNotMatch(signingPage.slice(claim, seal), /rpc\('update_participante_(?:sub_)?estado'/);
});
