-- Docubox Control Plane foundations. All objects remain backend-only.
-- Customer-content access is never inferred from a platform role.

CREATE TABLE IF NOT EXISTS public.platform_admin_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_key TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  requested_reason TEXT NOT NULL CHECK (length(trim(requested_reason)) >= 20),
  payload_digest_sha256 TEXT NOT NULL CHECK (payload_digest_sha256 ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'rejected', 'executed', 'expired', 'cancelled')),
  approved_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  approval_reason TEXT,
  approved_at TIMESTAMPTZ,
  executed_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  executed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CHECK (status NOT IN ('approved', 'executed') OR approved_by IS NOT NULL),
  CHECK (status <> 'executed' OR (executed_by IS NOT NULL AND executed_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.platform_privileged_access_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.platform_support_access_requests(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  permissions TEXT[] NOT NULL CHECK (cardinality(permissions) > 0),
  ticket_reference TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 20),
  approved_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  step_up_verified_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'revoked')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (approved_by <> actor_user_id),
  CHECK (expires_at > starts_at),
  CHECK (expires_at <= starts_at + INTERVAL '4 hours')
);

CREATE TABLE IF NOT EXISTS public.platform_security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('platform_staff', 'customer', 'service', 'anonymous')),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  ip_address INET,
  device_fingerprint TEXT,
  country_code TEXT,
  request_id TEXT,
  risk_score SMALLINT NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  result TEXT NOT NULL CHECK (result IN ('allowed', 'denied', 'failed', 'detected')),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.platform_system_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  resource_type TEXT,
  resource_id TEXT,
  correlation_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'retry', 'failed', 'dead_letter')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  provider_key TEXT,
  error_code TEXT,
  error_summary TEXT,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.platform_dead_letter_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL UNIQUE REFERENCES public.platform_system_jobs(id) ON DELETE RESTRICT,
  first_failed_at TIMESTAMPTZ NOT NULL,
  last_failed_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  error_code TEXT NOT NULL,
  error_summary TEXT NOT NULL,
  sanitized_context JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'retry_requested', 'resolved', 'discarded', 'escalated')),
  resolved_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  resolution_reason TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.platform_provider_credentials_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('development', 'sandbox', 'production', 'unconfirmed')),
  credential_label TEXT NOT NULL,
  masked_identifier TEXT NOT NULL,
  secret_store_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'configured'
    CHECK (status IN ('not_configured', 'configured', 'verified', 'expired', 'revoked')),
  last_verified_at TIMESTAMPTZ,
  rotated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider_key, environment, credential_label),
  CHECK (masked_identifier !~* '(bearer|private[ _-]?key|service[ _-]?role)')
);

CREATE TABLE IF NOT EXISTS public.platform_kms_keys_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('development', 'sandbox', 'production')),
  project_ref TEXT,
  location TEXT NOT NULL,
  key_ring TEXT NOT NULL,
  key_name TEXT NOT NULL,
  key_version TEXT NOT NULL,
  protection_level TEXT NOT NULL CHECK (protection_level IN ('SOFTWARE', 'HSM', 'EXTERNAL')),
  algorithm TEXT NOT NULL,
  public_key_fingerprint_sha256 TEXT CHECK (public_key_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'destroy_scheduled', 'destroyed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_verified_at TIMESTAMPTZ,
  last_rotated_at TIMESTAMPTZ,
  next_rotation_at TIMESTAMPTZ,
  UNIQUE (provider_key, environment, key_ring, key_name, key_version)
);

CREATE TABLE IF NOT EXISTS public.platform_certificate_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_type TEXT NOT NULL CHECK (certificate_type IN ('signing', 'tsa', 'psc', 'root_ca', 'intermediate_ca')),
  provider_key TEXT,
  environment TEXT NOT NULL CHECK (environment IN ('development', 'sandbox', 'production', 'unconfirmed')),
  subject_dn TEXT NOT NULL,
  issuer_dn TEXT NOT NULL,
  serial_number TEXT NOT NULL,
  fingerprint_sha256 TEXT NOT NULL CHECK (fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  public_key_fingerprint_sha256 TEXT CHECK (public_key_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  algorithm TEXT NOT NULL,
  not_before TIMESTAMPTZ NOT NULL,
  not_after TIMESTAMPTZ NOT NULL,
  trust_status TEXT NOT NULL DEFAULT 'unconfirmed'
    CHECK (trust_status IN ('unconfirmed', 'valid', 'invalid', 'revoked', 'expired')),
  source_reference TEXT NOT NULL,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (environment, fingerprint_sha256),
  CHECK (not_after > not_before)
);

CREATE TABLE IF NOT EXISTS public.platform_trust_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_key TEXT NOT NULL,
  version TEXT NOT NULL,
  provider_key TEXT,
  environment TEXT NOT NULL CHECK (environment IN ('development', 'sandbox', 'production', 'unconfirmed')),
  root_fingerprints_sha256 TEXT[] NOT NULL CHECK (cardinality(root_fingerprints_sha256) > 0),
  status TEXT NOT NULL DEFAULT 'unconfirmed'
    CHECK (status IN ('unconfirmed', 'valid', 'invalid', 'superseded')),
  source_reference TEXT NOT NULL,
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (bundle_key, version, environment)
);

CREATE TABLE IF NOT EXISTS public.platform_backup_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_type TEXT NOT NULL,
  environment TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'created', 'verified', 'failed', 'expired')),
  size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
  retention_until TIMESTAMPTZ,
  storage_reference TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.platform_restore_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_run_id UUID NOT NULL REFERENCES public.platform_backup_runs(id) ON DELETE RESTRICT,
  environment TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'passed', 'failed')),
  rpo_seconds INTEGER CHECK (rpo_seconds IS NULL OR rpo_seconds >= 0),
  rto_seconds INTEGER CHECK (rto_seconds IS NULL OR rto_seconds >= 0),
  sanitized_result JSONB NOT NULL DEFAULT '{}'::JSONB,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.platform_legal_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  authority TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 20),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'expired')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  released_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.platform_privacy_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_reference TEXT NOT NULL UNIQUE,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  subject_user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_type TEXT NOT NULL CHECK (request_type IN ('access', 'rectification', 'cancellation', 'opposition', 'portability', 'deletion')),
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'identity_validation', 'analysis', 'approval', 'execution', 'completed', 'rejected')),
  legal_hold_checked BOOLEAN NOT NULL DEFAULT false,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_platform_approvals_status_expires
  ON public.platform_admin_approvals(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_platform_privileged_sessions_actor
  ON public.platform_privileged_access_sessions(actor_user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_platform_security_events_time
  ON public.platform_security_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_security_events_workspace
  ON public.platform_security_events(workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_jobs_status
  ON public.platform_system_jobs(status, queued_at);
CREATE INDEX IF NOT EXISTS idx_platform_dlq_status
  ON public.platform_dead_letter_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_certificates_expiry
  ON public.platform_certificate_registry(trust_status, not_after);
CREATE INDEX IF NOT EXISTS idx_platform_legal_holds_resource
  ON public.platform_legal_holds(resource_type, resource_id, status);

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'platform_admin_approvals',
    'platform_privileged_access_sessions',
    'platform_security_events',
    'platform_system_jobs',
    'platform_dead_letter_jobs',
    'platform_provider_credentials_metadata',
    'platform_kms_keys_metadata',
    'platform_certificate_registry',
    'platform_trust_bundles',
    'platform_backup_runs',
    'platform_restore_tests',
    'platform_legal_holds',
    'platform_privacy_requests'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', table_name);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', table_name);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_platform_security_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'platform_security_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS platform_security_events_append_only ON public.platform_security_events;
CREATE TRIGGER platform_security_events_append_only
BEFORE UPDATE OR DELETE ON public.platform_security_events
FOR EACH ROW EXECUTE FUNCTION public.reject_platform_security_event_mutation();

REVOKE ALL ON FUNCTION public.reject_platform_security_event_mutation() FROM PUBLIC, anon, authenticated;

INSERT INTO public.platform_permissions(permission_key, name, module, description) VALUES
  ('feature.read', 'Ver feature management', 'product', 'Consultar flags, entitlements y rollouts.'),
  ('product.read', 'Ver configuración de producto', 'product', 'Consultar catálogos y plantillas globales.'),
  ('billing.refund.request', 'Solicitar reembolso', 'finance', 'Crear una solicitud de reembolso.'),
  ('billing.refund.approve', 'Aprobar reembolso', 'finance', 'Aprobar un reembolso sujeto a política.'),
  ('jobs.read', 'Ver jobs y colas', 'operations', 'Consultar jobs, colas y DLQ.'),
  ('jobs.manage', 'Administrar jobs', 'operations', 'Reintentar o resolver jobs.'),
  ('certificate.read', 'Ver certificados', 'certification', 'Consultar metadata X.509 y trust.'),
  ('certificate.rotate', 'Solicitar rotación de certificado', 'certification', 'Solicitar una rotación con aprobación.'),
  ('identity.read', 'Ver postura de identidad', 'identity', 'Consultar resultados sanitizados de identidad.'),
  ('support.ticket.read', 'Ver tickets', 'support', 'Consultar tickets y SLA.'),
  ('support.access.request', 'Solicitar acceso asistido', 'support', 'Solicitar una sesión temporal.'),
  ('support.content.read', 'Leer contenido durante soporte', 'support', 'Acceso excepcional acotado a sesión y tenant.'),
  ('kms.read', 'Ver KMS/HSM', 'security', 'Consultar metadata de llaves y rotaciones.'),
  ('kms.rotate.request', 'Solicitar rotación KMS', 'security', 'Solicitar rotación con doble control.'),
  ('break_glass.request', 'Solicitar break-glass', 'security', 'Solicitar acceso de emergencia.'),
  ('break_glass.execute', 'Ejecutar break-glass', 'security', 'Ejecutar acceso aprobado de emergencia.'),
  ('infrastructure.read', 'Ver infraestructura', 'infrastructure', 'Consultar estado, backups y DR.'),
  ('compliance.read', 'Ver cumplimiento', 'compliance', 'Consultar retención, evidencias y legal hold.'),
  ('privacy.read', 'Ver solicitudes de privacidad', 'compliance', 'Consultar solicitudes ARCO.'),
  ('data.export', 'Exportar datos', 'compliance', 'Ejecutar exportación aprobada.'),
  ('data.delete.request', 'Solicitar eliminación', 'compliance', 'Solicitar eliminación sujeta a retención.'),
  ('role.read', 'Ver roles y permisos', 'administration', 'Consultar RBAC interno.'),
  ('approval.read', 'Ver aprobaciones', 'administration', 'Consultar el centro de aprobaciones.'),
  ('approval.manage', 'Resolver aprobaciones', 'administration', 'Aprobar o rechazar acciones críticas.')
ON CONFLICT (permission_key) DO UPDATE SET
  name = EXCLUDED.name,
  module = EXCLUDED.module,
  description = EXCLUDED.description;

INSERT INTO public.platform_roles(role_key, name, description) VALUES
  ('SECURITY_ANALYST', 'Analista de seguridad', 'Investigación de eventos y riesgos sin cambios críticos.'),
  ('CERTIFICATION_OPERATOR', 'Operador de certificación', 'Operación de PAdES, TSA, NOM-151 y certificados.'),
  ('CUSTOMER_SUCCESS', 'Customer Success', 'Salud, adopción y seguimiento de clientes.'),
  ('SALES_ADMIN', 'Administrador comercial', 'Planes, contratos y actividad comercial.')
ON CONFLICT (role_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

INSERT INTO public.platform_role_permissions(role_id, permission_key)
SELECT roles.id, permissions.permission_key
FROM public.platform_roles roles
CROSS JOIN public.platform_permissions permissions
WHERE roles.role_key = 'DOCUBOX_SUPER_ADMIN'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.platform_has_permission(
  p_user_id UUID,
  p_permission TEXT,
  p_workspace_id UUID DEFAULT NULL,
  p_privileged_session_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  base_grant BOOLEAN := false;
  customer_content_permission BOOLEAN := p_permission IN ('support.content.read', 'document.content.read');
BEGIN
  SELECT COALESCE(users.is_super_admin, false) OR EXISTS (
    SELECT 1
    FROM public.platform_staff staff
    JOIN public.platform_role_permissions role_permissions ON role_permissions.role_id = staff.role_id
    WHERE staff.user_id = p_user_id
      AND staff.status = 'active'
      AND (staff.valid_until IS NULL OR staff.valid_until > CURRENT_TIMESTAMP)
      AND role_permissions.permission_key = p_permission
  )
  INTO base_grant
  FROM auth.users users
  WHERE users.id = p_user_id;

  IF NOT COALESCE(base_grant, false) THEN
    RETURN false;
  END IF;

  IF customer_content_permission THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.platform_privileged_access_sessions sessions
      WHERE sessions.id = p_privileged_session_id
        AND sessions.actor_user_id = p_user_id
        AND sessions.workspace_id = p_workspace_id
        AND sessions.status = 'active'
        AND sessions.starts_at <= CURRENT_TIMESTAMP
        AND sessions.expires_at > CURRENT_TIMESTAMP
        AND p_permission = ANY(sessions.permissions)
    );
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_has_permission(UUID, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_has_permission(UUID, TEXT, UUID, UUID)
  TO service_role;
