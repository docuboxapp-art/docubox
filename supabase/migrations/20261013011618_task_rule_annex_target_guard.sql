-- A generated annex task must point at a concrete participant requirement.
-- The system's missing_anexo rule and manually created annex tasks already do so.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.task_custom_rules
    WHERE target_kind <> 'task' AND generated_task_type = 'subir_anexo'
  ) THEN
    RAISE EXCEPTION 'Review existing custom annex rules before applying this constraint.';
  END IF;
END;
$$;

ALTER TABLE public.task_custom_rules
  ADD CONSTRAINT task_custom_rules_annex_requires_requirement_check
  CHECK (target_kind = 'task' OR generated_task_type <> 'subir_anexo');
