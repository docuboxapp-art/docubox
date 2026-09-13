import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260913013624_document_view_access_protection_v2.sql',
  'utf8',
);
const viewerFile = await readFile(
  'src/app/api/documentos/[documentId]/viewer-file/route.ts',
  'utf8',
);
const unlock = await readFile(
  'src/app/api/documentos/[documentId]/view-access/unlock/route.ts',
  'utf8',
);
const internalSource = await readFile(
  'src/app/api/documentos/desde-docubox/archivo/route.ts',
  'utf8',
);
const publicFile = await readFile(
  'src/app/api/verificacion/documentos/[identifier]/archivo/route.ts',
  'utf8',
);

test('database stores only a password hash and revocable opaque unlock grants', () => {
  assert.match(migration, /extensions\.crypt\(p_code, v_hash\)/);
  assert.match(migration, /document_view_access_sessions/);
  assert.match(migration, /auth_session_id TEXT NOT NULL/);
  assert.match(migration, /protection_revision INTEGER NOT NULL/);
  assert.match(migration, /token_hash TEXT NOT NULL UNIQUE/);
  assert.match(migration, /PROTECTION_RECONFIGURED/);
  assert.match(migration, /PROTECTION_DISABLED/);
  assert.match(migration, /codigo_acceso = NULL, codigo_acceso_hash = NULL/);
});

test('failed attempts escalate to 10, 30 and 60 minute lockouts', () => {
  assert.match(migration, /v_failed_count >= 15 THEN 3600/);
  assert.match(migration, /v_failed_count >= 10 THEN 1800/);
  assert.match(migration, /v_failed_count >= 5 THEN 600/);
  assert.match(migration, /VIEW_ACCESS_TEMPORARILY_LOCKED/);
});

test('viewer and authenticated internal source require the shared content guard', () => {
  assert.match(viewerFile, /requireDocumentContentAccess\(request, documentId\)/);
  assert.match(internalSource, /requireDocumentContentAccess\(request, documentId\)/);
  assert.doesNotMatch(viewerFile, /requiresAccessCode && !owner/);
});

test('unlock is bound to tenant, user, auth session and an opaque cookie', () => {
  assert.match(unlock, /p_tenant_id:/);
  assert.match(unlock, /p_auth_session_id:/);
  assert.match(unlock, /p_token_hash: opaque\.tokenHash/);
  assert.match(unlock, /httpOnly: true/);
  assert.match(unlock, /sameSite: 'strict'/);
});

test('public file delivery cannot bypass an enabled view code', () => {
  assert.match(publicFile, /codigo_acceso_enabled/);
  assert.match(publicFile, /ACCESS_CODE_REQUIRED/);
  assert.match(publicFile, /status: 423/);
});
