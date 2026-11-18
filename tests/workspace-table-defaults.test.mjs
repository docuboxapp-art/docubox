import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

async function moduleFrom(path) {
  const built = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
}
const { normalizeDocumentColumns } = await moduleFrom('src/app/mis-documentos/components/view-config.ts');
const { normalizeCaseView } = await moduleFrom('src/lib/case-files/view-preferences.ts');
const { caseResponsibleIds, casePeopleNames } = await moduleFrom('src/lib/case-files/list-people.ts');

test('new and existing accounts with untouched document defaults receive the requested table', () => {
  const oldOrder = ['numeroDocumento', 'folioInterno', 'estado', 'estadoParticipacion', 'etiquetas', 'tamano', 'ultimaModificacion', 'propietario', 'fechaCreacion', 'fechaCompletado', 'tipoDocumento', 'fechaVencimiento', 'rutaGuardado', 'prioridad'];
  const oldVisible = ['numeroDocumento', 'estado', 'etiquetas', 'tamano', 'ultimaModificacion', 'propietario'];
  const old = oldOrder.map(id => ({ id, visible: oldVisible.includes(id) }));
  const expected = ['propietario', 'estado', 'estadoParticipacion', 'fechaCreacion', 'fechaCompletado'];
  for (const raw of [undefined, [], old]) {
    assert.deepEqual(normalizeDocumentColumns(raw).filter(c => c.visible).map(c => c.id), expected);
  }
  const customized = old.map(c => c.id === 'tamano' ? { ...c, visible: false } : c);
  assert.equal(normalizeDocumentColumns(customized).find(c => c.id === 'fechaCreacion').visible, false);
  assert.deepEqual(normalizeDocumentColumns(normalizeDocumentColumns(old)), normalizeDocumentColumns(old));
});

test('case defaults include both people columns and upgrade only the untouched old layout', () => {
  const oldOrder = ['type', 'participant', 'status', 'progress', 'updated', 'category', 'priority', 'folio', 'owner', 'created', 'due', 'access', 'tags'];
  const old = oldOrder.map((id, index) => ({ id, visible: index < 5 }));
  const expected = ['type', 'participant', 'responsible', 'issuer', 'status', 'progress', 'updated'];
  for (const raw of [null, { columns: old }]) {
    assert.deepEqual(normalizeCaseView(raw).columns.filter(c => c.visible).map(c => c.id), expected);
  }
  const custom = normalizeCaseView({ columns: [{ id: 'owner', visible: false }, { id: 'priority', visible: true }] });
  assert.equal(custom.columns[0].id, 'issuer');
  assert.equal(custom.columns[0].visible, false);
  assert.equal(custom.columns[1].id, 'priority');
  assert.deepEqual(normalizeCaseView(custom), custom);
});

test('issuer stays distinct from delegated responsible people and reassigned reviewers', () => {
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
  const source = { owner_user_id: ids[0], created_by: ids[1], runtime_assignments: { approver: ids[2], closer: ids[2], reviewers: { old: ids[1] }, untrusted: 'not-an-id' } };
  assert.deepEqual(caseResponsibleIds(source, [ids[3], ids[3], null]), [ids[0], ids[2], ids[3]]);
  const names = casePeopleNames(source, [ids[3]], ids.map((id, index) => ({ id, full_name: ['Administrador', 'Emisor', 'Aprobador', 'Revisor actual'][index] })));
  assert.equal(names.issuerName, 'Emisor');
  assert.deepEqual(names.responsibleNames, ['Administrador', 'Aprobador', 'Revisor actual']);
  assert.equal(casePeopleNames({ ...source, created_by: null }, [], []).issuerName, 'Sin especificar');
});
