import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('document signing and viewing defer PDF rendering until after React commits', () => {
  for (const file of [
    'src/app/firmar-documento/[id]/page.tsx',
    'src/app/visor-documento/[id]/page.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /requestAnimationFrame\(\(\) => \{\s*void renderPage\(\);/);
    assert.match(source, /cancelAnimationFrame\(renderFrame\)/);
  }
});

test('viewer callbacks observe the current document and certification state', () => {
  const source = read('src/app/visor-documento/[id]/page.tsx');
  assert.match(source, /\[cryptographicCertification, docId, document, logActivity\]/);
  assert.match(source, /\[xmlEvidenceData, docId, document\]/);
  assert.match(source, /const renderPaginationBar = \(modal = false\)/);
  assert.doesNotMatch(source, /const PaginationBar =/);
});

test('autograph evidence capture is declared before signature pad listeners use it', () => {
  const source = read('src/app/firmar-documento/[id]/AutographSignatureFlow.tsx');
  const declaration = source.indexOf('const captureFrame = useCallback');
  const listener = source.indexOf("captureFrame('stroke_start')");
  assert.ok(declaration >= 0, 'captureFrame declaration is missing');
  assert.ok(listener > declaration, 'captureFrame must be declared before stroke listeners');
});
