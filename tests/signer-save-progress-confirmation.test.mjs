import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'src/app/firmar-documento/[id]/page.tsx'), 'utf8');

test('saving signer progress requires an explicit confirmation', () => {
  const modalStart = source.indexOf('function SaveProgressConfirmModal');
  const modalEnd = source.indexOf('// ─── Main Page', modalStart);
  const modal = source.slice(modalStart, modalEnd);

  assert.ok(modalStart >= 0, 'save progress confirmation modal is missing');
  assert.match(modal, /¿Guardar avance\?/);
  assert.match(modal, />\s*Cancelar\s*<\/button>/);
  assert.match(modal, /Guardar avance/);
  assert.doesNotMatch(modal, /<X\b/);
  assert.match(source, /onClick=\{\(\) => setShowSaveProgressModal\(true\)\}/);
  assert.match(source, /onConfirm=\{handleGuardarAvance\}/);
  assert.doesNotMatch(source, /onClick=\{handleGuardarAvance\}/);
});

test('signer state is persisted only after the confirmed database save', () => {
  const saveStart = source.indexOf('const handleGuardarAvance = async () =>');
  const saveEnd = source.indexOf('// ── Submit', saveStart);
  const saveHandler = source.slice(saveStart, saveEnd);

  assert.match(saveHandler, /\.upsert\(progressPayload/);
  assert.match(
    saveHandler,
    /if \(error\) throw new Error\(error\.message\);\s*writePersistedFlow\(\{/
  );
  assert.match(saveHandler, /savedByUser: true/);
  assert.match(saveHandler, /firmaData: null/);
  assert.match(saveHandler, /autographEvidenceId: null/);
  assert.match(source, /persisted\?\.savedByUser === true/);

  for (const automaticWrite of [
    /writePersistedFlow\(\{ step \}\)/,
    /writePersistedFlow\(\{ terminosAceptados \}\)/,
    /writePersistedFlow\(\{ camposValues \}\)/,
    /writePersistedFlow\(\{ camposPersonalizados \}\)/,
    /writePersistedFlow\(\{ autographEvidenceId \}\)/,
  ]) {
    assert.doesNotMatch(source, automaticWrite);
  }
});

test('save progress feedback uses a lower success toast instead of inline text', () => {
  assert.match(source, /<Toaster position="bottom-right" richColors \/>/);
  assert.match(source, /toast\.success\('Tu avance se guardó correctamente\.'\)/);
  assert.match(
    source,
    /toast\.error\('No fue posible guardar el avance\. Inténtalo nuevamente\.'\)/
  );
  assert.doesNotMatch(source, /saveProgressMsg/);
});

test('restored draft fields come from an explicit local or server save', () => {
  assert.match(source, /let savedServerValues: Record<string, string> = \{\}/);
  assert.match(source, /\.\.\.savedServerValues/);
  assert.match(source, /\.\.\.\(restorableSession\?\.camposValues \|\| \{\}\)/);
  assert.match(source, /retrySubmission\?\.firmaData/);
  assert.doesNotMatch(source, /if \(persisted\.firmaData\)/);
});
