BEGIN;

-- The legacy guard forbids closed -> paused. Hold an exclusive table lock while
-- converting existing rows, then restore the guard before releasing the lock.
LOCK TABLE public.form_templates IN ACCESS EXCLUSIVE MODE;
ALTER TABLE public.form_templates DISABLE TRIGGER zz_guard_form_template_lifecycle;

UPDATE public.form_templates SET status = 'paused' WHERE status = 'closed';
UPDATE public.form_templates SET archived_from_status = 'paused'
WHERE archived_from_status = 'closed';

ALTER TABLE public.form_templates ENABLE TRIGGER zz_guard_form_template_lifecycle;

ALTER TABLE public.form_templates DROP CONSTRAINT form_templates_status_check;
ALTER TABLE public.form_templates ADD CONSTRAINT form_templates_status_check
  CHECK (status IN ('draft', 'in_review', 'published', 'paused', 'archived'));

ALTER TABLE public.form_templates DROP CONSTRAINT form_templates_archived_from_status_check;
ALTER TABLE public.form_templates ADD CONSTRAINT form_templates_archived_from_status_check
  CHECK (archived_from_status IN ('draft', 'published', 'paused'));

COMMIT;
