import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
async function load(entry) {
  const bundle = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
  );
}
const { emptyCaseTemplate, newCaseTemplateItem, parseStoredCaseTemplate } = await load(
  'src/lib/case-files/template-builder.ts'
);
const { documentRequirementCatalog, documentRequirementCategories } = await load(
  'src/lib/case-files/template-catalog.ts'
);
const { duplicateContentItem, removeContentSection } = await load('src/lib/case-files/content.ts');
const restore = (draft) =>
  parseStoredCaseTemplate({
    id: 'draft',
    name: 'Contenido',
    description: '',
    case_type: '',
    case_subtype: null,
    status: 'draft',
    requirements_schema: { version: 5, ...draft },
  });

test('56 reusable catalogue definitions are unique and never universally required', () => {
  assert.equal(documentRequirementCatalog.length, 56);
  assert.equal(new Set(documentRequirementCatalog.map((item) => item.id)).size, 56);
  for (const item of documentRequirementCatalog) {
    assert.ok(item.description && item.instructions && item.recommendedFormats.length);
    assert.equal(item.defaults.required, false);
    assert.equal(item.origin, 'docubox');
    assert.ok(
      item.categories.every((id) => documentRequirementCategories.some((entry) => entry.id === id))
    );
  }
});
test('description, instructions, category, role and resource version remain separate after save', () => {
  const draft = emptyCaseTemplate();
  const item = newCaseTemplateItem('document_template');
  Object.assign(item, {
    description: 'Qué acredita',
    instructions: 'Cómo entregarlo',
    documentCategory: 'corporate',
    responsibleRole: 'representative',
    sourceId: 'source',
    sourceVersion: '2',
    sourceRevision: 3,
  });
  draft.sections[0].items = [item];
  const restored = restore(draft).sections[0].items[0];
  for (const key of [
    'id',
    'description',
    'instructions',
    'documentCategory',
    'responsibleRole',
    'sourceId',
    'sourceVersion',
    'sourceRevision',
  ])
    assert.equal(restored[key], item[key]);
});
test('old stored content receives safe defaults without changing its identifier', () => {
  const draft = emptyCaseTemplate();
  const item = newCaseTemplateItem('requested_document');
  delete item.instructions;
  delete item.responsibleRole;
  delete item.documentCategory;
  draft.sections[0].items = [item];
  const restored = restore(draft).sections[0].items[0];
  assert.equal(restored.id, item.id);
  assert.equal(restored.instructions, '');
  assert.equal(restored.responsibleRole, 'external');
});
test('duplicating content creates an independent definition and format collection', () => {
  const item = newCaseTemplateItem('requested_document');
  const copy = duplicateContentItem(item);
  assert.notEqual(copy.id, item.id);
  copy.allowedFormats.pop();
  assert.equal(item.allowedFormats.length, 3);
});
function linkedDraft() {
  const draft = emptyCaseTemplate();
  const item = newCaseTemplateItem('requested_document');
  draft.sections[0].items = [item];
  draft.sections.push({
    id: 'target',
    title: 'Destino',
    description: '',
    dueInDays: null,
    items: [],
  });
  draft.stages[0].activities = [
    { id: 'receive', kind: 'receive_document', refId: item.id, required: true },
  ];
  return draft;
}
test('moving section content preserves references and does not mutate the input', () => {
  const draft = linkedDraft();
  const next = removeContentSection(draft, draft.sections[0].id, 'target');
  assert.equal(next.sections[0].items[0].id, draft.sections[0].items[0].id);
  assert.equal(next.stages[0].activities[0].refId, next.sections[0].items[0].id);
  assert.equal(draft.sections.length, 2);
});
test('confirmed section deletion removes linked activities and rejects invalid destination', () => {
  const draft = linkedDraft();
  assert.throws(() => removeContentSection(draft, draft.sections[0].id, 'absent'));
  const next = removeContentSection(draft, draft.sections[0].id, null);
  assert.equal(next.stages[0].activities.length, 0);
});
test('10 sections and 50 requirements retain identities and ordering after reload', () => {
  const draft = emptyCaseTemplate();
  draft.sections = Array.from({ length: 10 }, (_, index) => ({
    id: `section-${index}`,
    title: `Section ${index}`,
    description: 'Descripción',
    dueInDays: null,
    items: Array.from({ length: 5 }, () => newCaseTemplateItem('requested_document')),
  }));
  const restored = restore(draft);
  assert.deepEqual(
    restored.sections.map((section) => section.id),
    draft.sections.map((section) => section.id)
  );
  assert.deepEqual(
    restored.sections.flatMap((section) => section.items.map((item) => item.id)),
    draft.sections.flatMap((section) => section.items.map((item) => item.id))
  );
});
