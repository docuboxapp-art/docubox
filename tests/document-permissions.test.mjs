import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/20260909073142_document_access_permissions.sql', import.meta.url),
  'utf8'
);
const permissionsRoute = readFileSync(
  new URL('../src/app/api/documentos/[documentId]/permissions/route.ts', import.meta.url),
  'utf8'
);
const viewerRoute = readFileSync(
  new URL('../src/app/api/documentos/[documentId]/viewer-file/route.ts', import.meta.url),
  'utf8'
);
const editRoute = readFileSync(
  new URL('../src/app/api/documentos/[documentId]/edit/route.ts', import.meta.url),
  'utf8'
);

test('document access permissions are private and grant only explicit capabilities', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.document_access_permissions/);
  assert.match(migration, /ALTER TABLE public\.document_access_permissions ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.document_access_permissions FROM anon, authenticated/);
  assert.match(migration, /CHECK \(access_level IN \('view', 'edit'\)\)/);
  assert.match(migration, /OR public\.has_document_access_permission\(d\.id, 'view'\)/);
});

test('permission API prevents invited readers from escalating or managing another grant', () => {
  assert.match(permissionsRoute, /!access\.canManage && \(accessLevel !== 'view' \|\| canInvite\)/);
  assert.match(permissionsRoute, /existing\.created_by !== access\.user\.id/);
  assert.match(permissionsRoute, /target\.created_by !== access\.user\.id \|\| target\.access_level !== 'view' \|\| target\.can_invite/);
  assert.match(permissionsRoute, /DOCUMENT_PERMISSION_GRANTED/);
  assert.match(permissionsRoute, /DOCUMENT_PERMISSION_REVOKED/);
});

test('viewer and editor routes enforce the corresponding capability server-side', () => {
  assert.match(viewerRoute, /document_access_permissions/);
  assert.match(viewerRoute, /!owner && !participant && !workspaceManager && !explicitPermission/);
  assert.match(editRoute, /requireEdit: true/);
  assert.match(editRoute, /ALLOWED_DOCUMENT_FIELDS/);
});
