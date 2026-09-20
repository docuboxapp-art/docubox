import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  compileWorkflowBuilderDefinition,
  validateWorkflowBuilderDraft,
} from '../src/lib/organization/workflow-definition.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const migration = await read(
  '../supabase/migrations/20260914151842_workflow_builder_v2_deferred_nodes.sql'
);
const runtime = await read('../src/lib/organization/workflow-runtime.ts');
const processor = await read('../src/lib/orchestration/processor.ts');
const builder = await read('../src/components/organization/OrganizationWorkflowBuilder.tsx');
const api = await read('../src/app/api/organizacion/workflows/route.ts');
const automation = await read('../src/lib/collaboration/automation.ts');
const webhookDispatcher = await read('../src/lib/organization/webhook-dispatcher.ts');

const id = (index) => `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const edgeId = (index) => `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const node = (index, type, label, config = {}) => ({
  id: id(index),
  type,
  label,
  position: { x: 80, y: index * 100 },
  config,
});

function conditionalDraft() {
  return {
    name: 'Contrato con condición',
    description: null,
    document_type: 'Contrato',
    applicable_areas: ['Legal'],
    nodes: [
      node(1, 'start', 'Inicio'),
      node(2, 'condition', '¿Está completado?', {
        condition: { field: 'document.status', operator: 'equals', value: 'completado' },
      }),
      node(3, 'action', 'Registrar actividad', {
        action: { type: 'activity', summary: 'Contrato completado.' },
      }),
      node(4, 'end', 'Fin verdadero', { outcome: 'approved' }),
      node(5, 'end', 'Fin falso', { outcome: 'cancelled' }),
    ],
    edges: [
      { id: edgeId(1), source: id(1), target: id(2) },
      { id: edgeId(2), source: id(2), target: id(3), branch: 'true' },
      { id: edgeId(3), source: id(2), target: id(5), branch: 'false' },
      { id: edgeId(4), source: id(3), target: id(4) },
    ],
  };
}

test('condition compiles to the canonical DAG contract with explicit true and false transitions', () => {
  const compiled = compileWorkflowBuilderDefinition(conditionalDraft());
  assert.equal(compiled.schema_version, 3);
  assert.equal(compiled.mode, 'directed_acyclic');
  const condition = compiled.steps.find((step) => step.type === 'condition');
  assert.equal(condition.configuration.true_step_id, id(3));
  assert.equal(condition.configuration.false_step_id, id(5));
  assert.equal(new Set(compiled.steps.map((step) => step.id)).size, 5);
});

test('condition validation rejects an invalid field, operator and missing false branch', () => {
  const invalid = conditionalDraft();
  invalid.nodes[1].config.condition = { field: 'secrets.token', operator: 'eval', value: 'x' };
  invalid.edges = invalid.edges.filter((edge) => edge.branch !== 'false');
  const result = validateWorkflowBuilderDraft(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === 'condition_configuration_invalid'));
  assert.ok(result.issues.some((issue) => issue.code === 'condition_branches_invalid'));
});

test('notification node accepts controlled channels and rejects unsupported channels', () => {
  const draft = conditionalDraft();
  draft.nodes[2] = node(3, 'notification', 'Avisar', {
    channels: ['in_app', 'email'],
    recipient: 'owner',
    title: 'Documento listo',
    message: 'El documento está listo.',
    delivery_policy: 'fallback',
  });
  assert.equal(validateWorkflowBuilderDraft(draft).valid, true);
  draft.nodes[2].config.channels = ['whatsapp'];
  assert.equal(validateWorkflowBuilderDraft(draft).valid, false);
});

test('all Agreement Action types exposed by V2 use the existing action contract', () => {
  const actions = [
    {
      type: 'notify',
      target: 'owner',
      title: 'Aviso',
      message: 'Mensaje',
      channels: ['in_app'],
      delivery_policy: 'single',
    },
    { type: 'activity', summary: 'Actividad' },
    { type: 'webhook', endpoint_id: id(40) },
    { type: 'document_metadata', name: 'estado_gestion', value: 'revisado' },
    { type: 'create_task', title: 'Revisar contrato', assigned_to: 'owner' },
    { type: 'request_nom151' },
    { type: 'trigger_lucia_contractual' },
  ];
  for (const action of actions) {
    const draft = conditionalDraft();
    draft.nodes[2].config = { action };
    assert.equal(validateWorkflowBuilderDraft(draft).valid, true, action.type);
  }
  const draft = conditionalDraft();
  draft.nodes[2].config = { action: { type: 'run_javascript', code: 'alert(1)' } };
  assert.equal(validateWorkflowBuilderDraft(draft).valid, false);
});

test('webhook nodes store only an authorized endpoint reference, never a secret', () => {
  const draft = conditionalDraft();
  draft.nodes[2] = node(3, 'webhook', 'Enviar webhook', {
    webhook_configuration_id: id(30),
  });
  const compiled = compileWorkflowBuilderDefinition(draft);
  const serialized = JSON.stringify(compiled);
  assert.match(serialized, /webhook_configuration_id/);
  assert.doesNotMatch(serialized, /hmac_secret|secret_ciphertext|whsec|password|token/i);
  assert.match(api, /workflow_webhook_reference_invalid/);
});

test('runtime reuses Notification Service, Agreement Actions, dispatcher and condition engine', () => {
  assert.match(runtime, /emitDomainEvent/);
  assert.match(runtime, /executeAgreementAction/);
  assert.match(runtime, /queueWebhookDeliveriesForEvent/);
  assert.match(runtime, /evaluateAutomationConditions/);
  assert.match(automation, /export async function executeAgreementAction/);
  assert.match(webhookDispatcher, /canonical:\$\{event\.id\}:endpoint:\$\{endpoint\.id\}/);
});

test('branch decision is persisted once and reused after retry', () => {
  assert.match(migration, /branch_decision = COALESCE\(branch_decision, requested_decision\)/);
  assert.match(runtime, /reused_committed_decision/);
  assert.match(runtime, /if \(decision === null\)/);
  assert.match(migration, /record_organization_workflow_branch_decision/);
});

test('workflow steps use atomic claims, bounded retries and the existing Phase C scheduler', () => {
  assert.match(migration, /FOR UPDATE OF step SKIP LOCKED/);
  assert.match(migration, /execution_claim_token/);
  assert.match(migration, /INTERVAL '5 minutes'/);
  assert.match(runtime, /MAX_ATTEMPTS = 5/);
  assert.match(processor, /processOrganizationWorkflowExecutionSteps/);
  assert.doesNotMatch(migration, /CREATE TABLE.*workflow.*(?:queue|execution|instance)/is);
});

test('published workflow validation blocks cross-tenant or inactive webhook references', () => {
  assert.match(api, /\.eq\('workspace_id', workspaceId\)/);
  assert.match(api, /\.eq\('status', 'active'\)/);
  assert.match(migration, /endpoint\.workspace_id = ws_id/);
  assert.match(migration, /endpoint\.status = 'active'/);
});

test('palette extends the existing builder without exposing WhatsApp, Push or arbitrary code', () => {
  for (const type of ['notification', 'action', 'webhook', 'condition']) {
    assert.match(builder, new RegExp(`'${type}'`));
  }
  assert.doesNotMatch(builder, /<option[^>]+value=["'](?:whatsapp|push)["']/i);
  assert.doesNotMatch(builder + runtime, /\beval\s*\(|new Function|child_process|execSync/);
});

test('V2 remains additive and preserves version pinning and cryptographic boundaries', () => {
  assert.match(migration, /definition_snapshot/);
  assert.match(migration, /workflow_record\.version/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
  assert.doesNotMatch(
    migration + runtime,
    /ByteRange|signed_pdf|Evidence Package|KMS|PAdES|TSA provider/i
  );
});
