-- Relates template versions and records the organization workflow selected at submission.
-- Existing templates remain valid: null lineage means the record is the first version.
ALTER TABLE public.plantillas
  ADD COLUMN IF NOT EXISTS source_template_id UUID REFERENCES public.plantillas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS root_template_id UUID REFERENCES public.plantillas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_workflow_id UUID REFERENCES public.organization_approval_workflows(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_plantillas_root_template_version
  ON public.plantillas(root_template_id, version_publicada);

CREATE INDEX IF NOT EXISTS idx_plantillas_approval_workflow
  ON public.plantillas(approval_workflow_id)
  WHERE approval_workflow_id IS NOT NULL;

COMMENT ON COLUMN public.plantillas.source_template_id IS
  'Immediate published template version used to create this draft version.';
COMMENT ON COLUMN public.plantillas.root_template_id IS
  'First template in the version family. Null identifies an original first version.';
COMMENT ON COLUMN public.plantillas.approval_workflow_id IS
  'Published organization workflow applied when the template is submitted for approval.';
