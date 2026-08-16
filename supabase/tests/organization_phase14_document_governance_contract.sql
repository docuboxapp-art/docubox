BEGIN;

SELECT plan(9);

SELECT has_column('public', 'documentos', 'organization_workflow_id', 'document workflow reference exists');
SELECT has_column('public', 'documentos', 'organization_signature_policy_id', 'document policy reference exists');
SELECT has_column('public', 'documentos', 'organization_workflow_instance_id', 'document workflow instance exists');
SELECT has_column('public', 'documentos', 'organization_governance_snapshot', 'document governance snapshot exists');
SELECT has_column('public', 'documentos', 'organization_governance_applied_at', 'document governance timestamp exists');
SELECT has_trigger('public', 'documentos', 'protect_document_governance_snapshot', 'governance snapshot has a protection trigger');
SELECT has_index('public', 'documentos', 'idx_documentos_organization_workflow', 'workflow lookup is indexed');
SELECT has_index('public', 'documentos', 'idx_documentos_organization_policy', 'policy lookup is indexed');
SELECT has_function(
  'public',
  'set_organization_governance_default',
  ARRAY['uuid', 'text', 'uuid', 'uuid'],
  'governance defaults are updated transactionally'
);

SELECT * FROM finish();
ROLLBACK;
