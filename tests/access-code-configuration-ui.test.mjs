import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile('src/app/crear-documento/components/StepSubir.tsx', 'utf8');

test('saving the access code closes without a stale delayed callback', () => {
  assert.match(source, /onSaved\(databaseDocumentId \? '' : password\);\s*onClose\(\);/);
  assert.doesNotMatch(source, /setTimeout\(\(\) => onClose\(\), 1000\)/);
});

test('an existing document configures view access through the protected backend API', () => {
  assert.match(source, /\/api\/documentos\/\$\{databaseDocumentId\}\/view-access/);
  assert.doesNotMatch(source, /codigo_acceso:\s*password/);
});

test('the saved access-code summary exposes edit and delete actions', () => {
  assert.match(source, /removeLabel="Eliminar"/);
  assert.match(source, /Código de acceso configurado/);
  assert.match(source, /setShowCodigoAccesoDeleteConfirm\(true\)/);
});

test('the access-code editor does not render an internal delete action', () => {
  assert.doesNotMatch(source, />\s*Eliminar código de acceso\s*</);
});

test('closing the editor cannot disable a code that was just saved', () => {
  assert.doesNotMatch(source, /if \(!codigoAccesoValue\)\s*\{\s*setCodigoAcceso\(false\)/);
});
