import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../src/app/mis-documentos/page.tsx', import.meta.url),
  'utf8'
);

test('all document tables share the initial column-width preference request', () => {
  assert.match(source, /const pendingColumnWidthsConfig = new Map/);
  assert.match(source, /if \(existingRequest\) return existingRequest;/);
  assert.match(source, /void loadColumnWidthsConfig\(userId\)\.then/);
});

test('advanced filter catalogs load only when the relevant control is opened', () => {
  assert.match(source, /openFilterDropdown === 'tipoDocumento'/);
  assert.match(source, /openFilterDropdown === 'propietario'/);
  assert.match(source, /openFilterDropdown === 'participantes'/);
  assert.match(source, /if \(!showCarpetaModal\) return;/);
  assert.doesNotMatch(
    source,
    /useEffect\(\(\) => \{\s*loadTiposDocumento\(\);\s*loadGruposDocumento\(\);\s*\}, \[loadTiposDocumento, loadGruposDocumento\]\)/
  );
});
