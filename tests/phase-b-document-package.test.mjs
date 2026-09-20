import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const migration = await read('../supabase/migrations/20260913213000_phase_b_document_packages.sql');
const packageRoute = await read('../src/app/api/documentos/[documentId]/package/route.ts');
const fileRoute = await read(
  '../src/app/api/documentos/[documentId]/package/resources/[resourceId]/file/route.ts'
);
const requirementUpload = await read(
  '../src/app/api/documentos/[documentId]/package/requirements/[requirementId]/upload/route.ts'
);
const ownerSessionRoute = await read(
  '../src/app/api/documentos/[documentId]/in-person-sessions/route.ts'
);
const kioskRoute = await read('../src/app/api/firma-presencial/[token]/route.ts');
const kioskPage = await read('../src/app/firma-presencial/[token]/page.tsx');
const middleware = await read('../src/middleware.ts');
const sendRoute = await read('../src/app/api/documentos/enviar/route.ts');

test('package tables are additive and preserve historical documentos JSONB', () => {
  for (const table of [
    'document_packages',
    'document_package_resources',
    'participant_document_requirements',
    'document_resource_visibility',
    'document_resource_interactions',
    'in_person_signing_sessions',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  }
  assert.doesNotMatch(migration, /ALTER TABLE public\.documentos\s+DROP COLUMN/i);
  assert.doesNotMatch(migration, /UPDATE public\.documentos\s+SET participantes/i);
});

test('resource visibility is participant-bound and defaults to legacy access only without rules', () => {
  assert.match(migration, /is_current_document_participant_reference/);
  assert.match(migration, /can_view_document_package_resource/);
  assert.match(migration, /NOT EXISTS \([\s\S]*document_resource_visibility configured/);
  assert.match(migration, /visible\.participant_reference_id = participant\.id/);
  assert.match(packageRoute, /canUserViewPackageResource/);
  assert.match(fileRoute, /canUserViewPackageResource/);
  assert.match(fileRoute, /Recurso no encontrado/);
});

test('new files reuse private documents storage and validate magic bytes server-side', () => {
  assert.match(packageRoute, /validatePackageFile/);
  assert.match(requirementUpload, /validatePackageFile/);
  assert.match(packageRoute, /storageBucket: 'documents'/);
  assert.match(requirementUpload, /storageBucket: 'documents'/);
  assert.doesNotMatch(packageRoute, /getPublicUrl/);
  assert.doesNotMatch(requirementUpload, /getPublicUrl/);
  assert.match(fileRoute, /readDocumentStorageObject/);
});

test('participant requirement upload cannot target another participant', () => {
  assert.match(requirementUpload, /resolveParticipantReference/);
  assert.match(requirementUpload, /\.eq\('participant_reference_id', participant\.id\)/);
  assert.match(requirementUpload, /consumeServerRateLimit/);
  assert.match(requirementUpload, /\['accepted', 'waived'\]/);
});

test('in-person token is hashed, expiring, one-purpose and replay protected', () => {
  assert.match(ownerSessionRoute, /randomBytes\(32\)/);
  assert.match(ownerSessionRoute, /token_hash: sha256\(rawToken\)/);
  assert.doesNotMatch(migration, /raw_token|token_plaintext/i);
  assert.match(migration, /CHECK \(expires_at > created_at\)/);
  assert.match(migration, /in_person_sessions_one_active_participant_idx/);
  assert.match(kioskRoute, /\.eq\('status', 'created'\)/);
  assert.match(kioskRoute, /\.is\('started_at', null\)/);
  assert.match(kioskRoute, /SESSION_REPLAY_BLOCKED/);
});

test('handoff closes the owner local session before entering participant portal', () => {
  assert.match(kioskPage, /auth\.signOut\(\{ scope: 'local' \}\)/);
  assert.match(kioskPage, /window\.location\.replace\(body\.data\.portalPath\)/);
  assert.match(kioskPage, /deberá iniciar sesión nuevamente/);
  assert.doesNotMatch(kioskPage, /AppLayout/);
  assert.match(middleware, /'\/firma-presencial\/'/);
});

test('in-person completion follows canonical participant state without changing crypto', () => {
  assert.match(migration, /complete_in_person_session_from_participant_state/);
  assert.match(migration, /in_person_session\.completed/);
  assert.match(migration, /participant_reference_id = v_reference/);
  assert.doesNotMatch(migration, /PAdES|NOM151|NOM-151|TSA|KMS|sealed_pdf/i);
});

test('Legal Hold preserves package resources and participant requirements', () => {
  assert.match(migration, /prevent_legal_hold_package_deletion/);
  assert.match(migration, /has_active_document_legal_hold/);
  assert.match(migration, /protect_package_resource_legal_hold/);
  assert.match(migration, /protect_requirement_legal_hold/);
});

test('create-document persists delivery, requirements and resource visibility additively', () => {
  assert.match(sendRoute, /delivery_mode/);
  assert.match(sendRoute, /participant\.requirements/);
  assert.match(sendRoute, /visible_resource_ids/);
  assert.match(sendRoute, /ensureDocumentPackage/);
  assert.match(sendRoute, /document_participant_references/);
  assert.match(sendRoute, /document_resource_visibility/);
  assert.match(sendRoute, /p\.delivery_mode === 'in_person'/);
});

test('required package interactions block participation until completed', () => {
  assert.match(packageRoute, /read_required/);
  assert.match(packageRoute, /acceptance_required/);
  assert.match(packageRoute, /required_upload/);
  assert.match(packageRoute, /readiness: \{ ready: blockers\.length === 0, blockers \}/);
  assert.match(packageRoute, /Consulta el documento antes de registrar su aceptación/);
});

test('only in-person participants can complete a handoff session', () => {
  assert.match(migration, /participant ->> 'delivery_mode'/);
  assert.match(migration, /<> 'in_person'/);
});

test('Phase B feature flags remain disabled by default', () => {
  for (const flag of [
    'document_package_resources',
    'participant_document_requirements',
    'granular_participant_visibility',
  ]) {
    assert.match(migration, new RegExp(`\\('${flag}'[\\s\\S]{0,220}false, 0`));
  }
});
