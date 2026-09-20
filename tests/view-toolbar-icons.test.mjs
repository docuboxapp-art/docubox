import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const toolbarPages = [
  'src/app/plantillas/page.tsx',
  'src/app/contactos/page.tsx',
  'src/app/mis-participaciones/page.tsx',
  'src/app/participation-requests/page.tsx',
];

test('document collection toolbars share the same list and grid icons', async () => {
  for (const path of toolbarPages) {
    const source = await readFile(path, 'utf8');
    const listIcon = source.indexOf('<LayoutList size={16}');
    const gridIcon = source.indexOf('<LayoutGrid size={16}');

    assert.ok(listIcon >= 0, `${path} must use LayoutList at 16px`);
    assert.ok(gridIcon > listIcon, `${path} must present list before grid`);
    assert.doesNotMatch(source, /<List size=\{16\}/);
  }
});
