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
const {
  emptyCaseTemplate,
  newCaseTemplateItem,
  newCaseTemplateVerification,
  parseStoredCaseTemplate,
} = await load('src/lib/case-files/template-builder.ts');
const {
  evaluateCaseEligibility,
  normalizeReviewPolicy,
  reviewPolicySources,
  reviewClosureConditions,
} = await load('src/lib/case-files/review-policy.ts');
const { resolvedCaseWorkflow } = await load('src/lib/case-files/workflow.ts');
const { validateCaseReviewPublication } = await load('src/lib/case-files/review-publication.ts');
const { isCaseWizardStepEnabled } = await load('src/lib/case-files/experience.ts');
function fixture(count = 1) {
  const draft = emptyCaseTemplate();
  draft.name = 'Expediente de prueba';
  draft.sections[0].items = Array.from({ length: count }, () => ({
    ...newCaseTemplateItem('requested_document'),
    required: true,
  }));
  const evidence = {
    subjectId: 'subject-a',
    snapshotId: 'snapshot-a',
    content: {},
    verifications: {},
    signatures: {},
    blockingObservations: 0,
    failedRequiredJobs: 0,
  };
  for (const item of draft.sections[0].items)
    evidence.content[item.id] = {
      applicable: true,
      version: 'v1',
      evidenceHash: 'document-hash-v1',
      subjectId: 'subject-a',
      received: true,
      review: {
        evidenceHash: 'document-hash-v1',
        decision: 'accepted',
        version: 'v1',
        subjectId: 'subject-a',
        authorized: true,
      },
    };
  return { draft, evidence };
}
test('review step always remains visible and defaults need no stage personalization', () => {
  const { draft, evidence } = fixture();
  assert.equal(
    isCaseWizardStepEnabled('stages', { ...draft.experience, configureWorkflow: false }),
    true
  );
  assert.equal(draft.reviewPolicy.approval.enabled, false);
  assert.equal(draft.reviewPolicy.completion.mode, 'automatic');
  assert.equal(evaluateCaseEligibility(draft, evidence).eligible, true);
});
test('a pending mandatory delivery can never qualify for closure', () => {
  const { draft, evidence } = fixture();
  evidence.content = {};
  const result = evaluateCaseEligibility(draft, evidence);
  assert.equal(result.eligible, false);
  assert.equal(result.nextState, 'pending');
});
test('progressive review is independent; collection mode excludes later generated documents', () => {
  const { draft, evidence } = fixture(2);
  const [first, second] = draft.sections[0].items;
  delete evidence.content[second.id];
  assert.deepEqual(evaluateCaseEligibility(draft, evidence).reviewableIds, [first.id]);
  draft.reviewPolicy.reviewTiming = 'after_collection';
  assert.deepEqual(evaluateCaseEligibility(draft, evidence).reviewableIds, []);
  evidence.content[second.id] = structuredClone(evidence.content[first.id]);
  draft.sections[0].items.push({ ...newCaseTemplateItem('document_template'), required: true });
  assert.equal(evaluateCaseEligibility(draft, evidence).reviewableIds.length, 2);
  assert.equal(evaluateCaseEligibility(draft, evidence).eligible, false);
});
test('replacing one of seven deliveries invalidates only that evidence review', () => {
  const { draft, evidence } = fixture(7);
  const item = draft.sections[0].items[0];
  evidence.content[item.id].version = 'v2';
  const result = evaluateCaseEligibility(draft, evidence);
  assert.equal(result.eligible, false);
  assert.equal(
    result.conditions.filter(
      (condition) => condition.key.startsWith('review:') && condition.status === 'satisfied'
    ).length,
    6
  );
});
test('manual closure remains gated and returns ready_to_close, never closed', () => {
  const { draft, evidence } = fixture();
  draft.reviewPolicy.completion = { mode: 'manual', role: 'owner' };
  assert.equal(evaluateCaseEligibility(draft, evidence).nextState, 'ready_to_close');
  evidence.blockingObservations = 1;
  assert.equal(evaluateCaseEligibility(draft, evidence).nextState, 'pending');
});
test('global approval must be authorized and refer to the current snapshot', () => {
  const { draft, evidence } = fixture();
  draft.reviewPolicy.approval = { enabled: true, role: 'admin' };
  assert.equal(evaluateCaseEligibility(draft, evidence).eligible, false);
  evidence.approval = { decision: 'approved', snapshotId: 'old-snapshot', authorized: true };
  assert.equal(evaluateCaseEligibility(draft, evidence).eligible, false);
  evidence.approval.snapshotId = evidence.snapshotId;
  assert.equal(evaluateCaseEligibility(draft, evidence).eligible, true);
  evidence.approval.authorized = false;
  assert.equal(evaluateCaseEligibility(draft, evidence).eligible, false);
});
test('missing approver and unknown applicability block instead of implying success', () => {
  const { draft, evidence } = fixture();
  draft.reviewPolicy.approval = { enabled: true, role: null };
  const item = draft.sections[0].items[0];
  item.conditional = true;
  evidence.content[item.id].applicable = null;
  assert.ok(
    evaluateCaseEligibility(draft, evidence).conditions.some(
      (condition) => condition.status === 'blocking'
    )
  );
  assert.equal(evaluateCaseEligibility(draft, evidence).eligible, false);
});
test('an unsubmitted optional item does not block a case with completed mandatory content', () => {
  const { draft, evidence } = fixture();
  draft.sections[0].items.push(newCaseTemplateItem('requested_document'));
  assert.equal(evaluateCaseEligibility(draft, evidence).eligible, true);
});
test('verification cannot be reused for a different subject', () => {
  const { draft, evidence } = fixture();
  const check = newCaseTemplateVerification('email_otp');
  draft.verifications.push(check);
  evidence.verifications[check.id] = {
    status: 'approved',
    subjectId: 'subject-b',
    authorizedResult: true,
  };
  assert.equal(evaluateCaseEligibility(draft, evidence).eligible, false);
  evidence.verifications[check.id].subjectId = evidence.subjectId;
  assert.equal(evaluateCaseEligibility(draft, evidence).eligible, true);
});
test('signature sending, partial completion and stale versions never qualify', () => {
  const { draft, evidence } = fixture();
  const item = draft.sections[0].items[0];
  draft.stages[0].activities = [{ id: 'sign', kind: 'sign', refId: item.id, required: true }];
  for (const status of ['sent', 'partial', 'cancelled', 'expired', 'rejected']) {
    evidence.signatures[item.id] = {
      status,
      version: 'v1',
      subjectId: evidence.subjectId,
      requestId: 'request-a',
      documentHash: 'document-hash-v1',
      evidenceHash: 'hash-a',
    };
    assert.equal(evaluateCaseEligibility(draft, evidence).eligible, false);
  }
  evidence.signatures[item.id].status = 'signed';
  evidence.signatures[item.id].version = 'old';
  assert.equal(evaluateCaseEligibility(draft, evidence).eligible, false);
  evidence.signatures[item.id].version = 'v1';
  assert.equal(evaluateCaseEligibility(draft, evidence).eligible, true);
});
test('empty content and evaluation failures cannot close automatically', () => {
  const { draft, evidence } = fixture();
  evidence.failedRequiredJobs = null;
  assert.equal(evaluateCaseEligibility(draft, evidence).eligible, false);
  draft.sections[0].items = [];
  evidence.failedRequiredJobs = 0;
  assert.equal(evaluateCaseEligibility(draft, evidence).eligible, false);
});
test('counts do not duplicate content referenced by several activities and conditions use future tense', () => {
  const { draft } = fixture();
  assert.equal(reviewPolicySources(draft).requested.length, 1);
  assert.ok(reviewClosureConditions(draft).every((condition) => condition.startsWith('Se exigir')));
  assert.equal(
    resolvedCaseWorkflow(draft).filter((stage) => stage.catalogKey === 'review')[0].dependsOn[0],
    'auto:opening'
  );
});
test('legacy custom flows and manual closure are retained without flattening', () => {
  const { draft } = fixture();
  draft.stages[0].catalogKey = 'custom';
  draft.stages.at(-1).completionMode = 'manual';
  draft.workflowMode = 'custom';
  const restored = parseStoredCaseTemplate({
    id: 'legacy',
    name: 'Legacy',
    description: '',
    case_type: '',
    case_subtype: null,
    status: 'draft',
    requirements_schema: {
      version: 5,
      sections: draft.sections,
      stages: draft.stages,
      workflowMode: 'custom',
    },
  });
  assert.equal(restored.reviewPolicy.origin, 'legacy');
  assert.equal(restored.reviewPolicy.completion.mode, 'manual');
  assert.deepEqual(
    resolvedCaseWorkflow(restored).map((stage) => stage.id),
    draft.stages.map((stage) => stage.id)
  );
  assert.equal(normalizeReviewPolicy({ version: 99 }).version, 99);
});
test('policy selections survive saving and reloading a draft', () => {
  const { draft } = fixture();
  draft.reviewPolicy.reviewTiming = 'after_collection';
  draft.reviewPolicy.approval = { enabled: true, role: 'admin' };
  draft.reviewPolicy.completion = { mode: 'manual', role: 'owner' };
  const restored = parseStoredCaseTemplate({
    id: 'draft',
    name: 'Draft',
    description: '',
    case_type: '',
    case_subtype: null,
    status: 'draft',
    requirements_schema: { version: 6, ...draft },
  });
  assert.deepEqual(restored.reviewPolicy, draft.reviewPolicy);
});
test('server validation rejects foreign resources, stale versions and unavailable execution', async () => {
  const { draft } = fixture();
  const form = { ...newCaseTemplateItem('form'), sourceId: 'private-form', sourceVersion: '1' };
  draft.sections[0].items.push(form);
  const capabilities = {
    transitions: true,
    versionedEvidence: true,
    approval: true,
    signatures: true,
  };
  const foreign = await validateCaseReviewPublication(
    draft,
    'workspace-a',
    { resource: async () => ({ workspaceId: 'workspace-b', status: 'published', version: '1' }) },
    capabilities
  );
  assert.ok(foreign.issues.some((issue) => issue.code === 'resource_access'));
  const stale = await validateCaseReviewPublication(
    draft,
    'workspace-a',
    { resource: async () => ({ workspaceId: 'workspace-a', status: 'published', version: '2' }) },
    capabilities
  );
  assert.ok(stale.issues.some((issue) => issue.code === 'resource_version'));
  const unavailable = await validateCaseReviewPublication(
    draft,
    'workspace-a',
    { resource: async () => ({ workspaceId: 'workspace-a', status: 'published', version: '1' }) },
    { ...capabilities, transitions: false }
  );
  assert.equal(unavailable.valid, false);
  assert.ok(unavailable.issues.some((issue) => issue.code === 'runtime_unavailable'));
});
test('failed source queries are errors, never interpreted as an empty source', async () => {
  const { draft } = fixture();
  draft.sections[0].items.push({ ...newCaseTemplateItem('form'), sourceId: 'form-a' });
  await assert.rejects(
    validateCaseReviewPublication(
      draft,
      'workspace-a',
      {
        resource: async () => {
          throw new Error('unavailable');
        },
      },
      { transitions: true, versionedEvidence: true, approval: true, signatures: true }
    )
  );
});

test('a material change without a matching evidence review cannot qualify', () => {
  const { draft, evidence } = fixture();
  evidence.content[draft.sections[0].items[0].id].evidenceHash = 'replaced-content-hash';
  assert.equal(evaluateCaseEligibility(draft, evidence).eligible, false);
});

test('no aplica requires an authorized rule for the same subject', () => {
  const { draft, evidence } = fixture();
  const item = draft.sections[0].items[0];
  evidence.content[item.id].applicable = false;
  assert.equal(evaluateCaseEligibility(draft, evidence).eligible, false);
  item.conditional = true;
  assert.equal(evaluateCaseEligibility(draft, evidence).eligible, false);
  evidence.content[item.id].applicabilityDecision = {
    authorized: true,
    ruleId: 'rule-a',
    subjectId: evidence.subjectId,
  };
  assert.equal(evaluateCaseEligibility(draft, evidence).eligible, true);
  evidence.content[item.id].applicabilityDecision.subjectId = 'another-subject';
  assert.equal(evaluateCaseEligibility(draft, evidence).eligible, false);
});

test('compiled collection review never waits for later generated output', () => {
  const { draft } = fixture();
  draft.reviewPolicy.reviewTiming = 'after_collection';
  const output = { ...newCaseTemplateItem('document_template'), requiresReview: true };
  draft.sections[0].items.push(output);
  const stages = resolvedCaseWorkflow(draft);
  const review = stages.find((stage) => stage.id === 'auto:review');
  assert.deepEqual(review.dependsOn, ['auto:documents']);
  assert.ok(
    !stages
      .find((stage) => stage.id === 'auto:documents')
      .activities.some((work) => work.refId === output.id)
  );
  assert.ok(
    stages
      .find((stage) => stage.id === 'auto:preparation')
      .activities.some((work) => work.refId === output.id)
  );
  assert.ok(
    stages
      .find((stage) => stage.id === 'auto:review-prepared')
      .activities.some((work) => work.refId === output.id)
  );
});

test('inherited document signature remains required in the compiled simple flow', () => {
  const { draft } = fixture();
  const item = draft.sections[0].items[0];
  draft.stages[0].activities = [
    { id: 'inherited-signature', kind: 'sign', refId: item.id, required: true },
  ];
  draft.experience.signAtClosure = false;
  assert.ok(
    resolvedCaseWorkflow(draft).some((stage) =>
      stage.activities.some((work) => work.kind === 'sign' && work.refId === item.id)
    )
  );
});

test('linked form revision is independently validated by the server', async () => {
  const { draft } = fixture();
  draft.sections[0].items.push({
    ...newCaseTemplateItem('form'),
    sourceId: 'form-a',
    sourceVersion: '1',
    sourceRevision: 2,
  });
  const result = await validateCaseReviewPublication(
    draft,
    'workspace-a',
    {
      resource: async () => ({
        workspaceId: 'workspace-a',
        status: 'published',
        version: '1',
        revision: 3,
      }),
    },
    { transitions: true, versionedEvidence: true, approval: true, signatures: true }
  );
  assert.ok(result.issues.some((issue) => issue.code === 'resource_version'));
});

test('synthetic supplier case requires collection, verification, approval and the current contract signature', () => {
  const { draft, evidence } = fixture(7);
  const form = newCaseTemplateItem('form');
  const contract = { ...newCaseTemplateItem('document_template'), title: 'Contrato de prueba' };
  const check = newCaseTemplateVerification('email_otp');
  draft.sections[0].items.push(form, contract);
  draft.verifications.push(check);
  draft.reviewPolicy.approval = { enabled: true, role: 'admin' };
  draft.stages[0].activities = [{ id: 'signature-contract', kind: 'sign', refId: contract.id, required: true }];
  evidence.content[form.id] = { applicable: true, version: 'response-v1', evidenceHash: 'response-hash', subjectId: evidence.subjectId, completed: true };
  evidence.content[contract.id] = { applicable: true, version: 'contract-v1', evidenceHash: 'contract-hash', subjectId: evidence.subjectId, generated: true };
  assert.equal(evaluateCaseEligibility(draft, evidence).canApprove, false);
  evidence.verifications[check.id] = { status: 'approved', subjectId: evidence.subjectId, authorizedResult: true };
  assert.equal(evaluateCaseEligibility(draft, evidence).canApprove, true);
  assert.equal(evaluateCaseEligibility(draft, evidence).canSign, false);
  evidence.approval = { decision: 'approved', snapshotId: evidence.snapshotId, authorized: true };
  assert.equal(evaluateCaseEligibility(draft, evidence).canSign, true);
  assert.equal(evaluateCaseEligibility(draft, evidence).eligible, false);
  evidence.signatures[contract.id] = { status: 'signed', version: 'contract-v1', subjectId: evidence.subjectId, requestId: 'test-request', documentHash: 'contract-hash', evidenceHash: 'test-signature-proof' };
  assert.equal(evaluateCaseEligibility(draft, evidence).eligible, true);
  evidence.content[contract.id].version = 'contract-v2';
  evidence.content[contract.id].evidenceHash = 'contract-new-hash';
  evidence.snapshotId = 'snapshot-after-material-change';
  assert.equal(evaluateCaseEligibility(draft, evidence).eligible, false);
});
