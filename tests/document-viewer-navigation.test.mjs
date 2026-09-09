import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../src/app/visor-documento/[id]/page.tsx', import.meta.url),
  'utf8'
);

test('the document viewer accepts a direct page number only for longer documents', () => {
  assert.match(source, /const canJumpToPage = totalPages > 5;/);
  assert.match(source, /aria-label="Ir a página"/);
  assert.match(source, /Página 1 de 1/);
  assert.match(source, /onKeyDown=\{handlePageInputKeyDown\}/);
  assert.match(source, /Página \{currentPage\} de \{totalPages\}/);
});

test('viewer loading is keyed by stable user identity instead of auth object refreshes', () => {
  assert.match(source, /const userId = user\?\.id \?\? '';/);
  assert.match(source, /\[authLoading, docId, loadAdditionalMetadata, userDisplayName, userEmail, userId\]/);
  assert.doesNotMatch(source, /\}, \[docId, user, authLoading, loadAdditionalMetadata\]\);/);
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
