import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const api = await readFile('src/app/api/documentos/[documentId]/view-access/route.ts', 'utf8');
const panel = await readFile('src/components/documents/AccessProtectionPanel.tsx', 'utf8');
const viewer = await readFile('src/app/visor-documento/[id]/page.tsx', 'utf8');
const myDocuments = await readFile('src/app/mis-documentos/page.tsx', 'utf8');
const listApi = await readFile('src/app/api/documentos/listar/route.ts', 'utf8');
const migration = await readFile(
  'supabase/migrations/20260913021500_document_view_access_admin_events.sql',
  'utf8'
);

test('all access administration methods require owner or workspace administrator', () => {
  const protectedCalls = api.match(/ownerOrAdminOnly: true/g) || [];
  assert.equal(protectedCalls.length, 3);
  assert.doesNotMatch(api, /codigo_acceso_hash/);
  assert.doesNotMatch(api, /token_hash/);
  assert.match(api, /protectedParticipantCount/);
});

test('viewer exposes an independent Access module with configuration and audit', () => {
  assert.match(viewer, /key: 'access'/);
  assert.match(viewer, /label: 'Acceso'/);
  assert.match(viewer, /<AccessProtectionPanel/);
  assert.match(panel, />\s*Configuración\s*</);
  assert.match(panel, />\s*Bitácora\s*</);
  assert.match(panel, /No hay actividad de Protección de acceso registrada\./);
  assert.match(viewer, /activeTab === 'access'/);
  assert.match(viewer, /activeTab === 'legal-hold'/);
});

test('access code is revealed from operation memory once and never fetched for display', () => {
  assert.match(panel, /const oneTimeCode = code/);
  assert.match(panel, /setRevealedCode\(oneTimeCode\)/);
  assert.match(panel, /Docubox no podrá volver a\s+mostrarlo/);
  assert.doesNotMatch(panel, /Ver código actual/);
  assert.doesNotMatch(panel, /codigo_acceso_hash|token_hash|authorization header/i);
});

test('My Documents uses one contextual deep link instead of a second configurator', () => {
  assert.match(listApi, /tiene_codigo_acceso/);
  assert.match(myDocuments, /Administrar protección de acceso/);
  assert.match(myDocuments, /Activar protección de acceso/);
  assert.match(myDocuments, /\?tab=access&section=configuration/);
  assert.match(myDocuments, /Protección de acceso activa/);
  assert.doesNotMatch(myDocuments, /Modo Confidencial/);
  assert.doesNotMatch(myDocuments, /handleSaveConfidential/);
});

test('My Documents download cannot bypass the protected viewer-file endpoint', () => {
  assert.doesNotMatch(listApi, /file_url/);
  assert.match(myDocuments, /viewer-file\?variant=original/);
  assert.match(myDocuments, /ACCESS_CODE_REQUIRED/);
  assert.doesNotMatch(myDocuments, /a\.href = fileUrl/);
});

test('configuration transitions audit reactivation and unlock invalidation', () => {
  assert.match(migration, /VIEW_ACCESS_PROTECTION_REENABLED/);
  assert.match(migration, /VIEW_ACCESS_UNLOCKS_INVALIDATED/);
  assert.match(migration, /PROTECTION_RECONFIGURED/);
  assert.match(migration, /PROTECTION_DISABLED/);
  assert.match(migration, /invalidated_count/);
});
