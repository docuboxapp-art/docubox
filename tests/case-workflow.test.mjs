import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['src/lib/case-files/workflow.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { suggestCaseWorkflow, validateCaseWorkflow } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
const modelBundle = await build({
  entryPoints: ['src/lib/case-files/template-builder.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { emptyCaseTemplate, newCaseTemplateItem, newCaseTemplateVerification } = await import(
  `data:text/javascript;base64,${Buffer.from(modelBundle.outputFiles[0].text).toString('base64')}`
);

test('recommended workflow references one requirement in receipt and review', () => {
  const draft = emptyCaseTemplate();
  draft.experience.configureWorkflow = true;
  draft.sections[0].items = [newCaseTemplateItem('requested_document')];
  const item = draft.sections[0].items[0];
  const stages = suggestCaseWorkflow(draft);
  assert.deepEqual(
    stages.map((stage) => stage.catalogKey),
    ['opening', 'documents', 'review', 'closing']
  );
  assert.equal(
    stages.find((stage) => stage.catalogKey === 'documents').activities[0].refId,
    item.id
  );
  assert.equal(stages.find((stage) => stage.catalogKey === 'review').activities[0].refId, item.id);
  assert.equal(validateCaseWorkflow(draft, stages).errors.length, 0);
});

test('verification may run parallel and closing depends on both branches', () => {
  const draft = emptyCaseTemplate();
  draft.experience.configureWorkflow = true;
  draft.sections[0].items = [newCaseTemplateItem('requested_document')];
  draft.verifications = [newCaseTemplateVerification('email_otp')];
  const stages = suggestCaseWorkflow(draft);
  const identity = stages.find((stage) => stage.catalogKey === 'identity');
  const closing = stages.find((stage) => stage.catalogKey === 'closing');
  assert.equal(identity.execution, 'parallel');
  assert.ok(closing.dependsOn.includes(identity.id));
  assert.ok(closing.dependsOn.includes('auto:review'));
  assert.deepEqual(validateCaseWorkflow(draft, stages).errors, []);
});

test('supplier profile separates form capture and compliance verification', () => {
  const draft = emptyCaseTemplate();
  draft.experience.configureWorkflow = true;
  draft.caseType = 'Alta de proveedor';
  const form = newCaseTemplateItem('form');
  const document = newCaseTemplateItem('requested_document');
  draft.sections[0].items = [form, document];
  draft.verifications = [newCaseTemplateVerification('tax')];
  const stages = suggestCaseWorkflow(draft);
  assert.equal(stages.find((stage) => stage.catalogKey === 'capture').activities[0].refId, form.id);
  assert.equal(
    stages.find((stage) => stage.catalogKey === 'documents').activities[0].refId,
    document.id
  );
  assert.ok(stages.some((stage) => stage.catalogKey === 'compliance'));
  assert.deepEqual(validateCaseWorkflow(draft, stages).errors, []);
});

test('custom flow rejects orphan references, missing work and cycles', () => {
  const draft = emptyCaseTemplate();
  draft.experience.configureWorkflow = true;
  const item = newCaseTemplateItem('requested_document');
  item.required = true;
  draft.sections[0].items = [item];
  const stages = suggestCaseWorkflow(draft);
  const collection = stages.find((stage) => stage.catalogKey === 'documents');
  collection.activities = [
    { id: 'orphan', kind: 'receive_document', refId: 'deleted', required: true },
  ];
  stages[0].dependsOn = [collection.id];
  const codes = validateCaseWorkflow(draft, stages).errors.map((issue) => issue.code);
  assert.ok(codes.includes('orphan_content'));
  assert.ok(codes.includes('unassigned_content'));
  assert.ok(codes.includes('cycle'));
});

test('a template cannot publish a fixed private document binding', () => {
  const draft = emptyCaseTemplate();
  draft.experience.configureWorkflow = true;
  const item = newCaseTemplateItem('existing_document');
  item.sourceId = crypto.randomUUID();
  draft.sections[0].items = [item];
  assert.ok(validateCaseWorkflow(draft).errors.some((issue) => issue.code === 'shared_document'));
});

test('large content structures yield stable nonduplicated references', () => {
  const draft = emptyCaseTemplate();
  draft.experience.configureWorkflow = true;
  draft.sections = Array.from({ length: 20 }, (_, index) => ({
    id: `section-${index}`,
    title: `Section ${index}`,
    description: '',
    dueInDays: null,
    items: Array.from({ length: 5 }, () => newCaseTemplateItem('requested_document')),
  }));
  const stages = suggestCaseWorkflow(draft);
  const receipt = stages.find((stage) => stage.catalogKey === 'documents');
  assert.equal(receipt.activities.length, 100);
  assert.equal(new Set(receipt.activities.map((activity) => activity.refId)).size, 100);
  assert.deepEqual(validateCaseWorkflow(draft, stages).errors, []);
});
