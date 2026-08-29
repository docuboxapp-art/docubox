import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const provider = await readFile('src/lib/nom151/provider.ts', 'utf8');
const trust = await readFile('src/lib/nom151/trust.ts', 'utf8');
const service = await readFile('src/lib/nom151/service.ts', 'utf8');
const generateRoute = await readFile('src/app/api/nom151/generate/route.ts', 'utf8');
const downloadRoute = await readFile('src/app/api/nom151/download/route.ts', 'utf8');
const ui = await readFile('src/app/visor-documento/[id]/page.tsx', 'utf8');
const migration = await readFile(
  'supabase/migrations/20260829023344_nom151_audit_alignment.sql',
  'utf8'
);

test('NOM-151 is behind a server-side provider and sends no participant identity data', () => {
  assert.match(provider, /export interface Nom151Provider/);
  assert.match(provider, /class NubariumNom151Provider/);
  assert.match(provider, /body: JSON\.stringify\(\{ pdf:/);
  assert.doesNotMatch(provider, /body: JSON\.stringify\(\{[^}]*firmantes/);
  assert.match(trust, /NOM151_ENVIRONMENT/);
});

test('issuance requires exact verified PAdES-B-T evidence', () => {
  assert.match(service, /eq\('pades_profile', 'PAdES-B-T'\)/);
  assert.match(service, /eq\('pdf_signature_status', 'valid'\)/);
  assert.match(service, /eq\('timestamp_status', 'valid'\)/);
  assert.match(service, /eq\('verification_status', 'valid'\)/);
  assert.match(service, /NOM151_DIGEST_MISMATCH/);
  assert.match(generateRoute, /issueNom151ForVerifiedPadesBt/);
});

test('artifacts are immutable, linked and independently revalidatable', () => {
  assert.match(service, /upsert: false/);
  assert.match(service, /document_certification_id: pades\.id/);
  assert.match(service, /document_version_id: pades\.document_version_id/);
  assert.match(service, /verification_status: 'verified'/);
  assert.match(service, /export async function revalidateNom151/);
  assert.match(downloadRoute, /eq\('verification_status', 'verified'\)/);
});

test('schema preserves historical records and enforces idempotency and tenant RLS', () => {
  assert.doesNotMatch(migration, /drop table|truncate table/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS document_certification_id/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_nom151_verified_artifact_request/);
  assert.match(migration, /public\.can_access_documento\(documento_id\)/);
  assert.match(migration, /workspace_members/);
});

test('UI waits for verified PAdES-B-T and does not call unknown environment production', () => {
  assert.match(ui, /const padesBtVerified = padesVerified/);
  assert.match(ui, /padesBtVerified &&/);
  assert.match(ui, /NOM-151 no productiva/);
  assert.match(ui, /production_trusted/);
});
