import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const viewerSource = await readFile('src/app/visor-documento/[id]/page.tsx', 'utf8');
const activityRoute = await readFile(
  'src/app/api/documentos/[documentId]/activity/route.ts',
  'utf8'
);

test('viewer activity loads automatically through one authenticated request', () => {
  assert.match(viewerSource, /async function fetchDocumentActivity/);
  assert.match(viewerSource, /headers: await apiAuthHeaders\(\)/);
  assert.match(viewerSource, /setActivityEvents\(await fetchDocumentActivity\(docId\)\)/);
  assert.match(viewerSource, /loadActivity\(\)/);
});

test('activity endpoint gathers core ledgers in parallel', () => {
  assert.match(activityRoute, /requireDocumentContentAccess/);
  assert.match(activityRoute, /await Promise\.all/);
  assert.match(activityRoute, /from\('security_audit_log'\)/);
  assert.match(activityRoute, /from\('document_audit_trail'\)/);
  assert.match(activityRoute, /from\('document_activity_log'\)/);
  assert.match(activityRoute, /Cache-Control.*private, no-store/);
});
