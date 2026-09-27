import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const [myDocuments, dashboard, viewer, signer, viewerStyles] = await Promise.all([
  read('src/app/mis-documentos/page.tsx'),
  read('src/app/documents-dashboard/page.tsx'),
  read('src/app/visor-documento/[id]/page.tsx'),
  read('src/app/firmar-documento/[id]/page.tsx'),
  read('src/styles/tailwind.css'),
]);

test('primary application screens share the same maximum interface weight', () => {
  for (const [screen, source] of [
    ['mis-documentos', myDocuments],
    ['inicio', dashboard],
    ['visor-documento', viewer],
  ]) {
    assert.doesNotMatch(source, /font-(?:700|bold)/, `${screen} still uses an extra-bold UI weight`);
  }
});

test('signing interface uses semibold hierarchy without changing document formatting controls', () => {
  const mainLayoutMarker = '// ── Main layout';
  const mainLayout = signer.slice(signer.indexOf(mainLayoutMarker));

  assert.doesNotMatch(mainLayout, /font-(?:700|bold)/);
  assert.match(mainLayout, /text-xl font-600/);
  assert.match(mainLayout, /text-lg font-semibold/);
  assert.match(signer, /text-xs font-bold transition-colors/);
});

test('viewer keeps participant data lighter than section headings', () => {
  assert.match(viewer, /text-xs font-medium text-foreground leading-tight/);
  assert.match(viewer, /<span className="viewer-panel-title">Participantes<\/span>/);
  assert.match(viewerStyles, /\.document-viewer-panel \.viewer-panel-title\s*\{[^}]*font-size:\s*0\.875rem;[^}]*font-weight:\s*600;/);
});
