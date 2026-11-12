import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  stdin: {
    contents: `export {caseEvidenceProgress} from './src/lib/case-files/runtime-progress';
      export {refreshCaseControl} from './src/lib/case-files/runtime.server';
      export {emptyCaseTemplate,newCaseTemplateItem} from './src/lib/case-files/template-builder';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'external-auth-boundaries',
      setup(b) {
        const stubs = {
          'server-only': 'export {};',
          'next/headers': 'export const cookies=()=>{throw Error("Unexpected auth access");};',
          '@supabase/ssr':
            'export const createServerClient=()=>{throw Error("Unexpected auth client");};',
          '@/lib/supabase/server':
            'export const createServiceClient=()=>{throw Error("Unexpected global service");};',
          '@/lib/security/document-access':
            'export const requireDocumentIdentity=()=>{throw Error("Unexpected signing access");};',
        };
        b.onResolve({ filter: /.*/ }, (a) =>
          Object.hasOwn(stubs, a.path) ? { path: a.path, namespace: 'test-auth' } : undefined
        );
        b.onLoad({ filter: /.*/, namespace: 'test-auth' }, (a) => ({
          contents: stubs[a.path],
          loader: 'js',
        }));
      },
    },
  ],
});
const api = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);
const condition = (key, status) => ({ key, status, reason: 'Synthetic QA' });

test('an untouched case remains at zero despite successful background checks or optional omissions', () => {
  assert.equal(
    api.caseEvidenceProgress([
      condition('content:document', 'pending'),
      condition('content:form', 'pending'),
      condition('observations', 'satisfied'),
      condition('jobs', 'satisfied'),
      condition('content:optional', 'not_applicable'),
    ]),
    0
  );
  assert.equal(api.caseEvidenceProgress([]), 0);
  assert.equal(api.caseEvidenceProgress([condition('content:optional', 'not_applicable')]), 0);
});

test('review, identity, approval, signatures and stages remain pending until their own evidence is satisfied', () => {
  const conditions = [
    'content:document',
    'review:document',
    'verification:id',
    'approval',
    'signature:document',
    'stage:qa',
  ].map((k) => condition(k, 'pending'));
  for (let done = 0; done <= conditions.length; done++) {
    assert.equal(
      api.caseEvidenceProgress(conditions),
      Math.round((100 * done) / conditions.length)
    );
    if (done < conditions.length) conditions[done].status = 'satisfied';
  }
  conditions[0].status = 'blocking';
  assert.equal(api.caseEvidenceProgress(conditions), 83);
});

test('actual runtime refresh persists document and linked-form progress while preserving manual closure', async () => {
  const draft = api.emptyCaseTemplate();
  draft.name = 'Isolated portal progress';
  draft.workflowMode = 'recommended';
  draft.stages = [];
  draft.reviewPolicy.approval = { enabled: false, role: null };
  draft.reviewPolicy.completion = { mode: 'manual', role: 'owner' };
  draft.sections[0].items = [
    {
      ...api.newCaseTemplateItem('requested_document'),
      id: 'doc-item',
      title: 'Documento QA',
      required: true,
      requiresReview: false,
      reviewerRole: null,
      requiresSignature: false,
    },
    {
      ...api.newCaseTemplateItem('form'),
      id: 'form-item',
      title: 'Formulario QA',
      sourceId: 'template-form',
      required: true,
      requiresReview: false,
      reviewerRole: null,
      requiresSignature: false,
    },
  ];
  const snapshot = {
    revision: 'r1',
    case: {
      id: 'case',
      status: 'integrating',
      progress: 0,
      workspace_id: 'workspace',
      owner_user_id: 'owner',
      runtime_subject_id: 'subject',
      runtime_assignments: { closer: 'owner' },
    },
    template: { name: draft.name, requirements_schema: { ...draft, version: 6 } },
    members: [{ user_id: 'owner', role: 'owner', status: 'active', access_expires_at: null }],
    participants: [{ id: 'subject', user_id: 'owner' }],
    requirements: [{ id: 'req', settings: draft.sections[0].items[0] }],
    forms: [
      {
        id: 'form',
        template_item_id: 'form-item',
        form_template_id: 'template-form',
        settings: draft.sections[0].items[1],
      },
    ],
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
    submissions: [],
    responses: [],
  };
  const updates = [];
  const service = {
    async rpc(name, args) {
      if (name === 'case_control_snapshot') return { data: structuredClone(snapshot), error: null };
      assert.equal(name, 'case_control_apply');
      assert.equal(args.p_command, 'refresh');
      updates.push(args.p_evaluation);
      snapshot.case.progress = Math.min(99, args.p_evaluation.progress);
      snapshot.case.status = args.p_evaluation.eligible
        ? 'ready_to_close'
        : args.p_evaluation.operationalStatus;
      return { data: {}, error: null };
    },
  };
  await api.refreshCaseControl(service, 'case', 'owner');
  assert.equal(snapshot.case.progress, 0, JSON.stringify(updates.at(-1)?.conditions));
  const hash = 'a'.repeat(64);
  snapshot.documents.push({
    id: 'binding',
    requirement_id: 'req',
    source_document_id: 'document',
    current_version: 1,
    sha256_hash: hash,
    validation_result: { sourceVersionId: 'v1' },
  });
  snapshot.document_versions.push({ document_id: 'binding', version: 1, sha256_hash: hash });
  snapshot.source_versions.push({
    id: 'v1',
    document_id: 'document',
    version_number: 1,
    sha256: hash,
  });
  snapshot.sources.push({
    id: 'document',
    nombre: 'Documento QA',
    estado: 'en_proceso',
    file_hash_sha256: hash,
    participantes: [],
  });
  await api.refreshCaseControl(service, 'case', 'owner');
  assert.equal(snapshot.case.progress, 50);
  snapshot.submissions.push({
    id: 'submission',
    case_form_id: 'form',
    form_response_id: 'response',
    sha256_hash: hash,
  });
  snapshot.responses.push({
    id: 'response',
    template_id: 'template-form',
    respondent_user_id: 'owner',
    status: 'started',
    submitted_at: '2026-11-10T00:00:00Z',
    pdf_output_hash: null,
  });
  await api.refreshCaseControl(service, 'case', 'owner');
  assert.equal(snapshot.case.progress, 50, 'an unfinished PDF is not a form receipt');
  snapshot.responses[0].status = 'pdf_generated';
  snapshot.responses[0].pdf_output_hash = hash;
  await api.refreshCaseControl(service, 'case', 'owner');
  assert.equal(updates.at(-1).progress, 100);
  assert.equal(snapshot.case.progress, 99, 'manual closure still required');
  assert.equal(snapshot.case.status, 'ready_to_close');
});
