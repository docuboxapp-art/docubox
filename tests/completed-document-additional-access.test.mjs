import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('additional access is completed-only, tiered and never editable', async () => {
  const source = await read('../src/lib/security/document-access.ts');
  assert.match(source, /additionalAccessRank = \{ view: 1, download: 2, evidence: 3 \}/);
  assert.match(source, /document\.estado !== 'completado' \|\| grantedRank < requiredRank/);
  assert.match(source, /: Number\.POSITIVE_INFINITY/);
  assert.match(source, /const canEdit = false/);
});

test('permission mutations require a completed document and a registered user', async () => {
  const source = await read('../src/app/api/documentos/[documentId]/permissions/route.ts');
  assert.match(source, /const levels = new Set<AccessLevel>\(\['view', 'download', 'evidence'\]\)/);
  assert.match(source, /if \(access\.document\.estado !== 'completado'\)/);
  assert.match(source, /auth\.admin\.getUserById\(userId\)/);
  assert.match(source, /body\.canInvite === true/);
  assert.match(source, /inheritedAccessReason\(access, userId/);
  assert.doesNotMatch(source, /access_level: 'edit'/);
});

test('permission routes accept valid UUIDs and reject malformed identifiers', async () => {
  const source = await read('../src/app/api/documentos/[documentId]/permissions/route.ts');
  const expression = source.match(/const uuidPattern = (\/[^\n]+\/i);/);
  assert.ok(expression, 'UUID validation pattern is present');
  const pattern = new RegExp(expression[1].slice(1, -2), 'i');
  assert.equal(pattern.test('d93cd774-b63d-499c-876d-32e59419f2d6'), true);
  assert.equal(pattern.test('d93cd774-b63d-499c-876d-32e59419f2d'), false);
  assert.equal(pattern.test('d93cd774-b63d-499c-176d-32e59419f2d6'), false);
});

test('viewer and downloads enforce the additional access tier on the server', async () => {
  const [viewer, document, details, unlock] = await Promise.all([
    read('../src/app/api/documentos/[documentId]/viewer-file/route.ts'),
    read('../src/app/api/documentos/obtener/route.ts'),
    read('../src/app/api/documentos/[documentId]/participant-details/route.ts'),
    read('../src/app/api/documentos/[documentId]/view-access/unlock/route.ts'),
  ]);
  assert.match(viewer, /isDownload \? 'download' : 'view'/);
  assert.match(viewer, /additionalAccessLevel && !requestsFinalPdf/);
  assert.match(document, /additional_access_level: explicitPermission\.access_level/);
  assert.match(details, /ipAddress: additionalAccessLevel\s*\? \(evidence\.ip_address \? 'Registrada' : null\)/);
  assert.match(unlock, /requireDocumentAccess\(request, documentId, \{ additionalAccess: 'view' \}\)/);
});

test('database constraints disallow email-only grantees and direct document row access', async () => {
  const source = await read('../supabase/migrations/20260924100726_completed_document_additional_access.sql');
  assert.match(source, /CHECK \(access_level IN \('view', 'download', 'evidence'\)\)/);
  assert.match(source, /CHECK \(grantee_user_id IS NOT NULL AND grantee_email IS NULL\)/);
  assert.match(source, /CHECK \(can_invite = FALSE\)/);
  assert.match(source, /WHEN access_level = 'edit' THEN 'view'/);
  const documentAccess = source.slice(source.indexOf('CREATE OR REPLACE FUNCTION public.can_access_documento'));
  assert.doesNotMatch(documentAccess, /has_document_access_permission/);
});
