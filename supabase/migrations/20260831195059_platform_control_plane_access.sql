-- Docubox platform Control Plane. These tables are backend-only and are not
-- tenant administration tables.

CREATE TABLE IF NOT EXISTS public.platform_permissions (
  permission_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  module TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.platform_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_system BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.platform_role_permissions (
  role_id UUID NOT NULL REFERENCES public.platform_roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES public.platform_permissions(permission_key) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS public.platform_staff (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  role_id UUID NOT NULL REFERENCES public.platform_roles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),
  requires_step_up BOOLEAN NOT NULL DEFAULT true,
  valid_until TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.platform_support_access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  ticket_reference TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 20),
  requested_permissions TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'active', 'expired', 'revoked')),
  approved_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (expires_at IS NULL OR starts_at IS NULL OR expires_at > starts_at),
  CHECK (status NOT IN ('approved', 'active') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (status <> 'active' OR (starts_at IS NOT NULL AND expires_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.platform_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  request_id TEXT,
  justification TEXT,
  outcome TEXT NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'denied', 'failed')),
  before_data JSONB,
  after_data JSONB,
  ip_address INET,
  user_agent TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.platform_support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_reference TEXT NOT NULL UNIQUE,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  requester_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assignee_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed')),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  sla_due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.platform_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_reference TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  provider_key TEXT,
  status TEXT NOT NULL DEFAULT 'investigating'
    CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  severity TEXT NOT NULL DEFAULT 'minor'
    CHECK (severity IN ('minor', 'major', 'critical')),
  affected_services TEXT[] NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.platform_provider_registry (
  provider_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'unconfirmed',
  status TEXT NOT NULL DEFAULT 'not_configured'
    CHECK (status IN ('not_configured', 'configured', 'degraded', 'unavailable')),
  health_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (health_status IN ('unknown', 'healthy', 'degraded', 'down')),
  capabilities TEXT[] NOT NULL DEFAULT '{}',
  last_health_check_at TIMESTAMPTZ,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.platform_feature_flags (
  flag_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  global_enabled BOOLEAN NOT NULL DEFAULT false,
  rollout_percentage SMALLINT NOT NULL DEFAULT 0 CHECK (rollout_percentage BETWEEN 0 AND 100),
  allowed_plans TEXT[] NOT NULL DEFAULT '{}',
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.platform_feature_flag_tenant_overrides (
  flag_key TEXT NOT NULL REFERENCES public.platform_feature_flags(flag_key) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 10),
  valid_until TIMESTAMPTZ,
  updated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (flag_key, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_platform_staff_role_status
  ON public.platform_staff(role_id, status);
CREATE INDEX IF NOT EXISTS idx_platform_support_workspace_status
  ON public.platform_support_access_requests(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_support_requester
  ON public.platform_support_access_requests(requester_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_occurred
  ON public.platform_audit_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_workspace
  ON public.platform_audit_events(workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_tickets_status
  ON public.platform_support_tickets(status, priority, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_incidents_status
  ON public.platform_incidents(status, severity, started_at DESC);

ALTER TABLE public.platform_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_support_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_provider_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_feature_flag_tenant_overrides ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.platform_permissions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.platform_roles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.platform_role_permissions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.platform_staff FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.platform_support_access_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.platform_audit_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.platform_support_tickets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.platform_incidents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.platform_provider_registry FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.platform_feature_flags FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.platform_feature_flag_tenant_overrides FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_permissions TO service_role;
GRANT ALL ON public.platform_roles TO service_role;
GRANT ALL ON public.platform_role_permissions TO service_role;
GRANT ALL ON public.platform_staff TO service_role;
GRANT ALL ON public.platform_support_access_requests TO service_role;
GRANT ALL ON public.platform_audit_events TO service_role;
GRANT ALL ON public.platform_support_tickets TO service_role;
GRANT ALL ON public.platform_incidents TO service_role;
GRANT ALL ON public.platform_provider_registry TO service_role;
GRANT ALL ON public.platform_feature_flags TO service_role;
GRANT ALL ON public.platform_feature_flag_tenant_overrides TO service_role;

CREATE OR REPLACE FUNCTION public.reject_platform_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'platform_audit_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS platform_audit_events_append_only ON public.platform_audit_events;
CREATE TRIGGER platform_audit_events_append_only
BEFORE UPDATE OR DELETE ON public.platform_audit_events
FOR EACH ROW EXECUTE FUNCTION public.reject_platform_audit_mutation();

REVOKE ALL ON FUNCTION public.reject_platform_audit_mutation() FROM PUBLIC, anon, authenticated;

INSERT INTO public.platform_permissions(permission_key, name, module, description) VALUES
  ('dashboard.read', 'Ver dashboard', 'dashboard', 'Consultar metricas globales agregadas.'),
  ('tenant.read', 'Ver organizaciones', 'clients', 'Consultar metadata de organizaciones.'),
  ('tenant.update', 'Editar organizaciones', 'clients', 'Modificar configuracion administrativa.'),
  ('tenant.suspend', 'Suspender organizaciones', 'clients', 'Suspender o reactivar organizaciones.'),
  ('user.read', 'Ver usuarios', 'clients', 'Consultar perfiles y postura de acceso.'),
  ('user.block', 'Bloquear usuarios', 'clients', 'Bloquear o desbloquear cuentas.'),
  ('user.sessions.revoke', 'Revocar sesiones', 'security', 'Revocar sesiones de usuarios.'),
  ('billing.read', 'Ver facturacion', 'finance', 'Consultar suscripciones y transacciones.'),
  ('billing.manage', 'Administrar facturacion', 'finance', 'Administrar planes, creditos y cobros.'),
  ('billing.refund', 'Crear reembolsos', 'finance', 'Autorizar y registrar reembolsos.'),
  ('usage.read', 'Ver consumos', 'commercial', 'Consultar consumo y margen por servicio.'),
  ('provider.read', 'Ver proveedores', 'integrations', 'Consultar estado y consumo de proveedores.'),
  ('provider.configure', 'Configurar proveedores', 'integrations', 'Modificar configuracion no secreta.'),
  ('operations.read', 'Ver operacion', 'operations', 'Consultar metadata operativa sin contenido.'),
  ('security.events.read', 'Ver eventos de seguridad', 'security', 'Consultar eventos y alertas.'),
  ('security.manage', 'Administrar seguridad', 'security', 'Ejecutar acciones privilegiadas de seguridad.'),
  ('audit.read', 'Ver auditoria', 'audit', 'Consultar auditoria administrativa.'),
  ('support.ticket.manage', 'Administrar tickets', 'support', 'Gestionar tickets y SLA.'),
  ('support.session.request', 'Solicitar acceso asistido', 'support', 'Solicitar acceso temporal y acotado.'),
  ('support.session.approve', 'Aprobar acceso asistido', 'support', 'Aprobar acceso temporal con justificacion.'),
  ('communications.read', 'Ver comunicaciones', 'communications', 'Consultar entregas y errores.'),
  ('communications.manage', 'Administrar plantillas', 'communications', 'Versionar plantillas globales.'),
  ('developer.read', 'Ver integraciones API', 'developers', 'Consultar API clients, uso y errores.'),
  ('developer.manage', 'Administrar integraciones API', 'developers', 'Administrar clientes, limites y webhooks.'),
  ('analytics.read', 'Ver analitica', 'analytics', 'Consultar analitica de producto y operacion.'),
  ('staff.read', 'Ver equipo interno', 'administration', 'Consultar personal interno.'),
  ('staff.manage', 'Administrar equipo interno', 'administration', 'Administrar personal interno.'),
  ('role.manage', 'Administrar roles', 'administration', 'Administrar roles y permisos internos.'),
  ('feature_flags.manage', 'Administrar feature flags', 'administration', 'Administrar capacidades globales y por tenant.'),
  ('system.configure', 'Configurar plataforma', 'administration', 'Modificar configuracion global critica.')
ON CONFLICT (permission_key) DO UPDATE SET
  name = EXCLUDED.name,
  module = EXCLUDED.module,
  description = EXCLUDED.description;

INSERT INTO public.platform_feature_flags(flag_key, name, description) VALUES
  ('mass_signing', 'Firma masiva', 'Procesamiento de documentos en lote.'),
  ('nom151', 'NOM-151', 'Emision de constancias de conservacion.'),
  ('tsa', 'TSA', 'Sellado de tiempo RFC 3161.'),
  ('identity_verification', 'Verificacion de identidad', 'Flujos KYC y biometria.'),
  ('certified_notifications', 'Notificaciones certificadas', 'Evidencia de entrega y apertura.'),
  ('collabora', 'Colabora', 'Edicion colaborativa de documentos.'),
  ('ai_assistant', 'Asistente IA', 'Asistencia contextual dentro de Docubox.'),
  ('google_drive', 'Google Drive', 'Integracion con Google Drive.'),
  ('onedrive', 'OneDrive', 'Integracion con Microsoft OneDrive.'),
  ('dropbox', 'Dropbox', 'Integracion con Dropbox.')
ON CONFLICT (flag_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

INSERT INTO public.platform_roles(role_key, name, description) VALUES
  ('DOCUBOX_SUPER_ADMIN', 'Superadministrador Docubox', 'Control completo para operaciones extraordinarias.'),
  ('PLATFORM_ADMIN', 'Administrador de plataforma', 'Administracion general cotidiana.'),
  ('SUPPORT_MANAGER', 'Responsable de soporte', 'Direccion de soporte y accesos asistidos.'),
  ('SUPPORT_AGENT', 'Agente de soporte', 'Atencion y diagnostico sin acceso documental libre.'),
  ('FINANCE_MANAGER', 'Responsable financiero', 'Finanzas, cobros y reembolsos.'),
  ('BILLING_AGENT', 'Agente de facturacion', 'Facturacion y pagos.'),
  ('OPERATIONS_MANAGER', 'Responsable de operaciones', 'Operacion agregada de la plataforma.'),
  ('SECURITY_ADMIN', 'Administrador de seguridad', 'Seguridad y acciones privilegiadas.'),
  ('SECURITY_AUDITOR', 'Auditor de seguridad', 'Consulta de seguridad sin modificacion.'),
  ('COMPLIANCE_ADMIN', 'Administrador de cumplimiento', 'Certificacion y cumplimiento.'),
  ('TECH_SUPPORT', 'Soporte tecnico', 'Diagnostico tecnico.'),
  ('DEVELOPER_ADMIN', 'Administrador de APIs', 'APIs, integraciones y webhooks.'),
  ('READ_ONLY_AUDITOR', 'Auditor de solo lectura', 'Consulta general sin modificacion.')
ON CONFLICT (role_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

INSERT INTO public.platform_role_permissions(role_id, permission_key)
SELECT roles.id, permissions.permission_key
FROM public.platform_roles roles
CROSS JOIN public.platform_permissions permissions
WHERE roles.role_key = 'DOCUBOX_SUPER_ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO public.platform_role_permissions(role_id, permission_key)
SELECT roles.id, permissions.permission_key
FROM public.platform_roles roles
JOIN public.platform_permissions permissions ON permissions.permission_key = ANY (ARRAY[
  'dashboard.read','tenant.read','tenant.update','tenant.suspend','user.read','user.block',
  'billing.read','billing.manage','usage.read','provider.read','operations.read','audit.read',
  'support.ticket.manage','communications.read','developer.read','analytics.read','staff.read',
  'feature_flags.manage'
])
WHERE roles.role_key = 'PLATFORM_ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO public.platform_role_permissions(role_id, permission_key)
SELECT roles.id, permissions.permission_key
FROM public.platform_roles roles
JOIN public.platform_permissions permissions ON permissions.permission_key = ANY (
  CASE roles.role_key
    WHEN 'SUPPORT_MANAGER' THEN ARRAY['dashboard.read','tenant.read','user.read','operations.read','audit.read','support.ticket.manage','support.session.request','support.session.approve','communications.read']
    WHEN 'SUPPORT_AGENT' THEN ARRAY['dashboard.read','tenant.read','user.read','operations.read','audit.read','support.ticket.manage','support.session.request','communications.read']
    WHEN 'FINANCE_MANAGER' THEN ARRAY['dashboard.read','tenant.read','billing.read','billing.manage','billing.refund','usage.read','analytics.read','audit.read']
    WHEN 'BILLING_AGENT' THEN ARRAY['dashboard.read','tenant.read','billing.read','billing.manage','usage.read','audit.read']
    WHEN 'OPERATIONS_MANAGER' THEN ARRAY['dashboard.read','tenant.read','user.read','usage.read','provider.read','operations.read','analytics.read','audit.read']
    WHEN 'SECURITY_ADMIN' THEN ARRAY['dashboard.read','tenant.read','user.read','user.sessions.revoke','provider.read','provider.configure','operations.read','security.events.read','security.manage','audit.read','support.session.approve','staff.read']
    WHEN 'SECURITY_AUDITOR' THEN ARRAY['dashboard.read','tenant.read','user.read','provider.read','operations.read','security.events.read','audit.read','staff.read']
    WHEN 'COMPLIANCE_ADMIN' THEN ARRAY['dashboard.read','tenant.read','user.read','provider.read','operations.read','security.events.read','audit.read']
    WHEN 'TECH_SUPPORT' THEN ARRAY['dashboard.read','tenant.read','user.read','provider.read','operations.read','security.events.read','audit.read','support.ticket.manage','support.session.request','developer.read']
    WHEN 'DEVELOPER_ADMIN' THEN ARRAY['dashboard.read','tenant.read','provider.read','provider.configure','operations.read','security.events.read','audit.read','developer.read','developer.manage','analytics.read']
    WHEN 'READ_ONLY_AUDITOR' THEN ARRAY['dashboard.read','tenant.read','user.read','billing.read','usage.read','provider.read','operations.read','security.events.read','audit.read','communications.read','developer.read','analytics.read','staff.read']
    ELSE ARRAY[]::TEXT[]
  END
)
WHERE roles.role_key NOT IN ('DOCUBOX_SUPER_ADMIN', 'PLATFORM_ADMIN')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_platform_staff_access(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  bootstrap_super_admin BOOLEAN := false;
  totp_enrolled BOOLEAN := false;
  staff_record RECORD;
  permission_list JSONB;
BEGIN
  SELECT COALESCE(users.is_super_admin, false)
  INTO bootstrap_super_admin
  FROM auth.users users
  WHERE users.id = p_user_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_totp_settings totp
    WHERE totp.user_id = p_user_id
      AND totp.is_enabled = TRUE
      AND totp.confirmed_at IS NOT NULL
  )
  INTO totp_enrolled;

  IF bootstrap_super_admin THEN
    RETURN jsonb_build_object(
      'active', true,
      'role', 'DOCUBOX_SUPER_ADMIN',
      'permissions', jsonb_build_array('*'),
      'requires_step_up', true,
      'totp_enrolled', totp_enrolled,
      'source', 'auth.users.is_super_admin'
    );
  END IF;

  SELECT staff.status, staff.requires_step_up, staff.valid_until, roles.role_key
  INTO staff_record
  FROM public.platform_staff staff
  JOIN public.platform_roles roles ON roles.id = staff.role_id
  WHERE staff.user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('active', false);
  END IF;

  IF staff_record.status <> 'active'
    OR (staff_record.valid_until IS NOT NULL AND staff_record.valid_until <= CURRENT_TIMESTAMP) THEN
    RETURN jsonb_build_object('active', false);
  END IF;

  SELECT COALESCE(jsonb_agg(permissions.permission_key ORDER BY permissions.permission_key), '[]'::jsonb)
  INTO permission_list
  FROM public.platform_staff staff
  JOIN public.platform_role_permissions role_permissions ON role_permissions.role_id = staff.role_id
  JOIN public.platform_permissions permissions ON permissions.permission_key = role_permissions.permission_key
  WHERE staff.user_id = p_user_id;

  RETURN jsonb_build_object(
    'active', true,
    'role', staff_record.role_key,
    'permissions', permission_list,
    'requires_step_up', staff_record.requires_step_up,
    'totp_enrolled', totp_enrolled,
    'source', 'platform_staff'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_platform_staff_access(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_staff_access(UUID) TO service_role;
