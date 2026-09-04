import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const routePath = new URL('../src/app/api/documentos/carpetas/route.ts', import.meta.url);
const pagePath = new URL('../src/app/mis-documentos/page.tsx', import.meta.url);
const folderTrashRoutePath = new URL(
  '../src/app/api/documentos/carpetas/papelera/route.ts',
  import.meta.url
);
const historyRoutePath = new URL(
  '../src/app/api/documentos/eliminaciones/route.ts',
  import.meta.url
);
const migrationPath = new URL(
  '../supabase/migrations/20260903180904_folder_deletion_tombstones.sql',
  import.meta.url
);

test('folder deletion is server-authorized and restricted to empty folders', async () => {
  const source = await readFile(routePath, 'utf8');

  assert.match(source, /export async function DELETE/);
  assert.match(source, /authHeader\?\.startsWith\('Bearer '\)/);
  assert.match(source, /\.eq\('owner_id', user\.id\)/);
  assert.match(source, /\.eq\('carpeta_id', folderId\)/);
  assert.match(source, /\.eq\('parent_id', folderId\)/);
  assert.match(source, /Solo puedes eliminar carpetas vacías/);
  assert.match(source, /status: 409/);
  assert.match(source, /folder_deletion_tombstones/);
  assert.match(source, /status: 'COMPLETED'/);
});

test('folder UI labels deletion accurately, supports selected folders, and does not detach documents', async () => {
  const source = await readFile(pagePath, 'utf8');
  const folderHandlerStart = source.indexOf("if (type === 'folder' || type === 'folders')");
  const folderHandler = source.slice(
    folderHandlerStart,
    source.indexOf("} else if (type === 'cancel')", folderHandlerStart)
  );

  assert.ok(folderHandlerStart >= 0);
  assert.match(folderHandler, /method: 'DELETE'/);
  assert.doesNotMatch(folderHandler, /update\(\{ carpeta_id: null \}\)/);
  assert.match(source, />\s*Eliminar permanentemente\s*</);
  assert.match(source, /Las carpetas vacías se eliminan de inmediato y no pasan por Papelera/);
  assert.match(source, /Eliminar \{selectedFolders\.length\} carpeta\(s\) permanentemente/);
  assert.match(source, /type: 'folders'/);
  assert.match(source, /Solo se permiten carpetas vacías, sin documentos ni subcarpetas/);
});

test('folder deletions have a minimal permanent-history record without a folder foreign key', async () => {
  const [migration, historyRoute] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(historyRoutePath, 'utf8'),
  ]);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.folder_deletion_tombstones/);
  assert.match(migration, /folder_id uuid NOT NULL/);
  assert.match(migration, /folder_name text NOT NULL/);
  assert.match(migration, /no foreign key to carpetas/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(historyRoute, /folder_deletion_tombstones/);
  assert.match(historyRoute, /resource_type: 'FOLDER'/);
});

test('folder-to-trash evaluates every document without bypassing Legal Hold or active workflows', async () => {
  const source = await readFile(folderTrashRoutePath, 'utf8');

  assert.match(
    source,
    /requireDocumentAccess\(request, candidate\.id, \{ ownerOrAdminOnly: true \}\)/
  );
  assert.match(source, /disposition\.legalHoldActive/);
  assert.match(source, /code: 'LEGAL_HOLD'/);
  assert.match(source, /code: disposition\.hasActiveParticipants \? 'ACTIVE_WORKFLOW' : 'OTHER'/);
  assert.match(source, /code: 'NO_PERMISSION'/);
  assert.match(source, /folder_can_move: blockers\.length === 0/);
});

test('folder-to-trash preserves blocked documents and applies the recovery window per document', async () => {
  const [route, page] = await Promise.all([
    readFile(folderTrashRoutePath, 'utf8'),
    readFile(pagePath, 'utf8'),
  ]);

  assert.match(route, /now\.getTime\(\) \+ RECOVERY_DAYS \* 24 \* 60 \* 60 \* 1000/);
  assert.match(route, /trashed_folder_id: evaluation\.tree\.root\.id/);
  assert.match(route, /const fullyMoved =/);
  assert.match(route, /folder_moved: fullyMoved/);
  assert.match(page, /Mover carpeta a Papelera/);
  assert.match(page, /Los documentos bloqueados permanecerán en la carpeta/);
});
