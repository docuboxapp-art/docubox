import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/20260909073142_document_access_permissions.sql', import.meta.url),
  'utf8'
);
const completedAccessMigration = readFileSync(
  new URL('../supabase/migrations/20260924100726_completed_document_additional_access.sql', import.meta.url),
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
const contentAccess = readFileSync(
  new URL('../src/lib/security/document-content-access.ts', import.meta.url),
  'utf8'
);
const documentAccess = readFileSync(
  new URL('../src/lib/security/document-access.ts', import.meta.url),
  'utf8'
);

test('document access permissions are private and grant only explicit capabilities', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.document_access_permissions/);
  assert.match(migration, /ALTER TABLE public\.document_access_permissions ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.document_access_permissions FROM anon, authenticated/);
  assert.match(migration, /CHECK \(access_level IN \('view', 'edit'\)\)/);
  assert.match(migration, /OR public\.has_document_access_permission\(d\.id, 'view'\)/);
});

test('completed document access is owner-managed, read-only and non-transitive', () => {
  assert.match(completedAccessMigration, /CHECK \(access_level IN \('view', 'download', 'evidence'\)\)/);
  assert.match(completedAccessMigration, /CHECK \(can_invite = FALSE\)/);
  assert.match(permissionsRoute, /document\.owner_id !== user\.id && !workspaceManager/);
  assert.match(permissionsRoute, /body\.canInvite === true/);
  assert.match(permissionsRoute, /access\.document\.estado !== 'completado'/);
  assert.match(permissionsRoute, /DOCUMENT_PERMISSION_GRANTED/);
  assert.match(permissionsRoute, /DOCUMENT_PERMISSION_REVOKED/);
});

test('viewer and editor routes enforce the corresponding capability server-side', () => {
  assert.match(viewerRoute, /requireDocumentContentAccess\(\s*request,\s*documentId,\s*isDownload \? 'download' : 'view'/);
  assert.match(contentAccess, /requireDocumentAccess\(request, documentId, \{ additionalAccess \}\)/);
  assert.match(documentAccess, /document_access_permissions/);
  assert.match(
    documentAccess,
    /!isOwner[\s\S]*?!listedParticipant[\s\S]*?!explicitPermission/
  );
  assert.match(editRoute, /requireEdit: true/);
  assert.match(editRoute, /ALLOWED_DOCUMENT_FIELDS/);
});
