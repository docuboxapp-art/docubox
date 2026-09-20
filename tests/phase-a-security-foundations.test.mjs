import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const advance = await read('../src/app/api/documentos/advance-participation/route.ts');
const smsRoute = await read('../src/app/api/notifications/sms/route.ts');
const notificationTestRoute = await read('../src/app/api/test-notifications/route.ts');
const smsService = await read('../src/lib/smsNotifications.ts');
const eventService = await read('../src/lib/documents/operational-events.ts');
const templateRoute = await read('../src/app/api/plantillas/[id]/route.ts');
const migration = await read(
  '../supabase/migrations/20260913180815_phase_a_security_foundations.sql'
);
const workflowDoc = await read('../docs/architecture/PHASE_A_WORKFLOW_AND_SIGNING_GROUPS.md');

test('advance participation proves document access and actor eligibility', () => {
  assert.match(advance, /requireDocumentAccess\(req, documentoId\)/);
  assert.match(advance, /actorCanAdvance/);
  assert.match(advance, /actorParticipant\.visible !== false/);
  assert.match(advance, /'false', '0', 'no', 'revoked', 'suspended', 'removed', 'hidden'/);
  assert.doesNotMatch(advance, /access\.role === 'AUTHORIZED'/);
  assert.match(advance, /tiene_vencimiento/);
  assert.match(advance, /\['completado', 'cancelado', 'rechazado', 'vencido', 'expirado'\]/);
});

test('advance participation is optimistic and does not expose an already active turn twice', () => {
  assert.match(advance, /\.eq\('participantes', participantes\)/);
  assert.match(advance, /\.eq\('participantes', updatedParticipantes\)/);
  assert.match(advance, /duplicate_or_stale/);
  assert.match(advance, /participant\.visible !== true/);
  assert.match(advance, /workflow\.participation_advanced/);
});

test('participant state RPCs bind SECURITY DEFINER updates to the authenticated actor', () => {
  for (const functionName of ['update_participante_sub_estado', 'update_participante_estado']) {
    assert.match(migration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}`));
  }
  assert.match(migration, /actor_id UUID := auth\.uid\(\)/);
  assert.match(migration, /actor_email TEXT := lower\(trim\(COALESCE\(auth\.jwt\(\) ->> 'email'/);
  assert.match(migration, /participant_update_forbidden/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.update_participante_sub_estado[\s\S]*FROM PUBLIC, anon/
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.update_participante_estado[\s\S]*FROM PUBLIC, anon/
  );
});

test('internal SMS diagnostics reuse the hardened service and platform audit', () => {
  assert.match(notificationTestRoute, /isInternalAdminRequest\(request\)/);
  assert.match(notificationTestRoute, /consumeServerRateLimit/);
  assert.match(notificationTestRoute, /sendSms\(/);
  assert.match(notificationTestRoute, /platform_audit_events/);
  assert.doesNotMatch(notificationTestRoute, /ENVIA_SMS_(?:TOKEN|PROJECT|TEMPLATE_ID)\s*=/);
  assert.doesNotMatch(notificationTestRoute, /debugUrl/);
});

test('SMS has no credential fallback and fails closed when configuration is absent', () => {
  assert.doesNotMatch(smsService, /ENVIA_SMS_TOKEN\s*=\s*process\.env\.ENVIA_SMS_TOKEN\s*\|\|/);
  assert.doesNotMatch(smsService, /ENVIA_SMS_PROJECT\s*=\s*process\.env\.ENVIA_SMS_PROJECT\s*\|\|/);
  assert.match(smsService, /throw new SmsConfigurationError/);
  assert.match(smsService, /\^52\\d\{10\}\$/);
});

test('SMS endpoint is document-bound, rate-limited and cannot trust client participant arrays', () => {
  assert.match(smsRoute, /requireDocumentAccess\(req, documentId, \{ requireEdit: true \}\)/);
  assert.match(smsRoute, /consumeServerRateLimit/);
  assert.match(smsRoute, /canonicalParticipants/);
  assert.doesNotMatch(smsRoute, /const \{ participants/);
  assert.match(smsRoute, /recipient_sha256/);
  assert.match(smsRoute, /notification\.sms_(?:failed|sent)/);
});

test('stable participant identity preserves JSONB and synchronizes an additive bridge', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.document_participant_references/);
  assert.match(migration, /participant_ref_id/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OF participantes ON public\.documentos/);
  assert.match(
    migration,
    /AFTER INSERT OR UPDATE OF participantes, workspace_id ON public\.documentos/
  );
  assert.match(migration, /ON CONFLICT \(id\) DO UPDATE/);
  assert.doesNotMatch(migration, /DROP COLUMN\s+participantes/i);
  assert.doesNotMatch(migration, /SET participantes = document\.participantes/i);
  assert.match(migration, /Historical rows are seeded in the bridge without rewriting their JSONB/);
});

test('participant and event tables are tenant-scoped and browser read-only', () => {
  assert.match(
    migration,
    /document_participant_references_read[\s\S]*can_access_documento\(document_id\)/
  );
  assert.match(
    migration,
    /document_operational_events_read[\s\S]*can_access_documento\(document_id\)/
  );
  assert.match(
    migration,
    /REVOKE ALL ON public\.document_participant_references FROM PUBLIC, anon, authenticated/
  );
  assert.match(
    migration,
    /REVOKE ALL ON public\.document_operational_events FROM PUBLIC, anon, authenticated/
  );
  assert.match(eventService, /event_key: eventKey/);
  assert.match(migration, /UNIQUE\(document_id, event_key\)/);
  assert.match(migration, /enforce_document_participant_reference_scope/);
  assert.match(migration, /enforce_document_operational_event_scope/);
  assert.match(migration, /document_operational_event_participant_scope_mismatch/);
});

test('published templates are immutable in API and database while version rows remain separate', () => {
  assert.match(templateRoute, /published_template_is_immutable/);
  assert.match(migration, /protect_published_template_immutability/);
  assert.match(templateRoute, /source_template_id: source\.id/);
  assert.match(migration, /lower\(COALESCE\(NEW\.estado, ''\)\) = 'archived'/);
});

test('future feature flags reuse the platform control plane and remain disabled', () => {
  for (const flag of [
    'in_person_signing',
    'scheduled_sending',
    'agreement_actions',
    'signature_delegation',
    'advanced_signing_groups',
  ]) {
    assert.match(migration, new RegExp(`\\('${flag}'[\\s\\S]{0,180}false, 0`));
  }
});

test('workflow and signing group boundaries are documented without creating another engine', () => {
  assert.match(workflowDoc, /workflow_flows/);
  assert.match(workflowDoc, /organization_workflow_instances/);
  assert.match(workflowDoc, /ANY_ONE/);
  assert.match(workflowDoc, /N_OF_M/);
  assert.match(workflowDoc, /No workflow table is removed, converged or migrated/);
});
