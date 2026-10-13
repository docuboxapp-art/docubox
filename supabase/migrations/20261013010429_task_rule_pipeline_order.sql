-- Priority changes must happen after other actions that use priority filters.
UPDATE public.task_custom_rules
SET action_kind=additional_action_kinds[1],
  additional_action_kinds=array_remove(additional_action_kinds,additional_action_kinds[1])
    || ARRAY['raise_priority']::text[]
WHERE action_kind='raise_priority' AND cardinality(additional_action_kinds)>0;
ALTER TABLE public.task_custom_rules
  ADD CONSTRAINT task_custom_rules_priority_order_check
  CHECK (action_kind<>'raise_priority' OR cardinality(additional_action_kinds)=0);

CREATE OR REPLACE FUNCTION task_internal.run_custom_rule_pipeline()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE primary_result jsonb; additional_result jsonb; resource_result jsonb;
BEGIN
  primary_result:=task_internal.run_custom_rules();
  additional_result:=task_internal.run_additional_rule_actions();
  resource_result:=task_internal.reconcile_resource_rules();
  RETURN jsonb_build_object('primary',primary_result,'additional',additional_result,
    'resources',resource_result);
END;
$$;
REVOKE ALL ON FUNCTION task_internal.run_custom_rule_pipeline() FROM PUBLIC,anon,authenticated;

DO $$
DECLARE old_job record;
BEGIN
  FOR old_job IN SELECT jobid FROM cron.job
    WHERE jobname IN ('docubox-task-custom-rules','docubox-task-additional-actions',
      'docubox-task-resource-rules')
  LOOP
    PERFORM cron.unschedule(old_job.jobid);
  END LOOP;
END;
$$;
SELECT cron.schedule('docubox-task-custom-pipeline','*/30 * * * *',
  'select task_internal.run_custom_rule_pipeline();');
