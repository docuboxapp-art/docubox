BEGIN;

SELECT plan(18);

SELECT has_column('public', 'organization_workflow_step_instances', 'attempt_count', 'canonical step tracks attempts');
SELECT has_column('public', 'organization_workflow_step_instances', 'execution_claim_token', 'canonical step stores a worker claim');
SELECT has_column('public', 'organization_workflow_step_instances', 'next_retry_at', 'canonical step schedules bounded retry');
SELECT has_column('public', 'organization_workflow_step_instances', 'branch_decision', 'canonical step persists condition decision');

SELECT has_function('public', 'claim_due_organization_workflow_execution_step', ARRAY['timestamp with time zone'], 'worker claim function exists');
SELECT has_function('public', 'record_organization_workflow_branch_decision', ARRAY['uuid','uuid','boolean'], 'branch decision function exists');
SELECT has_function('public', 'finish_organization_workflow_execution_step', ARRAY['uuid','uuid','text','uuid','jsonb','text'], 'worker completion function exists');

SELECT ok(NOT has_function_privilege('anon', 'public.claim_due_organization_workflow_execution_step(timestamp with time zone)', 'EXECUTE'), 'anonymous cannot claim workflow execution');
SELECT ok(NOT has_function_privilege('authenticated', 'public.claim_due_organization_workflow_execution_step(timestamp with time zone)', 'EXECUTE'), 'browser cannot claim workflow execution');
SELECT ok(has_function_privilege('service_role', 'public.claim_due_organization_workflow_execution_step(timestamp with time zone)', 'EXECUTE'), 'service worker can claim workflow execution');
SELECT ok(NOT has_function_privilege('authenticated', 'public.record_organization_workflow_branch_decision(uuid,uuid,boolean)', 'EXECUTE'), 'browser cannot commit branch decisions');
SELECT ok(has_function_privilege('service_role', 'public.record_organization_workflow_branch_decision(uuid,uuid,boolean)', 'EXECUTE'), 'service worker can commit branch decisions');
SELECT ok(NOT has_function_privilege('authenticated', 'public.finish_organization_workflow_execution_step(uuid,uuid,text,uuid,jsonb,text)', 'EXECUTE'), 'browser cannot finish executable steps');
SELECT ok(has_function_privilege('service_role', 'public.finish_organization_workflow_execution_step(uuid,uuid,text,uuid,jsonb,text)', 'EXECUTE'), 'service worker can finish executable steps');

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.organization_workflow_step_instances'::regclass), 'canonical step RLS remains enabled');
SELECT ok(public.validate_organization_workflow_definition(
  '{"schema_version":3,"mode":"directed_acyclic","builder":{"layout_version":2,"nodes":[{"id":"a","type":"start","label":"Inicio"},{"id":"b","type":"condition","label":"Condición"},{"id":"c","type":"end","label":"Fin A"},{"id":"d","type":"end","label":"Fin B"}],"edges":[{"id":"e1","source":"a","target":"b"},{"id":"e2","source":"b","target":"c","branch":"true"},{"id":"e3","source":"b","target":"d","branch":"false"}]},"steps":[{"id":"a","order":1,"type":"start","label":"Inicio","configuration":{"next_step_id":"b"}},{"id":"b","order":2,"type":"condition","label":"Condición","configuration":{"condition":{"field":"document.status","operator":"equals","value":"completado"},"true_step_id":"c","false_step_id":"d"}},{"id":"c","order":3,"type":"approved","label":"Fin A","configuration":{}},{"id":"d","order":4,"type":"cancelled","label":"Fin B","configuration":{}}]}'::jsonb
), 'valid true/false workflow definition is accepted');
SELECT ok(NOT public.validate_organization_workflow_definition(
  '{"schema_version":3,"mode":"directed_acyclic","builder":{"layout_version":2,"nodes":[{"id":"a","type":"start","label":"Inicio"},{"id":"b","type":"condition","label":"Condición"},{"id":"c","type":"end","label":"Fin"}],"edges":[{"id":"e1","source":"a","target":"b"},{"id":"e2","source":"b","target":"c","branch":"true"}]},"steps":[{"id":"a","order":1,"type":"start","label":"Inicio","configuration":{"next_step_id":"b"}},{"id":"b","order":2,"type":"condition","label":"Condición","configuration":{"condition":{"field":"secrets.token","operator":"eval"},"true_step_id":"c"}},{"id":"c","order":3,"type":"approved","label":"Fin","configuration":{}}]}'::jsonb
), 'invalid field, operator and missing false branch are rejected');
SELECT is((SELECT global_enabled FROM public.platform_feature_flags WHERE flag_key = 'workflow_builder'), FALSE, 'Production Builder flag remains disabled by default');

SELECT * FROM finish();
ROLLBACK;
