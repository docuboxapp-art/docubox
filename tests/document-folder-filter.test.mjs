import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['src/app/mis-documentos/components/folder-filter.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { hasDocumentCriteria, uniqueMatchingDocumentFolderPath, visibleFoldersForDocuments } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

const folders = [
  { id: 'root-match', parentId: null },
  { id: 'nested-match', parentId: 'root-match' },
  { id: 'root-empty', parentId: null },
];
const matchingDocuments = [{ carpetaId: 'nested-match' }];

test('shows only folders containing matching documents, including ancestors', () => {
  assert.deepEqual(
    visibleFoldersForDocuments(folders, matchingDocuments, null, '', true).map((folder) => folder.id),
    ['root-match']
  );
  assert.deepEqual(
    visibleFoldersForDocuments(folders, matchingDocuments, 'root-match', '', true).map(
      (folder) => folder.id
    ),
    ['nested-match']
  );
  assert.deepEqual(visibleFoldersForDocuments(folders, [], null, '', true), []);
});

test('archives hides every folder, while the unfiltered folder view retains empty folders', () => {
  assert.deepEqual(visibleFoldersForDocuments(folders, matchingDocuments, null, 'archivo', false), []);
  assert.deepEqual(visibleFoldersForDocuments(folders, matchingDocuments, null, 'archivo', true), []);
  assert.deepEqual(
    visibleFoldersForDocuments(folders, [], null, 'carpeta', false).map((folder) => folder.id),
    ['root-match', 'root-empty']
  );
  assert.deepEqual(
    visibleFoldersForDocuments(folders, matchingDocuments, null, 'carpeta', true).map(
      (folder) => folder.id
    ),
    ['root-match']
  );
});

test('only substantive document filters narrow folder results', () => {
  assert.equal(hasDocumentCriteria({ estructura: 'archivo', estado: '', etiquetas: [] }), false);
  assert.equal(hasDocumentCriteria({ estructura: '', propietario: 'todos' }), false);
  assert.equal(hasDocumentCriteria({ estructura: '', estado: 'Borrador' }), true);
  assert.equal(hasDocumentCriteria({ estructura: '', participantes: ['person-1'] }), true);
});

test('a single matching document resolves its complete folder path', () => {
  const namedFolders = folders.map((folder) => ({ ...folder, name: folder.id }));
  assert.deepEqual(uniqueMatchingDocumentFolderPath(namedFolders, matchingDocuments), [
    { id: 'root-match', name: 'root-match' },
    { id: 'nested-match', name: 'nested-match' },
  ]);
  assert.equal(
    uniqueMatchingDocumentFolderPath(namedFolders, [
      { carpetaId: 'nested-match' },
      { carpetaId: null },
    ]),
    null
  );
  assert.equal(uniqueMatchingDocumentFolderPath(namedFolders, [{ carpetaId: null }]), null);
  assert.equal(uniqueMatchingDocumentFolderPath(namedFolders, [{ carpetaId: 'missing' }]), null);
});
