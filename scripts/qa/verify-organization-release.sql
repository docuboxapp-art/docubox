-- Read-only release preflight. Run after restoring SQL access and before release.
-- Reports schema/privilege metadata only; no credentials, identities or user content.
BEGIN READ ONLY;
SET LOCAL statement_timeout='8s';

-- Fail the preflight rather than merely printing a false metadata row.
DO $preflight$
DECLARE item record; target regprocedure;
BEGIN
 FOR item IN SELECT * FROM(VALUES
  ('public.save_organization_unit_bundle(uuid,jsonb,uuid[])',true),
  ('public.save_organization_role_bundle(uuid,jsonb,uuid[])',true),
  ('public.get_my_organization_permissions(uuid)',true),
  ('public.get_user_workspace_ids()',true),
  ('public.get_my_collaboration_access(uuid)',true),
  ('public.organization_resource_scope_version(uuid)',true),
  ('public.organization_can_access_resource(uuid,text,text,uuid)',true),
  ('public.organization_can_create_resource(uuid,text,text,uuid[],uuid[],uuid)',true),
  ('public.colabora_forms_overview(uuid)',true),
  ('public.organization_directory_upload_available(uuid)',true),
  ('public.finalize_organization_directory_evidence(uuid,uuid,uuid,jsonb)',false),
  ('public.organization_authorize_automation_action(uuid,text,text,uuid,uuid)',false),
  ('public.colabora_mutate_task(uuid,uuid,uuid,text,integer,jsonb,text)',false),
  ('public.colabora_bulk_mutate_tasks(uuid,uuid,jsonb,text,jsonb)',false)
 ) t(signature,browser_callable) LOOP
  target:=to_regprocedure(item.signature);
  IF target IS NULL OR has_function_privilege('anon',target,'EXECUTE') IS DISTINCT FROM false
   OR has_function_privilege('authenticated',target,'EXECUTE') IS DISTINCT FROM item.browser_callable THEN
   RAISE EXCEPTION 'Release function privilege mismatch: %',item.signature;
  END IF;
 END LOOP;
 IF has_function_privilege('authenticated','public.bootstrap_business_organization(uuid,uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'Provisioning helper exposed to browser';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE '%organization%' AND has_function_privilege('anon',p.oid,'EXECUTE')) THEN
  RAISE EXCEPTION 'Anonymous organization RPC exposed';
 END IF;
 IF has_table_privilege('authenticated','public.tareas','INSERT') OR has_table_privilege('authenticated','public.tareas','UPDATE') OR has_table_privilege('authenticated','public.tareas','DELETE') THEN
  RAISE EXCEPTION 'Direct task writes exposed';
 END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname='organization_resource_scope' AND permissive='RESTRICTIVE' AND cmd='SELECT')<>33 THEN
  RAISE EXCEPTION 'Resource policies missing or changed';
 END IF;
END;
$preflight$;

WITH required(name) AS (VALUES
 ('workspaces'),('workspace_members'),('organization_invitations'),
 ('organization_units'),('organization_unit_members'),('organization_roles'),
 ('organization_permissions'),('organization_role_permissions'),('organization_member_roles'),
 ('organization_directory_people'),('organization_directory_evidence'),('organization_authorities'),
 ('organization_approval_workflows'),('organization_signature_policies'),('organization_shared_resources'),
 ('organization_member_offboarding_jobs'),('organization_ownership_transfers'),
 ('organization_trusted_networks'),('organization_security_alert_rules'),('organization_certificates'),
 ('organization_certificate_permissions'),('organization_integrations'),('organization_communication_templates'),
 ('organization_sender_domains'),('organization_cost_centers'),('organization_audit_events'))
SELECT r.name,c.oid IS NOT NULL AS present,coalesce(c.relrowsecurity,false) AS rls_enabled
FROM required r LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||r.name)
ORDER BY r.name;

WITH required(signature,browser_callable) AS (VALUES
 ('public.save_organization_unit_bundle(uuid,jsonb,uuid[])',true),
 ('public.save_organization_role_bundle(uuid,jsonb,uuid[])',true),
 ('public.get_my_organization_permissions(uuid)',true),
 ('public.organization_resource_scope_version(uuid)',true),
 ('public.organization_can_access_resource(uuid,text,text,uuid)',true),
 ('public.organization_can_create_resource(uuid,text,text,uuid[],uuid[],uuid)',true),
 ('public.colabora_forms_overview(uuid)',true),
 ('public.organization_directory_upload_available(uuid)',true),
 ('public.finalize_organization_directory_evidence(uuid,uuid,uuid,jsonb)',false),
 ('public.organization_authorize_automation_action(uuid,text,text,uuid,uuid)',false),
 ('public.colabora_mutate_task(uuid,uuid,uuid,text,integer,jsonb,text)',false),
 ('public.colabora_bulk_mutate_tasks(uuid,uuid,jsonb,text,jsonb)',false))
SELECT signature,to_regprocedure(signature) IS NOT NULL AS present,
 coalesce(has_function_privilege('anon',to_regprocedure(signature),'EXECUTE'),false) AS anonymous_execute,
 coalesce(has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE'),false) AS browser_execute,
 browser_callable AS expected_browser_execute,
 CASE WHEN to_regprocedure(signature) IS NULL THEN false
 ELSE NOT has_function_privilege('anon',to_regprocedure(signature),'EXECUTE')
  AND has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE')=browser_callable END AS privileges_valid
FROM required ORDER BY signature;

SELECT tablename,policyname,permissive,cmd FROM pg_policies
WHERE schemaname='public' AND policyname IN('organization_resource_scope',
 'organization_team_checklist_insert','organization_team_checklist_update','organization_team_checklist_delete',
 'organization_team_dependency_insert','organization_team_dependency_delete')
ORDER BY tablename,policyname;

SELECT c.relname AS table_name,t.tgname AS trigger_name,t.tgenabled AS enabled
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgname IN(
 'validate_organization_role_scope','organization_offboarding_principal_guard')
ORDER BY c.relname,t.tgname;

SELECT has_table_privilege('authenticated','public.tareas','INSERT') AS browser_task_insert,
 has_table_privilege('authenticated','public.tareas','UPDATE') AS browser_task_update,
 has_table_privilege('authenticated','public.tareas','DELETE') AS browser_task_delete;

ROLLBACK;
