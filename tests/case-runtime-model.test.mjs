import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const bundle = await build({
  stdin: {
    contents: `export * from './src/lib/case-files/runtime-model';export * from './src/lib/case-files/template-builder';export * from './src/lib/case-files/workflow';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const {
  evaluateRuntimeSnapshot: evaluate,
  emptyCaseTemplate,
  newCaseTemplateItem,
  resolvedCaseWorkflow,
  newCaseTemplateVerification,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
function fixture({ approval = true, signatures = true, manual = true, count = 1 } = {}) {
  const d = emptyCaseTemplate();
  d.name = 'QA';
  d.workflowMode = 'simple';
  d.reviewPolicy.approval = { enabled: approval, role: 'member' };
  d.reviewPolicy.completion = {
    mode: manual ? 'manual' : 'automatic',
    role: manual ? 'owner' : null,
  };
  d.sections[0].items = Array.from({ length: count }, (_, i) => ({
    ...newCaseTemplateItem('requested_document'),
    id: `item-${i}`,
    title: `Documento ${i}`,
    requiresReview: true,
    reviewerRole: 'member',
    requiresSignature: signatures,
  }));
  d.stages = resolvedCaseWorkflow(d);
  const s = {
    revision: 'revision-1',
    case: {
      id: 'case',
      workspace_id: 'workspace',
      owner_user_id: 'owner',
      runtime_subject_id: 'subject',
      runtime_assignments: { approver: 'approver', closer: 'owner' },
      status: 'in_review',
    },
    template: { name: d.name, requirements_schema: { ...d } },
    members: ['owner', 'reviewer', 'approver'].map((user_id) => ({
      user_id,
      role: user_id === 'owner' ? 'owner' : 'member',
      status: 'active',
      access_expires_at: null,
    })),
    participants: [{ id: 'subject', user_id: 'owner' }],
    requirements: [],
    documents: [],
    document_versions: [],
    source_versions: [],
    sources: [],
    reviews: [],
    references: [],
    completions: [],
    signature_evidence: [],
    checks: [],
    observations: [],
    milestones: [],
  };
  d.sections[0].items.forEach((item, i) => {
    const id = `doc-${i}`,
      version = `version-${i}`,
      sha = 'a'.repeat(64),
      ref = `ref-${i}`;
    s.requirements.push({ id: `req-${i}`, settings: item, reviewer_user_id: 'reviewer' });
    s.documents.push({
      id: `binding-${i}`,
      requirement_id: `req-${i}`,
      source_document_id: id,
      current_version: 1,
      sha256_hash: sha,
      validation_result: { sourceVersionId: version },
    });
    s.document_versions.push({ document_id: `binding-${i}`, version: 1, sha256_hash: sha });
    s.source_versions.push({ id: version, document_id: id, version_number: 1, sha256: sha });
    s.sources.push({
      id,
      nombre: item.title,
      estado: 'en_proceso',
      file_hash_sha256: sha,
      participantes: signatures
        ? [{ id: 'owner', user_id: 'owner', role: 'firmante', participant_ref_id: ref }]
        : [],
    });
    s.reviews.push({
      id: `review-${i}`,
      reviewer_user_id: 'reviewer',
      document_id: `binding-${i}`,
      decision: 'accepted',
      comparison_result: { itemId: item.id, version, evidenceHash: sha, subjectId: 'subject' },
    });
    if (signatures)
      s.references.push({
        id: ref,
        document_id: id,
        participant_json_id: 'owner',
        participant_user_id: 'owner',
        active: true,
        snapshot: { role: 'firmante' },
      });
  });
  return s;
}
function approve(s) {
  s.case.review_approval = {
    decision: 'approved',
    actorId: 'approver',
    snapshotId: evaluate(s).snapshotId,
  };
}
function sign(s, i = 0) {
  s.completions.push({
    id: `completion-${i}`,
    document_id: `doc-${i}`,
    document_version_id: `version-${i}`,
    participant_reference_id: `ref-${i}`,
    actor_user_id: 'owner',
    action_type: 'signature',
    status: 'committed',
    signature_evidence_id: `signature-${i}`,
  });
  s.signature_evidence.push({
    id: `signature-${i}`,
    document_id: `doc-${i}`,
    document_version_id: `version-${i}`,
    captured_by: 'owner',
    document_sha256: 'a'.repeat(64),
    signature_hash: 'b'.repeat(64),
    is_voided: false,
  });
}
test('real-source evaluator gates approval then canonical signature then closure', () => {
  const s = fixture();
  assert.equal(evaluate(s).canApprove, true);
  assert.equal(evaluate(s).canSign, false);
  approve(s);
  assert.equal(evaluate(s).canSign, true);
  assert.equal(evaluate(s).eligible, false);
  sign(s);
  assert.equal(evaluate(s).eligible, true);
});
test('document status alone never counts as a signature', () => {
  const s = fixture();
  approve(s);
  s.sources[0].estado = 'completado';
  assert.equal(evaluate(s).eligible, false);
});
test('an uncommitted signature and a voided provider proof cannot close', () => {
  const s = fixture();
  approve(s);
  sign(s);
  s.completions[0].status = 'claimed';
  assert.equal(evaluate(s).eligible, false);
  s.completions[0].status = 'committed';
  s.signature_evidence[0].is_voided = true;
  assert.equal(evaluate(s).eligible, false);
});
test('a provider proof for a different document version, hash or actor is rejected', () => {
  for (const [key, value] of [
    ['document_version_id', 'stale'],
    ['document_sha256', 'wrong'],
    ['captured_by', 'other'],
  ]) {
    const s = fixture();
    approve(s);
    sign(s);
    s.signature_evidence[0][key] = value;
    assert.equal(evaluate(s).eligible, false, key);
  }
});
test('all independent configured signers are required', () => {
  const s = fixture();
  approve(s);
  sign(s);
  s.sources[0].participantes.push({ id: 'second', role: 'firmante' });
  assert.equal(evaluate(s).eligible, false);
});
test('partial signatures across documents do not complete', () => {
  const s = fixture({ count: 2 });
  approve(s);
  sign(s);
  assert.equal(evaluate(s).eligible, false);
  sign(s, 1);
  assert.equal(evaluate(s).eligible, true);
});
test('replacing only one delivery preserves the other independent reviews', () => {
  const s = fixture({ count: 7, signatures: false });
  approve(s);
  s.source_versions.push({
    id: 'new',
    document_id: 'doc-2',
    version_number: 2,
    sha256: 'c'.repeat(64),
  });
  const result = evaluate(s);
  assert.equal(result.eligible, false);
  assert.equal(result.evidence.content['item-1'].review.authorized, true);
  assert.equal(result.evidence.content['item-2'], undefined);
});
test('revoking reviewer or approver access makes their decisions unusable', () => {
  for (const actor of ['reviewer', 'approver']) {
    const s = fixture({ signatures: false });
    approve(s);
    s.members.find((m) => m.user_id === actor).status = 'revoked';
    assert.equal(evaluate(s).eligible, false, actor);
  }
});
test('expired membership is not authorized', () => {
  const s = fixture({ signatures: false });
  approve(s);
  s.members[1].access_expires_at = '2000-01-01T00:00:00Z';
  assert.equal(evaluate(s).eligible, false);
});
test('corrections remain blocking until an explicit new decision', () => {
  const s = fixture({ signatures: false });
  s.case.review_approval = { decision: 'corrections', actorId: 'approver' };
  assert.equal(evaluate(s).eligible, false);
  assert.equal(evaluate(s).canApprove, true);
});
test('accepting a new version requires a new global approval', () => {
  const s = fixture({ signatures: false });
  approve(s);
  s.documents[0].current_version = 2;
  s.documents[0].validation_result.sourceVersionId = 'new';
  s.sources[0].file_hash_sha256 = 'c'.repeat(64);
  s.source_versions.push({
    id: 'new',
    document_id: 'doc-0',
    version_number: 2,
    sha256: 'c'.repeat(64),
  });
  s.document_versions.push({ document_id: 'binding-0', version: 2, sha256_hash: 'c'.repeat(64) });
  s.reviews.push({
    ...s.reviews[0],
    comparison_result: {
      itemId: 'item-0',
      version: 'new',
      evidenceHash: 'c'.repeat(64),
      subjectId: 'subject',
    },
  });
  assert.equal(evaluate(s).eligible, false);
  approve(s);
  assert.equal(evaluate(s).eligible, true);
});
test('operational signature fields do not stale final approval', () => {
  const s = fixture();
  approve(s);
  const original = s.case.review_approval.snapshotId;
  sign(s);
  s.sources[0].participantes[0].sub_estado = 'firmo';
  assert.equal(evaluate(s).snapshotId, original);
  assert.equal(evaluate(s).eligible, true);
});
test('changing a signer invalidates final approval', () => {
  const s = fixture();
  approve(s);
  s.sources[0].participantes[0].email = 'changed@example.invalid';
  assert.equal(evaluate(s).canSign, false);
});
test('ANY_ONE group requires its actual winning committed evidence', () => {
  const s = fixture();
  s.signing_groups = [
    {
      id: 'group',
      document_id: 'doc-0',
      completion_policy: 'ANY_ONE',
      status: 'satisfied',
      winner_participant_reference_id: 'ref-0',
    },
  ];
  s.signing_members = [
    { group_id: 'group', document_id: 'doc-0', participant_reference_id: 'ref-0' },
  ];
  approve(s);
  assert.equal(evaluate(s).eligible, false);
  sign(s);
  assert.equal(evaluate(s).eligible, true);
});
test('delegated completion requires the effective signer evidence', () => {
  const s = fixture();
  approve(s);
  sign(s);
  s.completions[0].effective_actor_user_id = 'delegate';
  assert.equal(evaluate(s).eligible, false);
  s.signature_evidence[0].captured_by = 'delegate';
  assert.equal(evaluate(s).eligible, true);
});
test('expired configured document validity blocks closure', () => {
  const s = fixture({ signatures: false });
  approve(s);
  s.documents[0].expires_at = '2000-01-01T00:00:00Z';
  assert.equal(evaluate(s).eligible, false);
});
test('email evidence is scoped to the current subject and verified challenge', () => {
  const s = fixture({ approval: false, signatures: false });
  const check = { ...newCaseTemplateVerification('email_otp'), id: 'email', required: true };
  s.template.requirements_schema.verifications = [check];
  s.checks = [
    {
      id: 'check',
      participant_id: 'subject',
      template_verification_id: 'email',
      method: 'email_otp',
      status: 'approved',
      evidence_hash: 'proof',
      result: { proof: { type: 'email_otp', sourceId: 'challenge' } },
    },
  ];
  assert.equal(evaluate(s).eligible, false);
  s.email_proofs = [{ id: 'challenge', subjectId: 'other', verified_at: '2026-01-01' }];
  assert.equal(evaluate(s).eligible, false);
  s.email_proofs[0].subjectId = 'subject';
  assert.equal(evaluate(s).eligible, true);
});
test('manual advanced stages require their explicit authorized completion', () => {
  const s = fixture({ approval: false, signatures: false });
  const stages = [
    {
      id: 'manual',
      catalogKey: 'custom',
      title: 'Control manual',
      completionMode: 'manual',
      coordinatorRole: 'owner',
      dependsOn: [],
      activities: [{ kind: 'review_document', refId: 'item-0' }],
    },
  ];
  s.template.requirements_schema.workflowMode = 'custom';
  s.template.requirements_schema.stages = stages;
  assert.equal(evaluate(s).eligible, false);
  assert.deepEqual(evaluate(s).readyStageIds, ['manual']);
  s.milestones = [{ completion_condition_json: { id: 'manual' }, status: 'completed' }];
  assert.equal(evaluate(s).eligible, true);
});
test('an absent optional signed document cannot block unrelated mandatory content', () => {
  const s = fixture({ approval: false, signatures: false });
  s.template.requirements_schema.sections[0].items.push({
    ...newCaseTemplateItem('requested_document'),
    id: 'optional',
    required: false,
    requiresReview: false,
    requiresSignature: true,
    reviewerRole: null,
  });
  assert.equal(evaluate(s).eligible, true);
});
test('a finalized PDF response is content evidence; a form waiting for a signature still needs its real proof', () => {
  const s = fixture({ approval: false, signatures: false });
  const item = s.template.requirements_schema.sections[0].items[0];
  item.kind = 'form';
  item.sourceId = 'form-template';
  s.forms = [
    {
      id: 'form',
      form_template_id: 'form-template',
      template_item_id: item.id,
      reviewer_user_id: 'reviewer',
      settings: item,
    },
  ];
  s.submissions = [
    {
      id: 'submission',
      case_form_id: 'form',
      form_response_id: 'response',
      sha256_hash: 'c'.repeat(64),
    },
  ];
  s.responses = [
    {
      id: 'response',
      template_id: 'form-template',
      respondent_user_id: 'owner',
      status: 'pdf_generated',
      submitted_at: '2026-01-01',
      pdf_output_hash: 'c'.repeat(64),
    },
  ];
  s.reviews = [
    {
      reviewer_user_id: 'reviewer',
      decision: 'accepted',
      comparison_result: {
        itemId: item.id,
        version: 'response',
        evidenceHash: 'c'.repeat(64),
        subjectId: 'subject',
      },
    },
  ];
  assert.equal(evaluate(s).eligible, true);
  s.participants[0].user_id = null;
  s.responses[0].respondent_user_id = null;
  s.responses[0].subject_matched = true;
  assert.equal(evaluate(s).eligible, true);
  s.responses[0].subject_matched = false;
  assert.equal(evaluate(s).eligible, false);
  s.responses[0].subject_matched = true;
  item.requiresSignature = true;
  assert.equal(evaluate(s).eligible, false);
});
