import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../src/app/visor-documento/[id]/page.tsx', import.meta.url),
  'utf8'
);

test('the document viewer accepts a direct page number', () => {
  assert.match(source, /aria-label="Ir a página"/);
  assert.match(source, /onKeyDown=\{handlePageInputKeyDown\}/);
  assert.match(source, /\/ \{totalPages\}/);
});

test('viewer loading is keyed by stable user identity instead of auth object refreshes', () => {
  assert.match(source, /const userId = user\?\.id \?\? '';/);
  assert.match(source, /\[authLoading, docId, loadAdditionalMetadata, userDisplayName, userEmail, userId\]/);
  assert.doesNotMatch(source, /\}, \[docId, user, authLoading, loadAdditionalMetadata\]\);/);
});
