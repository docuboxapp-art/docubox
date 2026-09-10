import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../src/app/visor-documento/[id]/page.tsx', import.meta.url),
  'utf8'
);
const adjustmentSource = await readFile(
  new URL('../src/app/crear-documento/components/StepAjustes.tsx', import.meta.url),
  'utf8'
);

test('the document viewer accepts a direct page number only for longer documents', () => {
  assert.match(source, /const canJumpToPage = totalPages > 5;/);
  assert.match(source, /aria-label="Ir a página"/);
  assert.match(source, /Página 1 de 1/);
  assert.match(source, /onKeyDown=\{handlePageInputKeyDown\}/);
  assert.match(source, /Página \{currentPage\} de \{totalPages\}/);
});

test('field placement preview uses the same page-navigation behavior', () => {
  assert.match(adjustmentSource, /const canJumpToPage = totalPages > 5;/);
  assert.match(adjustmentSource, /aria-label="Ir a página"/);
  assert.match(adjustmentSource, /Página 1 de 1/);
  assert.match(adjustmentSource, /const commitPageInput = \(\) =>/);
  assert.match(adjustmentSource, /Página \{currentPage\} de \{totalPages\}/);
});

test('viewer loading is keyed by stable user identity instead of auth object refreshes', () => {
  assert.match(source, /const userId = user\?\.id \?\? '';/);
  assert.match(source, /\[authLoading, docId, loadAdditionalMetadata, userDisplayName, userEmail, userId\]/);
  assert.doesNotMatch(source, /\}, \[docId, user, authLoading, loadAdditionalMetadata\]\);/);
});

test('viewer section rail contains long tab labels without invading the detail panel', () => {
  assert.match(source, /w-\[72px\] min-w-\[72px\]/);
  assert.match(source, /w-full max-w-\[56px\]/);
  assert.match(source, /document-viewer-tab-label block w-full truncate/);
  assert.match(source, /right-\[72px\]/);
  assert.match(source, /max-w-\[calc\(100%-72px\)\]/);
});

test('viewer resolves secondary metadata concurrently without changing its loading state', () => {
  const bootstrap = source.slice(
    source.indexOf('const loadDocument = async () =>'),
    source.indexOf('const loadActivity = async () =>')
  );

  assert.match(bootstrap, /await Promise\.all\(\[[\s\S]*setDocument\(\{[\s\S]*file_url: viewerFileUrl/);
  assert.match(bootstrap, /from\('user_profiles'\)/);
  assert.match(bootstrap, /from\('carpetas'\)/);
  assert.match(bootstrap, /from\('workspaces'\)/);
  assert.match(bootstrap, /from\('document_metadata'\)/);
});

test('viewer renders protected PDF bytes before showing fields or signature stamps', () => {
  assert.match(source, /headers: await apiAuthHeaders\(\)/);
  assert.match(source, /credentials: 'same-origin'/);
  assert.match(source, /data: bytes/);
  assert.match(source, /El archivo entregado no es un PDF válido/);
  assert.match(source, /\{rendered && !rendering \? children : null\}/);
  assert.match(source, /participante_id: string \| null/);
  assert.match(source, /if \(!assignedParticipantId\) return null/);
  assert.match(source, /configuredParticipantId\.toLowerCase\(\) === 'current-user'/);
  assert.match(source, /values\.length === 1 \? values\[0\] : ''/);
  assert.doesNotMatch(source, /use first available firma/);
  assert.doesNotMatch(source, /campo\.participantName && r\.participante_nombre === campo\.participantName/);
});
