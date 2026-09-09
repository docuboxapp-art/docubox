import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../src/app/firmar-documento/[id]/page.tsx', import.meta.url),
  'utf8'
);

test('the signing document viewer accepts a direct page number for longer documents', () => {
  assert.match(source, /const \[pageInputValue, setPageInputValue\] = useState\('1'\)/);
  assert.match(source, /const commitPageInput = \(\) =>/);
  assert.match(source, /const canNavigatePages = totalPages > 1;/);
  assert.match(source, /const canJumpToPage = totalPages > 5;/);
  assert.match(source, /aria-label="Ir a página"/);
  assert.match(source, /event\.key === 'Enter'/);
  assert.match(source, /page >= 1 && page <= totalPages/);
  assert.match(source, /Página 1 de 1/);
  assert.match(source, /Página \{currentPage\} de \{totalPages\}/);
});

test('the expanded signing document viewer accepts a direct page number', () => {
  assert.match(source, /const \[docModalPageInputValue, setDocModalPageInputValue\] = useState\('1'\)/);
  assert.match(source, /const commitDocModalPageInput = \(\) =>/);
  assert.match(source, /aria-label="Ir a página en vista ampliada"/);
  assert.match(source, /Página \{docModalPage\} de \{totalPages\}/);
});
