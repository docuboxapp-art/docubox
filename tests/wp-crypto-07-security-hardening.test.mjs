import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = new URL(
  '../supabase/migrations/20260821210000_wp_crypto_07_security_hardening.sql',
  import.meta.url,
);
const sealPath = new URL('../supabase/functions/seal-pdf/index.ts', import.meta.url);
const legacySigningPath = new URL('../supabase/functions/sign-pdf-vps/index.ts', import.meta.url);
const corsPath = new URL('../supabase/functions/_shared/cors.ts', import.meta.url);
const organizationServerPath = new URL('../src/lib/organization/server.ts', import.meta.url);
const inventoryPath = new URL('../docs/crypto/wp-crypto-07-security-definer-inventory.md', import.meta.url);
const resultPath = new URL('../docs/crypto/wp-crypto-07-result.md', import.meta.url);

test('WP-07 migration restricts SECURITY DEFINER search paths and helper execution', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /ALTER FUNCTION %s SET search_path TO pg_catalog, public/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.is_workspace_member\(uuid\) FROM PUBLIC/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.is_workspace_member\(uuid\) TO authenticated, service_role/);
  assert.match(sql, /REVOKE CREATE ON SCHEMA public FROM PUBLIC/);
});

test('certification and evidence reads require the same document tenant boundary', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /certification_workspace_member_read/);
  assert.match(sql, /DROP POLICY IF EXISTS certification_authorized_read/);
  assert.match(sql, /d\.workspace_id = document_certifications\.workspace_id/);
  assert.match(sql, /document_certifications\.tenant_id = d\.workspace_id/);
  assert.match(sql, /public\.is_workspace_member\(d\.workspace_id\)/);
  assert.match(sql, /evidence_manifests_workspace_member_read/);
  assert.match(sql, /DROP POLICY IF EXISTS evidence_manifests_authorized_read/);
  assert.match(sql, /timestamp_records_workspace_member_read/);
  assert.match(sql, /DROP POLICY IF EXISTS timestamp_records_authorized_read/);
});

test('certification artifacts cannot be updated or deleted by authenticated users', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /certification_artifacts_authenticated_update/);
  assert.match(sql, /certification_artifacts_authenticated_delete/);
  assert.match(sql, /bucket_id <> 'certification-artifacts'/);
});

test('visual sealing ignores a browser supplied file URL and does not overwrite artifacts', async () => {
  const source = await readFile(sealPath, 'utf8');
  assert.match(source, /file_url: ignoredClientFileUrl/);
  assert.match(source, /void ignoredClientFileUrl/);
  assert.match(source, /resolveAuthorizedStoragePath\(sourceDocument, supabaseUrl\)/);
  assert.match(source, /SEALED_PDF_EXISTS/);
  assert.match(source, /upsert: false/);
  assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, ''), /fetch\(file_url\)/);
});

test('legacy signing derives the signer from the authenticated participant and preserves signed bytes', async () => {
  const source = await readFile(legacySigningPath, 'utf8');
  assert.match(source, /participantForUser\(docData\.participantes, user\)/);
  assert.match(source, /SIGNER_NOT_AUTHORIZED/);
  assert.match(source, /SIGNER_IDENTITY_MISMATCH/);
  assert.match(source, /WORKSPACE_REQUIRED/);
  assert.match(source, /SIGNED_PDF_EXISTS/);
  assert.match(source, /upsert: false/);
  assert.doesNotMatch(source, /\.from\("workspace_members"\)/);
});

test('privileged certificate routes use a restricted origin policy instead of wildcard CORS', async () => {
  const [seal, signing, cors] = await Promise.all([
    readFile(sealPath, 'utf8'),
    readFile(legacySigningPath, 'utf8'),
    readFile(corsPath, 'utf8'),
  ]);
  assert.doesNotMatch(seal, /Access-Control-Allow-Origin:\s*['"]\*['"]/);
  assert.doesNotMatch(signing, /Access-Control-Allow-Origin:\s*['"]\*['"]/);
  assert.match(seal, /isAllowedOrigin\(req\.headers\.get\('Origin'\)\)/);
  assert.match(signing, /isAllowedOrigin\(req\.headers\.get\('Origin'\)\)/);
  assert.match(cors, /DOCUBOX_ALLOWED_ORIGINS/);
  assert.match(cors, /Vary: 'Origin'/);
});

test('organization encryption cannot fall back to the service role credential', async () => {
  const source = await readFile(organizationServerPath, 'utf8');
  const functionSource = source.slice(source.indexOf('export function encryptOrganizationSecret'));
  assert.match(functionSource, /ORGANIZATION_CREDENTIAL_ENCRYPTION_KEY/);
  assert.doesNotMatch(functionSource, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('the privileged-function inventory and deployment checklist are documented', async () => {
  const [inventory, result] = await Promise.all([
    readFile(inventoryPath, 'utf8'),
    readFile(resultPath, 'utf8'),
  ]);
  assert.match(inventory, /pg_proc/);
  assert.match(inventory, /SECURITY DEFINER/);
  assert.match(inventory, /owner/);
  assert.match(inventory, /search_path/);
  assert.match(result, /cross-tenant/);
  assert.match(result, /DOCUBOX_ALLOWED_ORIGINS/);
});
