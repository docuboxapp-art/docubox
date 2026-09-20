BEGIN;

SELECT plan(16);

SELECT has_column('public', 'organization_workflow_step_instances', 'configuration', 'runtime step stores version-pinned configuration');
SELECT has_column('public', 'organization_workflow_step_instances', 'completion_event_id', 'runtime step correlates canonical completion event');
SELECT has_function('public', 'validate_organization_workflow_definition', ARRAY['jsonb'], 'definition validator exists');
SELECT has_function('public', 'complete_organization_workflow_step', ARRAY['uuid','uuid','text','text','text'], 'manual approval transition exists');
SELECT has_function('public', 'advance_due_organization_workflow_steps', ARRAY['timestamp with time zone','integer'], 'existing scheduler adapter exists');

SELECT ok(NOT has_function_privilege('anon', 'public.complete_organization_workflow_step(uuid,uuid,text,text,text)', 'EXECUTE'), 'anonymous cannot complete workflow steps');
SELECT ok(has_function_privilege('authenticated', 'public.complete_organization_workflow_step(uuid,uuid,text,text,text)', 'EXECUTE'), 'authenticated organization users reach RBAC-protected transition');
SELECT ok(NOT has_function_privilege('authenticated', 'public.advance_due_organization_workflow_steps(timestamp with time zone,integer)', 'EXECUTE'), 'browser cannot run scheduled transitions');
SELECT ok(has_function_privilege('service_role', 'public.advance_due_organization_workflow_steps(timestamp with time zone,integer)', 'EXECUTE'), 'existing worker can run due transitions');
SELECT ok(NOT has_function_privilege('authenticated', 'public.advance_organization_workflow_instance_internal(uuid,text,text,uuid,uuid,text,jsonb)', 'EXECUTE'), 'internal transition is not browser callable');

SELECT trigger_is(
  'public',
  'document_operational_events',
  'advance_org_workflow_on_document_event',
  'public',
  'advance_organization_workflow_from_canonical_event',
  'signature steps consume the canonical document event stream'
);
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.organization_workflow_instances'::regclass), 'canonical instance RLS remains enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.organization_workflow_step_instances'::regclass), 'canonical step RLS remains enabled');
SELECT ok(public.validate_organization_workflow_definition('{"schema_version":2,"mode":"sequential","builder":{"nodes":[{"id":"a","type":"start","label":"Inicio"},{"id":"b","type":"end","label":"Fin"}],"edges":[{"id":"e","source":"a","target":"b"}]},"steps":[{"id":"a","order":1,"type":"start","label":"Inicio"},{"id":"b","order":2,"type":"approved","label":"Fin"}]}'::jsonb), 'minimal builder definition validates');
SELECT ok(NOT public.validate_organization_workflow_definition('{"schema_version":2,"mode":"sequential","builder":{"nodes":[{"id":"a","type":"start","label":"Inicio"},{"id":"b","type":"end","label":"Fin"}],"edges":[{"id":"e","source":"a","target":"b"}]},"steps":[{"id":"a","order":1,"type":"start","label":"Inicio"},{"id":"b","order":3,"type":"approved","label":"Fin"}]}'::jsonb), 'non-contiguous runtime order is rejected');
SELECT is((SELECT global_enabled FROM public.platform_feature_flags WHERE flag_key = 'workflow_builder'), FALSE, 'production feature flag remains disabled by default');

SELECT * FROM finish();
ROLLBACK;
