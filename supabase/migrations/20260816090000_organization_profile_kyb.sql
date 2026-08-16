-- Complete the organization profile and KYB evidence lifecycle without exposing files to the browser.

INSERT INTO public.organization_permissions (permission_key, name, description, category) VALUES
  ('kyb.read', 'Ver expediente KYB', 'Consultar evidencia e historial de verificación empresarial.', 'Organización'),
  ('kyb.manage', 'Administrar expediente KYB', 'Cargar y versionar evidencia empresarial.', 'Organización'),
  ('kyb.download', 'Descargar evidencia KYB', 'Descargar archivos probatorios mediante enlaces temporales.', 'Organización')
ON CONFLICT (permission_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category;

INSERT INTO public.organization_role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM public.organization_roles role
JOIN public.organization_permissions permission ON permission.permission_key IN ('kyb.read', 'kyb.manage', 'kyb.download')
WHERE role.system_key IN ('owner', 'admin')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.organization_kyb_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  document_type TEXT NOT NULL CHECK (document_type IN (
    'tax_status', 'articles_of_incorporation', 'notarial_power',
    'representative_id', 'proof_of_address', 'beneficial_owner', 'other'
  )),
  display_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'verified', 'rejected', 'expired', 'superseded')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  replaces_id UUID REFERENCES public.organization_kyb_evidence(id) ON DELETE SET NULL,
  valid_until DATE,
  rejection_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  UNIQUE (workspace_id, storage_path)
);

CREATE TABLE IF NOT EXISTS public.organization_verification_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('not_started', 'capturing', 'in_review', 'verified', 'update_required', 'rejected', 'suspended')),
  provider TEXT,
  result_code TEXT,
  observations TEXT,
  next_review_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_org_kyb_evidence_workspace
  ON public.organization_kyb_evidence(workspace_id, document_type, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_verification_history_workspace
  ON public.organization_verification_history(workspace_id, occurred_at DESC);

ALTER TABLE public.organization_kyb_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_verification_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_read_kyb_evidence" ON public.organization_kyb_evidence;
CREATE POLICY "org_members_read_kyb_evidence" ON public.organization_kyb_evidence
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'kyb.read'));
DROP POLICY IF EXISTS "org_members_read_verification_history" ON public.organization_verification_history;
CREATE POLICY "org_members_read_verification_history" ON public.organization_verification_history
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'kyb.read'));

GRANT SELECT ON public.organization_kyb_evidence TO authenticated;
GRANT SELECT ON public.organization_verification_history TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.organization_kyb_evidence FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.organization_verification_history FROM authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'organization-kyb',
  'organization-kyb',
  FALSE,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = FALSE,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMENT ON TABLE public.organization_kyb_evidence IS 'Versioned metadata for private organization KYB evidence. File access is backend-only.';
COMMENT ON TABLE public.organization_verification_history IS 'Append-only history of enterprise verification outcomes.';
