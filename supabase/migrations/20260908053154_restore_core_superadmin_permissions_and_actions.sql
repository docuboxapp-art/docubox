-- Core Superadmin permissions and lifecycle controls. These records are
-- backend-only; customer roles and tenant membership never grant access here.

ALTER TABLE public.platform_staff
  ADD COLUMN IF NOT EXISTS requires_passkey BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.platform_audit_events
  ADD COLUMN IF NOT EXISTS correlation_id TEXT,
  ADD COLUMN IF NOT EXISTS approval_id UUID,
  ADD COLUMN IF NOT EXISTS ticket_reference TEXT,
  ADD COLUMN IF NOT EXISTS risk_level TEXT NOT NULL DEFAULT 'level_0';

CREATE TABLE IF NOT EXISTS public.platform_organization_controls (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  lifecycle_status TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active', 'trial', 'past_due', 'suspended', 'blocked', 'cancelled', 'pending_deletion')),
  reason TEXT,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (lifecycle_status IN ('active', 'trial') OR length(trim(reason)) >= 10)
);

CREATE TABLE IF NOT EXISTS public.platform_user_controls (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  access_status TEXT NOT NULL DEFAULT 'active'
    CHECK (access_status IN ('active', 'pending_verification', 'locked', 'suspended', 'disabled', 'deleted')),
  reason TEXT,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (access_status IN ('active', 'pending_verification') OR length(trim(reason)) >= 10)
);

CREATE TABLE IF NOT EXISTS public.platform_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL
    CHECK (alert_type IN ('security', 'billing', 'provider', 'certificate', 'system', 'storage', 'encryption', 'integrity', 'job', 'support')),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'investigating', 'resolved')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  resource_type TEXT,
  resource_id TEXT,
  correlation_id TEXT,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_platform_alerts_status
  ON public.platform_alerts(status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_correlation
  ON public.platform_audit_events(correlation_id)
  WHERE correlation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_approval_request_idempotency
  ON public.platform_audit_events(actor_user_id, request_id)
  WHERE action = 'APPROVAL_REQUESTED' AND request_id IS NOT NULL;

ALTER TABLE public.platform_organization_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_user_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_alerts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.platform_organization_controls FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.platform_user_controls FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.platform_alerts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_organization_controls TO service_role;
GRANT ALL ON public.platform_user_controls TO service_role;
GRANT ALL ON public.platform_alerts TO service_role;

INSERT INTO public.platform_permissions(permission_key, name, module, description) VALUES
  ('organization.read', 'Ver organizaciones', 'clients', 'Consultar metadata operativa de organizaciones.'),
  ('organization.update', 'Actualizar organizaciones', 'clients', 'Actualizar datos administrativos no sensibles.'),
  ('organization.suspend', 'Suspender organizaciones', 'clients', 'Solicitar una transición controlada de estado.'),
  ('plan.read', 'Ver planes', 'product', 'Consultar planes y sus versiones.'),
  ('plan.manage', 'Administrar planes', 'product', 'Crear y versionar planes.'),
  ('subscription.read', 'Ver suscripciones', 'product', 'Consultar suscripciones y renovaciones.'),
  ('subscription.manage', 'Administrar suscripciones', 'product', 'Cambiar el ciclo de una suscripción.'),
  ('billing.credit', 'Administrar créditos', 'finance', 'Crear ajustes y créditos auditados.'),
  ('document.metadata.read', 'Ver metadata documental', 'operations', 'Consultar metadata sin acceso al contenido.'),
  ('document.integrity.read', 'Ver integridad documental', 'operations', 'Consultar hashes y evidencia técnica.'),
  ('storage.read', 'Ver estado de almacenamiento', 'operations', 'Consultar salud y cifrado de objetos.'),
  ('workflow.read', 'Ver workflows', 'operations', 'Diagnosticar ejecuciones sin modificarlas.'),
  ('job.read', 'Ver jobs', 'operations', 'Consultar jobs y reintentos.'),
  ('job.retry', 'Reintentar jobs', 'operations', 'Solicitar reintentos idempotentes.'),
  ('signature.read', 'Ver firmas', 'certification', 'Consultar metadata de firmas.'),
  ('efirma.read', 'Ver e.firma', 'certification', 'Consultar evidencia pública sin material privado.'),
  ('pades.read', 'Ver PAdES', 'certification', 'Consultar resultados criptográficos PAdES.'),
  ('tsa.read', 'Ver TSA', 'certification', 'Consultar estampas RFC 3161.'),
  ('nom151.read', 'Ver NOM-151', 'certification', 'Consultar constancias y entorno del proveedor.'),
  ('identity.read', 'Ver verificaciones', 'identity', 'Consultar estados sin exponer biometría.'),
  ('notification.read', 'Ver notificaciones', 'communications', 'Consultar entregas con destinatarios protegidos.'),
  ('support.ticket.read', 'Ver tickets', 'support', 'Consultar tickets autorizados.'),
  ('support.access.request', 'Solicitar acceso asistido', 'support', 'Solicitar acceso temporal con ticket.'),
  ('support.access.approve', 'Aprobar acceso asistido', 'support', 'Aprobar acceso acotado con cuatro ojos.'),
  ('incident.read', 'Ver incidencias', 'support', 'Consultar incidencias y afectación.'),
  ('incident.manage', 'Administrar incidencias', 'support', 'Actualizar el ciclo de una incidencia.'),
  ('api.read', 'Ver API clients', 'integrations', 'Consultar clientes y scopes.'),
  ('api.revoke', 'Revocar API clients', 'integrations', 'Revocar credenciales sin revelarlas.'),
  ('webhook.read', 'Ver webhooks', 'integrations', 'Consultar entregas sanitizadas.'),
  ('webhook.retry', 'Reintentar webhooks', 'integrations', 'Solicitar reintentos idempotentes.'),
  ('security.read', 'Ver Security Center', 'security', 'Consultar postura y eventos.'),
  ('security.session.revoke', 'Revocar sesiones', 'security', 'Revocar sesiones con motivo.'),
  ('kms.read', 'Ver KMS/HSM', 'security', 'Consultar metadata sin material criptográfico.'),
  ('kms.rotate', 'Solicitar rotación KMS', 'security', 'Solicitar rotación con aprobación secundaria.'),
  ('encryption.read', 'Ver cifrado', 'security', 'Consultar cobertura y errores de cifrado.'),
  ('alert.read', 'Ver alertas', 'security', 'Consultar el centro de alertas.'),
  ('alert.manage', 'Administrar alertas', 'security', 'Reconocer, asignar y resolver alertas.'),
  ('system.read', 'Ver sistema', 'infrastructure', 'Consultar estado y dependencias.'),
  ('backup.read', 'Ver backups', 'infrastructure', 'Consultar evidencias de respaldo sin descargarlas.'),
  ('migration.read', 'Ver migraciones', 'infrastructure', 'Consultar estado de migraciones.'),
  ('role.read', 'Ver roles', 'administration', 'Consultar roles y permisos.'),
  ('approval.read', 'Ver aprobaciones', 'administration', 'Consultar solicitudes críticas.'),
  ('approval.approve', 'Aprobar acciones', 'administration', 'Aprobar acciones con segregación de funciones.'),
  ('configuration.read', 'Ver configuración', 'administration', 'Consultar configuración no secreta.'),
  ('configuration.manage', 'Administrar configuración', 'administration', 'Modificar configuración global auditada.')
ON CONFLICT (permission_key) DO UPDATE SET
  name = EXCLUDED.name,
  module = EXCLUDED.module,
  description = EXCLUDED.description;

-- Keep the legacy tenant.read permission as a compatibility alias during the
-- progressive migration, but make new screens authorize with organization.read.
INSERT INTO public.platform_role_permissions(role_id, permission_key)
SELECT roles.id, permissions.permission_key
FROM public.platform_roles roles
CROSS JOIN public.platform_permissions permissions
WHERE roles.role_key = 'DOCUBOX_SUPER_ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO public.platform_role_permissions(role_id, permission_key)
SELECT roles.id, permissions.permission_key
FROM public.platform_roles roles
JOIN public.platform_permissions permissions ON permissions.permission_key = ANY (
  CASE roles.role_key
    WHEN 'PLATFORM_ADMIN' THEN ARRAY[
      'dashboard.read','organization.read','organization.update','user.read','user.block',
      'user.sessions.revoke','plan.read','plan.manage','subscription.read','subscription.manage',
      'billing.read','usage.read','document.metadata.read','document.integrity.read','storage.read',
      'workflow.read','job.read','signature.read','efirma.read','pades.read','tsa.read','nom151.read',
      'identity.read','notification.read','support.ticket.read','support.ticket.manage',
      'support.access.request','incident.read','incident.manage','provider.read','api.read',
      'webhook.read','security.read','alert.read','system.read','backup.read','migration.read',
      'audit.read','staff.read','role.read','approval.read','configuration.read'
    ]
    WHEN 'SUPPORT_MANAGER' THEN ARRAY[
      'dashboard.read','organization.read','user.read','document.metadata.read','document.integrity.read',
      'workflow.read','job.read','signature.read','tsa.read','nom151.read','identity.read',
      'notification.read','support.ticket.read','support.ticket.manage','support.access.request',
      'support.access.approve','incident.read','incident.manage','provider.read','audit.read'
    ]
    WHEN 'SUPPORT_AGENT' THEN ARRAY[
      'dashboard.read','organization.read','user.read','document.metadata.read','document.integrity.read',
      'workflow.read','job.read','signature.read','tsa.read','nom151.read','notification.read',
      'support.ticket.read','support.ticket.manage','support.access.request','incident.read','provider.read'
    ]
    WHEN 'FINANCE_MANAGER' THEN ARRAY[
      'dashboard.read','organization.read','plan.read','subscription.read','subscription.manage',
      'billing.read','billing.refund','billing.credit','usage.read','approval.read','audit.read'
    ]
    WHEN 'BILLING_AGENT' THEN ARRAY[
      'dashboard.read','organization.read','plan.read','subscription.read','billing.read',
      'billing.credit','usage.read','audit.read'
    ]
    WHEN 'OPERATIONS_MANAGER' THEN ARRAY[
      'dashboard.read','organization.read','user.read','usage.read','document.metadata.read',
      'document.integrity.read','storage.read','workflow.read','job.read','job.retry','signature.read',
      'efirma.read','pades.read','tsa.read','nom151.read','identity.read','notification.read',
      'incident.read','provider.read','webhook.read','system.read','alert.read','audit.read'
    ]
    WHEN 'SECURITY_ADMIN' THEN ARRAY[
      'dashboard.read','organization.read','user.read','user.sessions.revoke','document.metadata.read',
      'document.integrity.read','signature.read','pades.read','tsa.read','nom151.read','provider.read',
      'security.read','security.session.revoke','kms.read','kms.rotate','encryption.read','alert.read',
      'alert.manage','system.read','audit.read','staff.read','role.read','approval.read',
      'approval.approve','configuration.read'
    ]
    WHEN 'SECURITY_AUDITOR' THEN ARRAY[
      'dashboard.read','organization.read','user.read','document.metadata.read','document.integrity.read',
      'signature.read','pades.read','tsa.read','nom151.read','provider.read','security.read','kms.read',
      'encryption.read','alert.read','system.read','backup.read','migration.read','audit.read',
      'staff.read','role.read','approval.read','configuration.read'
    ]
    WHEN 'COMPLIANCE_ADMIN' THEN ARRAY[
      'dashboard.read','organization.read','user.read','document.metadata.read','document.integrity.read',
      'signature.read','efirma.read','pades.read','tsa.read','nom151.read','identity.read','provider.read',
      'security.read','audit.read','approval.read'
    ]
    WHEN 'TECH_SUPPORT' THEN ARRAY[
      'dashboard.read','organization.read','user.read','document.metadata.read','document.integrity.read',
      'storage.read','workflow.read','job.read','job.retry','signature.read','pades.read','tsa.read',
      'nom151.read','notification.read','support.ticket.read','support.ticket.manage',
      'support.access.request','incident.read','provider.read','api.read','webhook.read','system.read'
    ]
    WHEN 'DEVELOPER_ADMIN' THEN ARRAY[
      'dashboard.read','organization.read','usage.read','job.read','incident.read','provider.read',
      'api.read','api.revoke','webhook.read','webhook.retry','security.read','system.read','audit.read'
    ]
    WHEN 'READ_ONLY_AUDITOR' THEN ARRAY[
      'dashboard.read','organization.read','user.read','plan.read','subscription.read','billing.read',
      'usage.read','document.metadata.read','document.integrity.read','storage.read','workflow.read',
      'job.read','signature.read','efirma.read','pades.read','tsa.read','nom151.read','identity.read',
      'notification.read','support.ticket.read','incident.read','provider.read','api.read','webhook.read',
      'security.read','kms.read','encryption.read','alert.read','system.read','backup.read',
      'migration.read','audit.read','staff.read','role.read','approval.read','configuration.read'
    ]
    ELSE ARRAY[]::TEXT[]
  END
)
WHERE roles.role_key <> 'DOCUBOX_SUPER_ADMIN'
ON CONFLICT DO NOTHING;

UPDATE public.platform_staff staff
SET requires_passkey = true,
    updated_at = CURRENT_TIMESTAMP
FROM public.platform_roles roles
WHERE roles.id = staff.role_id
  AND roles.role_key = 'DOCUBOX_SUPER_ADMIN'
  AND staff.requires_passkey = false;

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
  passkey_enrolled BOOLEAN := false;
  staff_record RECORD;
  permission_list JSONB;
BEGIN
  SELECT COALESCE(users.is_super_admin, false)
  INTO bootstrap_super_admin
  FROM auth.users users
  WHERE users.id = p_user_id;

  SELECT EXISTS (
    SELECT 1 FROM public.user_totp_settings totp
    WHERE totp.user_id = p_user_id
      AND totp.is_enabled = TRUE
      AND totp.confirmed_at IS NOT NULL
  ) INTO totp_enrolled;

  SELECT EXISTS (
    SELECT 1 FROM public.webauthn_credentials credentials
    WHERE credentials.user_id = p_user_id
      AND credentials.is_active = TRUE
  ) INTO passkey_enrolled;

  IF bootstrap_super_admin THEN
    RETURN jsonb_build_object(
      'active', true,
      'role', 'DOCUBOX_SUPER_ADMIN',
      'permissions', jsonb_build_array('*'),
      'requires_step_up', true,
      'totp_enrolled', totp_enrolled,
      'passkey_required', true,
      'passkey_enrolled', passkey_enrolled,
      'source', 'auth.users.is_super_admin'
    );
  END IF;

  SELECT staff.status, staff.requires_step_up, staff.requires_passkey,
         staff.valid_until, roles.role_key
  INTO staff_record
  FROM public.platform_staff staff
  JOIN public.platform_roles roles ON roles.id = staff.role_id
  WHERE staff.user_id = p_user_id;

  IF NOT FOUND
    OR staff_record.status <> 'active'
    OR (staff_record.valid_until IS NOT NULL AND staff_record.valid_until <= CURRENT_TIMESTAMP) THEN
    RETURN jsonb_build_object('active', false);
  END IF;

  SELECT COALESCE(jsonb_agg(permissions.permission_key ORDER BY permissions.permission_key), '[]'::jsonb)
  INTO permission_list
  FROM public.platform_role_permissions role_permissions
  JOIN public.platform_permissions permissions
    ON permissions.permission_key = role_permissions.permission_key
  WHERE role_permissions.role_id = (
    SELECT staff.role_id FROM public.platform_staff staff WHERE staff.user_id = p_user_id
  );

  RETURN jsonb_build_object(
    'active', true,
    'role', staff_record.role_key,
    'permissions', permission_list,
    'requires_step_up', staff_record.requires_step_up,
    'totp_enrolled', totp_enrolled,
    'passkey_required', staff_record.requires_passkey OR staff_record.role_key = 'DOCUBOX_SUPER_ADMIN',
    'passkey_enrolled', passkey_enrolled,
    'source', 'platform_staff'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_platform_staff_access(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_staff_access(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.request_platform_admin_approval(
  p_actor_user_id UUID,
  p_actor_role TEXT,
  p_permission TEXT,
  p_action_key TEXT,
  p_resource_type TEXT,
  p_resource_id TEXT,
  p_workspace_id UUID,
  p_reason TEXT,
  p_payload_digest_sha256 TEXT,
  p_request_id TEXT,
  p_correlation_id TEXT,
  p_ip_address INET,
  p_user_agent TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  approval_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_actor_user_id::TEXT, 0));

  SELECT events.approval_id
  INTO approval_id
  FROM public.platform_audit_events events
  WHERE events.actor_user_id = p_actor_user_id
    AND events.request_id = p_request_id
    AND events.action = 'APPROVAL_REQUESTED'
  LIMIT 1;
  IF approval_id IS NOT NULL THEN
    RETURN approval_id;
  END IF;
  IF (
    SELECT count(*)
    FROM public.platform_admin_approvals approvals
    WHERE approvals.requested_by = p_actor_user_id
      AND approvals.created_at >= CURRENT_TIMESTAMP - INTERVAL '1 minute'
  ) >= 5 THEN
    RAISE EXCEPTION 'PLATFORM_APPROVAL_RATE_LIMITED';
  END IF;

  IF NOT public.platform_has_permission(p_actor_user_id, p_permission, p_workspace_id, NULL) THEN
    RAISE EXCEPTION 'PLATFORM_PERMISSION_DENIED';
  END IF;
  IF length(trim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'PLATFORM_APPROVAL_REASON_REQUIRED';
  END IF;
  IF p_payload_digest_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'PLATFORM_APPROVAL_DIGEST_INVALID';
  END IF;

  INSERT INTO public.platform_admin_approvals (
    action_key, resource_type, resource_id, workspace_id, requested_by,
    requested_reason, payload_digest_sha256, status, expires_at
  ) VALUES (
    p_action_key, p_resource_type, p_resource_id, p_workspace_id, p_actor_user_id,
    trim(p_reason), p_payload_digest_sha256, 'requested', CURRENT_TIMESTAMP + INTERVAL '30 minutes'
  ) RETURNING id INTO approval_id;

  INSERT INTO public.platform_audit_events (
    actor_user_id, actor_role, action, entity_type, entity_id, workspace_id,
    request_id, correlation_id, approval_id, justification, outcome,
    risk_level, ip_address, user_agent
  ) VALUES (
    p_actor_user_id, p_actor_role, 'APPROVAL_REQUESTED', p_resource_type,
    p_resource_id, p_workspace_id, p_request_id, p_correlation_id,
    approval_id, trim(p_reason), 'success', 'level_3', p_ip_address, p_user_agent
  );

  RETURN approval_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_platform_admin_approval(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, INET, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_platform_admin_approval(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, INET, TEXT
) TO service_role;
