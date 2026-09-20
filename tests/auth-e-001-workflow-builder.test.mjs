import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  compileWorkflowBuilderDefinition,
  legacyDefinitionToBuilderDraft,
  validateWorkflowBuilderDraft,
} from '../src/lib/organization/workflow-definition.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const migration = await read(
  '../supabase/migrations/20260914054518_auth_e_001_workflow_builder_canonical_runtime.sql'
);
const runtimeMigration = await read(
  '../supabase/migrations/20260816050000_organization_workflow_resource_runtime.sql'
);
const api = await read('../src/app/api/organizacion/workflows/route.ts');
const builder = await read('../src/components/organization/OrganizationWorkflowBuilder.tsx');
const organizationView = await read(
  '../src/app/organizacion/_components/OrganizationGovernance.tsx'
);
const processor = await read('../src/lib/orchestration/processor.ts');

const ids = {
  start: '10000000-0000-4000-8000-000000000001',
  approval: '10000000-0000-4000-8000-000000000002',
  delay: '10000000-0000-4000-8000-000000000003',
  signature: '10000000-0000-4000-8000-000000000004',
  end: '10000000-0000-4000-8000-000000000005',
  edge1: '20000000-0000-4000-8000-000000000001',
  edge2: '20000000-0000-4000-8000-000000000002',
  edge3: '20000000-0000-4000-8000-000000000003',
  edge4: '20000000-0000-4000-8000-000000000004',
};

function node(id, type, label, config = {}) {
  return { id, type, label, position: { x: 80, y: 80 }, config };
}

function draft() {
  return {
    name: 'Aprobación contractual',
    description: 'Contrato de prueba',
    document_type: 'Contrato',
    applicable_areas: ['Legal'],
    nodes: [
      node(ids.start, 'start', 'Inicio'),
      node(ids.approval, 'approval', 'Aprobación legal'),
      node(ids.delay, 'delay', 'Espera', { duration_value: 2, duration_unit: 'days' }),
      node(ids.signature, 'signature', 'Firma', { completion_event: 'document.completed' }),
      node(ids.end, 'end', 'Fin', { outcome: 'approved' }),
    ],
    edges: [
      { id: ids.edge1, source: ids.start, target: ids.approval },
      { id: ids.edge2, source: ids.approval, target: ids.delay },
      { id: ids.edge3, source: ids.delay, target: ids.signature },
      { id: ids.edge4, source: ids.signature, target: ids.end },
    ],
  };
}

test('builder compiles a deterministic graph into the existing ordered runtime contract', () => {
  const compiled = compileWorkflowBuilderDefinition(draft());
  assert.equal(compiled.schema_version, 3);
  assert.equal(compiled.mode, 'directed_acyclic');
  assert.deepEqual(
    compiled.steps.map((step) => step.type),
    ['start', 'approval', 'wait', 'signature', 'approved']
  );
  assert.equal(compiled.steps[2].sla_hours, 48);
  assert.equal(compiled.steps[3].configuration.completion_event, 'document.completed');
});

test('builder rejects disconnected nodes and cycles before publication', () => {
  const disconnected = draft();
  disconnected.edges = disconnected.edges.slice(0, 2);
  const disconnectedResult = validateWorkflowBuilderDraft(disconnected);
  assert.equal(disconnectedResult.valid, false);
  assert.ok(disconnectedResult.issues.some((issue) => issue.code === 'disconnected_node'));

  const cycle = draft();
  cycle.edges[3] = { ...cycle.edges[3], target: ids.approval };
  const cycleResult = validateWorkflowBuilderDraft(cycle);
  assert.equal(cycleResult.valid, false);
  assert.ok(cycleResult.issues.some((issue) => issue.code === 'cycle_detected'));
});

test('legacy workflow_flows-style ordered definitions remain adaptable without rewriting history', () => {
  const adapted = legacyDefinitionToBuilderDraft({
    name: 'Legacy',
    definition: {
      mode: 'sequential',
      steps: [
        { id: ids.start, order: 1, type: 'start', label: 'Inicio' },
        { id: ids.approval, order: 2, type: 'review', label: 'Revisión' },
        { id: ids.end, order: 3, type: 'approved', label: 'Fin aprobado' },
      ],
    },
  });
  assert.ok(adapted);
  assert.deepEqual(
    adapted.nodes.map((item) => item.type),
    ['start', 'approval', 'end']
  );
  assert.equal(compileWorkflowBuilderDefinition(adapted).steps[1].type, 'approval');
});

test('migration extends the canonical organization runtime instead of creating another engine', () => {
  assert.match(
    runtimeMigration,
    /CREATE TABLE IF NOT EXISTS public\.organization_workflow_instances/
  );
  assert.match(migration, /ALTER TABLE public\.organization_workflow_step_instances/);
  assert.doesNotMatch(
    migration,
    /CREATE TABLE.*(?:builder_workflow_instances|workflow_engine_v[23])/is
  );
  assert.doesNotMatch(migration, /CREATE TABLE.*workflow_flows/is);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
});

test('published versions stay pinned and runtime snapshots the exact definition', () => {
  assert.match(
    migration,
    /workflow_record\.id, workflow_record\.version, workflow_record\.definition/
  );
  assert.match(migration, /definition_snapshot/);
  assert.match(migration, /only_draft_workflows_can_be_published/);
  assert.match(migration, /validate_organization_workflow_definition/);
});

test('signature and delay progression reuse canonical events and the Phase C scheduler', () => {
  assert.match(migration, /ON public\.document_operational_events/);
  assert.match(migration, /completion_event/);
  assert.match(migration, /advance_due_organization_workflow_steps/);
  assert.match(migration, /FOR UPDATE SKIP LOCKED/);
  assert.match(processor, /PHASE_E_FEATURES\.workflowBuilder/);
  assert.match(processor, /advance_due_organization_workflow_steps/);
});

test('workflow API enforces organization RBAC and the existing Phase E feature flag', () => {
  assert.match(api, /authorizeOrganizationRequest/);
  assert.match(api, /workflows\.manage/);
  assert.match(api, /PHASE_E_FEATURES\.workflowBuilder/);
  assert.match(api, /compileWorkflowBuilderDefinition/);
  assert.match(api, /publish_organization_workflow/);
});

test('existing organization workflow screen is evolved by the V2 node palette', () => {
  assert.match(organizationView, /OrganizationWorkflowBuilder/);
  assert.match(organizationView, /showForm && !builderEnabled/);
  assert.match(builder, /'notification'/);
  assert.match(builder, /'action'/);
  assert.match(builder, /'webhook'/);
  assert.match(builder, /'condition'/);
});

test('AUTH-E-001 leaves cryptographic and out-of-scope systems untouched', () => {
  assert.doesNotMatch(migration, /PAdES|ByteRange|NOM-151|KMS|Evidence Package|organization_sso/i);
  assert.doesNotMatch(api + builder, /prefilled|N_OF_M|cross.?tenant.?custody/i);
});
