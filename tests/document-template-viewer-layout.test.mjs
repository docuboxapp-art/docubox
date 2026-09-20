import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const viewerPath = new URL('../src/app/visor-documento/[id]/page.tsx', import.meta.url);
const viewer = await readFile(viewerPath, 'utf8');

test('template fields keep their configured label and percentage geometry in the viewer', () => {
  assert.match(
    viewer,
    /const displayLabel = campo\.fieldConfig\?\.customName\?\.trim\(\) \|\| campo\.label/
  );
  assert.match(viewer, /left: `\$\{x\}%`/);
  assert.match(viewer, /top: `\$\{y\}%`/);
  assert.match(viewer, /width: `\$\{w\}%`/);
  assert.match(viewer, /height: `\$\{h\}%`/);
  assert.match(viewer, /\{displayLabel\}/);
});

test('template overlays mask the baked placeholder without changing its box', () => {
  assert.match(viewer, /mixFieldColorWithWhite\(campo\.colorHex\)/);
  assert.match(viewer, /overflow-hidden rounded border/);
  assert.doesNotMatch(viewer, /className=\{`border-2 rounded flex items-center justify-center/);
  assert.match(viewer, /const overlayFontSize = Math\.max\(7, \(9 \* zoom\) \/ 100\)/);
});
