-- Organization governance foundation.
-- Reuses workspaces as the tenant boundary and preserves all existing data.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS organization_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS legal_name TEXT,
  ADD COLUMN IF NOT EXISTS trade_name TEXT,
  ADD COLUMN IF NOT EXISTS rfc TEXT,
  ADD COLUMN IF NOT EXISTS legal_person_type TEXT,
  ADD COLUMN IF NOT EXISTS tax_regime TEXT,
  ADD COLUMN IF NOT EXISTS industry TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Mexico_City',
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'es-MX',
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'MXN',
  ADD COLUMN IF NOT EXISTS fiscal_address JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS legal_representative JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS verification_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyb_status TEXT NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS organization_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS security_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS branding_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.workspaces
SET organization_enabled = TRUE
WHERE workspace_type = 'business'::public.workspace_type;

ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS job_title TEXT,
  ADD COLUMN IF NOT EXISTS mfa_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS biometric_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS access_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offboarded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_access_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_members_status_check'
  ) THEN
    ALTER TABLE public.workspace_members
      ADD CONSTRAINT workspace_members_status_check
      CHECK (status IN ('invited', 'active', 'suspended', 'blocked', 'offboarded'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.organization_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permission_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.organization_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  system_key TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, name),
  UNIQUE (workspace_id, system_key)
);

CREATE TABLE IF NOT EXISTS public.organization_role_permissions (
  role_id UUID NOT NULL REFERENCES public.organization_roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES public.organization_permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS public.organization_member_roles (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES public.workspace_members(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES public.organization_roles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (member_id, role_id)
);

CREATE TABLE IF NOT EXISTS public.organization_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.organization_units(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  leader_member_id UUID REFERENCES public.workspace_members(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS public.organization_unit_members (
  unit_id UUID NOT NULL REFERENCES public.organization_units(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES public.workspace_members(id) ON DELETE CASCADE,
  is_lead BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (unit_id, member_id)
);

CREATE TABLE IF NOT EXISTS public.organization_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role_id UUID REFERENCES public.organization_roles(id) ON DELETE SET NULL,
  unit_id UUID REFERENCES public.organization_units(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  token_hash TEXT,
  invited_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.organization_directory_people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  rfc TEXT,
  relationship_type TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.organization_authorities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  person_id UUID REFERENCES public.organization_directory_people(id) ON DELETE SET NULL,
  member_id UUID REFERENCES public.workspace_members(id) ON DELETE SET NULL,
  authority_type TEXT NOT NULL,
  scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  valid_from DATE,
  valid_until DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'expired', 'revoked')),
  evidence_path TEXT,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.organization_approval_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  definition JSONB NOT NULL DEFAULT '{"steps":[]}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, name, version)
);

CREATE TABLE IF NOT EXISTS public.organization_signature_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  allowed_signature_types TEXT[] NOT NULL DEFAULT ARRAY['autografa', 'click_sign']::text[],
  requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, name, version)
);

CREATE TABLE IF NOT EXISTS public.organization_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_configured' CHECK (status IN ('not_configured', 'connected', 'degraded', 'disabled', 'error')),
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_reference TEXT,
  last_health_check_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, provider_key)
);

CREATE TABLE IF NOT EXISTS public.organization_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  certificate_type TEXT NOT NULL,
  subject_name TEXT NOT NULL,
  serial_number TEXT,
  fingerprint_sha256 TEXT,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  public_certificate_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'valid', 'expiring', 'expired', 'revoked', 'invalid')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.organization_cost_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  budget NUMERIC(14, 2),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS public.organization_usage_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  quantity NUMERIC(14, 4) NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'event',
  source_type TEXT,
  source_id UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.organization_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  actor_user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  summary TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  user_agent TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_status ON public.workspace_members(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_org_roles_workspace ON public.organization_roles(workspace_id);
CREATE INDEX IF NOT EXISTS idx_org_member_roles_workspace ON public.organization_member_roles(workspace_id, member_id);
CREATE INDEX IF NOT EXISTS idx_org_units_workspace ON public.organization_units(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_org_invitations_workspace ON public.organization_invitations(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_org_directory_workspace ON public.organization_directory_people(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_org_authorities_workspace ON public.organization_authorities(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_org_workflows_workspace ON public.organization_approval_workflows(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_org_policies_workspace ON public.organization_signature_policies(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_org_integrations_workspace ON public.organization_integrations(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_org_certificates_workspace ON public.organization_certificates(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_org_usage_workspace ON public.organization_usage_ledger(workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_audit_workspace ON public.organization_audit_events(workspace_id, occurred_at DESC);

INSERT INTO public.organization_permissions (permission_key, name, description, category) VALUES
  ('organization.read', 'Ver organización', 'Consultar el perfil y la configuración general.', 'Organización'),
  ('organization.profile.update', 'Editar organización', 'Actualizar datos generales, fiscales y de contacto.', 'Organización'),
  ('organization.transfer_ownership', 'Transferir propiedad', 'Transferir la propiedad de la organización.', 'Organización'),
  ('members.read', 'Ver miembros', 'Consultar miembros e invitaciones.', 'Personas'),
  ('members.invite', 'Invitar miembros', 'Crear y revocar invitaciones.', 'Personas'),
  ('members.update', 'Administrar miembros', 'Cambiar rol, requisitos y estado de acceso.', 'Personas'),
  ('members.suspend', 'Suspender miembros', 'Suspender o bloquear el acceso.', 'Personas'),
  ('members.offboard', 'Dar de baja', 'Cerrar acceso conservando el historial.', 'Personas'),
  ('roles.read', 'Ver roles', 'Consultar roles y permisos.', 'Acceso'),
  ('roles.manage', 'Administrar roles', 'Crear roles y asignar permisos.', 'Acceso'),
  ('teams.read', 'Ver equipos', 'Consultar la estructura de equipos.', 'Personas'),
  ('teams.manage', 'Administrar equipos', 'Crear equipos y asignar miembros.', 'Personas'),
  ('directory.read', 'Ver directorio', 'Consultar el directorio corporativo.', 'Personas'),
  ('directory.manage', 'Administrar directorio', 'Gestionar personas relacionadas.', 'Personas'),
  ('authorities.read', 'Ver facultades', 'Consultar facultades y vigencias.', 'Gobernanza'),
  ('authorities.manage', 'Administrar facultades', 'Crear, modificar y revocar facultades.', 'Gobernanza'),
  ('workflows.read', 'Ver flujos', 'Consultar flujos de aprobación.', 'Gobernanza'),
  ('workflows.manage', 'Administrar flujos', 'Versionar y publicar flujos.', 'Gobernanza'),
  ('signature_policies.read', 'Ver políticas de firma', 'Consultar políticas de firma.', 'Gobernanza'),
  ('signature_policies.manage', 'Administrar políticas de firma', 'Versionar y publicar políticas.', 'Gobernanza'),
  ('resources.read', 'Ver recursos', 'Consultar recursos organizacionales.', 'Operación'),
  ('resources.manage', 'Administrar recursos', 'Gestionar recursos organizacionales.', 'Operación'),
  ('security.read', 'Ver seguridad', 'Consultar postura y controles de seguridad.', 'Seguridad'),
  ('security.manage', 'Administrar seguridad', 'Configurar controles de acceso.', 'Seguridad'),
  ('certificates.read', 'Ver certificados', 'Consultar certificados públicos y vigencias.', 'Seguridad'),
  ('certificates.manage', 'Administrar certificados', 'Gestionar certificados sin exponer llaves privadas.', 'Seguridad'),
  ('branding.read', 'Ver marca', 'Consultar identidad visual y comunicaciones.', 'Configuración'),
  ('branding.manage', 'Administrar marca', 'Configurar identidad visual y comunicaciones.', 'Configuración'),
  ('integrations.read', 'Ver integraciones', 'Consultar conexiones y salud.', 'Configuración'),
  ('integrations.manage', 'Administrar integraciones', 'Gestionar referencias de configuración.', 'Configuración'),
  ('billing.read', 'Ver plan y consumo', 'Consultar plan, límites y consumo.', 'Facturación'),
  ('billing.manage', 'Administrar facturación', 'Gestionar plan y centros de costo.', 'Facturación'),
  ('audit.read', 'Ver auditoría', 'Consultar eventos de auditoría.', 'Auditoría'),
  ('audit.export', 'Exportar auditoría', 'Exportar eventos autorizados.', 'Auditoría')
ON CONFLICT (permission_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category;

CREATE OR REPLACE FUNCTION public.is_active_workspace_member(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = ws_id
      AND wm.user_id = auth.uid()
      AND wm.status = 'active'
      AND (wm.access_expires_at IS NULL OR wm.access_expires_at > CURRENT_TIMESTAMP)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_member(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT public.is_active_workspace_member(ws_id) $$;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = ws_id
      AND wm.user_id = auth.uid()
      AND wm.status = 'active'
      AND wm.role IN ('owner', 'admin')
      AND (wm.access_expires_at IS NULL OR wm.access_expires_at > CURRENT_TIMESTAMP)
  );
$$;

CREATE OR REPLACE FUNCTION public.shares_workspace_with(profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members target
    JOIN public.workspace_members viewer ON viewer.workspace_id = target.workspace_id
    WHERE target.user_id = profile_id
      AND target.status = 'active'
      AND viewer.user_id = auth.uid()
      AND viewer.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_organization_permission(ws_id UUID, requested_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = ws_id
      AND wm.user_id = auth.uid()
      AND wm.status = 'active'
      AND (wm.access_expires_at IS NULL OR wm.access_expires_at > CURRENT_TIMESTAMP)
      AND (
        wm.role = 'owner'
        OR (wm.role = 'admin' AND requested_permission <> 'organization.transfer_ownership')
        OR EXISTS (
          SELECT 1
          FROM public.organization_member_roles omr
          JOIN public.organization_role_permissions orp ON orp.role_id = omr.role_id
          JOIN public.organization_permissions op ON op.id = orp.permission_id
          WHERE omr.member_id = wm.id
            AND omr.workspace_id = ws_id
            AND op.permission_key = requested_permission
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_organization_permissions(ws_id UUID)
RETURNS TABLE(permission_key TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT op.permission_key
  FROM public.organization_permissions op
  WHERE public.has_organization_permission(ws_id, op.permission_key)
  ORDER BY op.permission_key;
$$;

CREATE OR REPLACE FUNCTION public.set_organization_role_permissions(
  ws_id UUID,
  target_role_id UUID,
  permission_keys TEXT[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_is_system BOOLEAN;
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'roles.manage') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;

  SELECT is_system
  INTO target_is_system
  FROM public.organization_roles
  WHERE id = target_role_id AND workspace_id = ws_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_role_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF target_is_system THEN
    RAISE EXCEPTION 'system_role_is_read_only' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.organization_role_permissions
  WHERE role_id = target_role_id;

  INSERT INTO public.organization_role_permissions (role_id, permission_id)
  SELECT target_role_id, permission.id
  FROM public.organization_permissions permission
  WHERE permission.permission_key = ANY(COALESCE(permission_keys, ARRAY[]::TEXT[]));

  INSERT INTO public.organization_audit_events (
    workspace_id, actor_user_id, event_type, resource_type, resource_id, summary, payload
  ) VALUES (
    ws_id,
    auth.uid(),
    'role.permissions.updated',
    'organization_role',
    target_role_id::TEXT,
    'Permisos de rol actualizados',
    jsonb_build_object('permission_keys', COALESCE(permission_keys, ARRAY[]::TEXT[]))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.bootstrap_business_organization(ws_id UUID, owner_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_role_id UUID;
  admin_role_id UUID;
  member_role_id UUID;
BEGIN
  UPDATE public.workspaces
  SET organization_enabled = TRUE,
      legal_name = COALESCE(legal_name, name),
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ws_id AND workspace_type = 'business'::public.workspace_type;

  INSERT INTO public.organization_roles (workspace_id, name, description, system_key, is_system, created_by)
  VALUES (ws_id, 'Propietario', 'Control total de la organización.', 'owner', TRUE, owner_user_id)
  ON CONFLICT (workspace_id, system_key) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
  RETURNING id INTO owner_role_id;

  INSERT INTO public.organization_roles (workspace_id, name, description, system_key, is_system, created_by)
  VALUES (ws_id, 'Administrador', 'Administración operativa sin transferencia de propiedad.', 'admin', TRUE, owner_user_id)
  ON CONFLICT (workspace_id, system_key) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
  RETURNING id INTO admin_role_id;

  INSERT INTO public.organization_roles (workspace_id, name, description, system_key, is_system, created_by)
  VALUES (ws_id, 'Miembro', 'Acceso de consulta básico.', 'member', TRUE, owner_user_id)
  ON CONFLICT (workspace_id, system_key) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
  RETURNING id INTO member_role_id;

  INSERT INTO public.organization_role_permissions (role_id, permission_id)
  SELECT owner_role_id, id FROM public.organization_permissions
  ON CONFLICT DO NOTHING;

  INSERT INTO public.organization_role_permissions (role_id, permission_id)
  SELECT admin_role_id, id
  FROM public.organization_permissions
  WHERE permission_key <> 'organization.transfer_ownership'
  ON CONFLICT DO NOTHING;

  INSERT INTO public.organization_role_permissions (role_id, permission_id)
  SELECT member_role_id, id
  FROM public.organization_permissions
  WHERE permission_key IN (
    'organization.read', 'members.read', 'teams.read', 'directory.read',
    'authorities.read', 'workflows.read', 'signature_policies.read',
    'resources.read', 'security.read', 'certificates.read',
    'branding.read', 'integrations.read', 'billing.read'
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO public.organization_member_roles (workspace_id, member_id, role_id, assigned_by)
  SELECT wm.workspace_id,
         wm.id,
         CASE wm.role WHEN 'owner' THEN owner_role_id WHEN 'admin' THEN admin_role_id ELSE member_role_id END,
         owner_user_id
  FROM public.workspace_members wm
  WHERE wm.workspace_id = ws_id
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.bootstrap_business_organization_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.workspace_type = 'business'::public.workspace_type THEN
    PERFORM public.bootstrap_business_organization(NEW.id, NEW.owner_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_business_workspace_created ON public.workspaces;
CREATE TRIGGER on_business_workspace_created
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.bootstrap_business_organization_trigger();

CREATE OR REPLACE FUNCTION public.assign_business_member_system_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  system_role_id UUID;
BEGIN
  SELECT r.id INTO system_role_id
  FROM public.organization_roles r
  JOIN public.workspaces w ON w.id = r.workspace_id
  WHERE r.workspace_id = NEW.workspace_id
    AND w.workspace_type = 'business'::public.workspace_type
    AND r.system_key = NEW.role::text
  LIMIT 1;

  IF system_role_id IS NOT NULL THEN
    INSERT INTO public.organization_member_roles (workspace_id, member_id, role_id, assigned_by)
    VALUES (NEW.workspace_id, NEW.id, system_role_id, COALESCE(NEW.invited_by, NEW.user_id))
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_organization_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'workspaces' AND NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'organization_owner_change_requires_transfer_workflow' USING ERRCODE = '42501';
  END IF;

  IF TG_TABLE_NAME = 'workspace_members' AND OLD.role = 'owner'::public.workspace_member_role THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'organization_owner_membership_is_protected' USING ERRCODE = '42501';
    END IF;
    IF NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'organization_owner_change_requires_transfer_workflow' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_organization_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expected_workspace_id UUID;
  target_role_system_key TEXT;
BEGIN
  IF TG_TABLE_NAME = 'organization_member_roles' THEN
    SELECT workspace_id INTO expected_workspace_id
    FROM public.workspace_members
    WHERE id = NEW.member_id;
    IF expected_workspace_id IS DISTINCT FROM NEW.workspace_id THEN
      RAISE EXCEPTION 'organization_member_workspace_mismatch' USING ERRCODE = '23514';
    END IF;

    SELECT workspace_id INTO expected_workspace_id
    FROM public.organization_roles
    WHERE id = NEW.role_id;
    IF expected_workspace_id IS DISTINCT FROM NEW.workspace_id THEN
      RAISE EXCEPTION 'organization_role_workspace_mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'organization_units' THEN
    IF NEW.parent_id IS NOT NULL THEN
      SELECT workspace_id INTO expected_workspace_id
      FROM public.organization_units
      WHERE id = NEW.parent_id;
      IF expected_workspace_id IS DISTINCT FROM NEW.workspace_id THEN
        RAISE EXCEPTION 'organization_parent_unit_workspace_mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;

    IF NEW.leader_member_id IS NOT NULL THEN
      SELECT workspace_id INTO expected_workspace_id
      FROM public.workspace_members
      WHERE id = NEW.leader_member_id;
      IF expected_workspace_id IS DISTINCT FROM NEW.workspace_id THEN
        RAISE EXCEPTION 'organization_unit_leader_workspace_mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'organization_unit_members' THEN
    SELECT workspace_id INTO expected_workspace_id
    FROM public.organization_units
    WHERE id = NEW.unit_id;
    IF expected_workspace_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.id = NEW.member_id
        AND wm.workspace_id = expected_workspace_id
    ) THEN
      RAISE EXCEPTION 'organization_unit_member_workspace_mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'organization_invitations' THEN
    IF NEW.role_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.organization_roles r
      WHERE r.id = NEW.role_id
        AND r.workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION 'organization_invitation_role_workspace_mismatch' USING ERRCODE = '23514';
    END IF;

    IF NEW.role_id IS NOT NULL THEN
      SELECT system_key INTO target_role_system_key
      FROM public.organization_roles
      WHERE id = NEW.role_id;

      IF target_role_system_key = 'owner' THEN
        RAISE EXCEPTION 'organization_owner_role_cannot_be_invited' USING ERRCODE = '42501';
      END IF;

      IF target_role_system_key IS DISTINCT FROM 'member'
         AND NOT public.has_organization_permission(NEW.workspace_id, 'roles.manage') THEN
        RAISE EXCEPTION 'organization_invitation_role_assignment_denied' USING ERRCODE = '42501';
      END IF;
    END IF;

    IF NEW.unit_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.organization_units u
      WHERE u.id = NEW.unit_id
        AND u.workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION 'organization_invitation_unit_workspace_mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'organization_authorities' THEN
    IF NEW.person_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.organization_directory_people person
      WHERE person.id = NEW.person_id
        AND person.workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION 'organization_authority_person_workspace_mismatch' USING ERRCODE = '23514';
    END IF;

    IF NEW.member_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.id = NEW.member_id
        AND wm.workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION 'organization_authority_member_workspace_mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_workspace_member_update_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin') OR public.is_workspace_admin(OLD.workspace_id) THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.joined_at IS DISTINCT FROM OLD.joined_at
     OR NEW.invited_by IS DISTINCT FROM OLD.invited_by
     OR NEW.last_access_at IS DISTINCT FROM OLD.last_access_at THEN
    RAISE EXCEPTION 'organization_member_protected_fields' USING ERRCODE = '42501';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
     AND NOT public.has_organization_permission(OLD.workspace_id, 'roles.manage') THEN
    RAISE EXCEPTION 'organization_member_role_update_denied' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'offboarded'
       AND NOT public.has_organization_permission(OLD.workspace_id, 'members.offboard') THEN
      RAISE EXCEPTION 'organization_member_offboard_denied' USING ERRCODE = '42501';
    ELSIF NEW.status IN ('active', 'suspended', 'blocked')
          AND NOT public.has_organization_permission(OLD.workspace_id, 'members.suspend') THEN
      RAISE EXCEPTION 'organization_member_status_update_denied' USING ERRCODE = '42501';
    ELSIF NEW.status = 'invited'
          AND NOT public.has_organization_permission(OLD.workspace_id, 'members.update') THEN
      RAISE EXCEPTION 'organization_member_update_denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF (
    NEW.job_title IS DISTINCT FROM OLD.job_title
    OR NEW.mfa_required IS DISTINCT FROM OLD.mfa_required
    OR NEW.biometric_required IS DISTINCT FROM OLD.biometric_required
    OR NEW.access_expires_at IS DISTINCT FROM OLD.access_expires_at
  ) AND NOT public.has_organization_permission(OLD.workspace_id, 'members.update') THEN
    RAISE EXCEPTION 'organization_member_update_denied' USING ERRCODE = '42501';
  END IF;

  IF NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
     AND NOT public.has_organization_permission(OLD.workspace_id, 'members.suspend') THEN
    RAISE EXCEPTION 'organization_member_suspend_denied' USING ERRCODE = '42501';
  END IF;

  IF NEW.offboarded_at IS DISTINCT FROM OLD.offboarded_at
     AND NOT public.has_organization_permission(OLD.workspace_id, 'members.offboard') THEN
    RAISE EXCEPTION 'organization_member_offboard_denied' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_workspace_organization_update_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Trusted SECURITY DEFINER functions use the table owner while bootstrapping a
  -- workspace. Client requests continue to be evaluated as authenticated.
  IF current_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF public.is_workspace_admin(OLD.id) THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.workspace_type IS DISTINCT FROM OLD.workspace_type
     OR NEW.organization_enabled IS DISTINCT FROM OLD.organization_enabled
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'organization_workspace_protected_fields' USING ERRCODE = '42501';
  END IF;

  IF (
    NEW.name IS DISTINCT FROM OLD.name
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.legal_name IS DISTINCT FROM OLD.legal_name
    OR NEW.trade_name IS DISTINCT FROM OLD.trade_name
    OR NEW.rfc IS DISTINCT FROM OLD.rfc
    OR NEW.legal_person_type IS DISTINCT FROM OLD.legal_person_type
    OR NEW.tax_regime IS DISTINCT FROM OLD.tax_regime
    OR NEW.industry IS DISTINCT FROM OLD.industry
    OR NEW.website IS DISTINCT FROM OLD.website
    OR NEW.contact_email IS DISTINCT FROM OLD.contact_email
    OR NEW.contact_phone IS DISTINCT FROM OLD.contact_phone
    OR NEW.timezone IS DISTINCT FROM OLD.timezone
    OR NEW.locale IS DISTINCT FROM OLD.locale
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.fiscal_address IS DISTINCT FROM OLD.fiscal_address
    OR NEW.legal_representative IS DISTINCT FROM OLD.legal_representative
    OR NEW.verification_status IS DISTINCT FROM OLD.verification_status
    OR NEW.verification_updated_at IS DISTINCT FROM OLD.verification_updated_at
    OR NEW.kyb_status IS DISTINCT FROM OLD.kyb_status
    OR NEW.organization_settings IS DISTINCT FROM OLD.organization_settings
  ) AND NOT public.has_organization_permission(OLD.id, 'organization.profile.update') THEN
    RAISE EXCEPTION 'organization_profile_update_denied' USING ERRCODE = '42501';
  END IF;

  IF NEW.security_settings IS DISTINCT FROM OLD.security_settings
     AND NOT public.has_organization_permission(OLD.id, 'security.manage') THEN
    RAISE EXCEPTION 'organization_security_update_denied' USING ERRCODE = '42501';
  END IF;

  IF (
    NEW.branding_settings IS DISTINCT FROM OLD.branding_settings
    OR NEW.logo_url IS DISTINCT FROM OLD.logo_url
  ) AND NOT public.has_organization_permission(OLD.id, 'branding.manage') THEN
    RAISE EXCEPTION 'organization_branding_update_denied' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_business_workspace_member_created ON public.workspace_members;
CREATE TRIGGER on_business_workspace_member_created
  AFTER INSERT ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.assign_business_member_system_role();

DROP TRIGGER IF EXISTS protect_workspace_owner_change ON public.workspaces;
CREATE TRIGGER protect_workspace_owner_change
  BEFORE UPDATE OF owner_id ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.protect_organization_ownership();

DROP TRIGGER IF EXISTS protect_workspace_owner_membership ON public.workspace_members;
CREATE TRIGGER protect_workspace_owner_membership
  BEFORE UPDATE OR DELETE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.protect_organization_ownership();

DROP TRIGGER IF EXISTS enforce_workspace_member_update_scope ON public.workspace_members;
CREATE TRIGGER enforce_workspace_member_update_scope
  BEFORE UPDATE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_member_update_scope();

DROP TRIGGER IF EXISTS enforce_workspace_organization_update_scope ON public.workspaces;
CREATE TRIGGER enforce_workspace_organization_update_scope
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_organization_update_scope();

DROP TRIGGER IF EXISTS enforce_org_member_role_scope ON public.organization_member_roles;
CREATE TRIGGER enforce_org_member_role_scope
  BEFORE INSERT OR UPDATE ON public.organization_member_roles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_tenant_scope();

DROP TRIGGER IF EXISTS enforce_org_unit_scope ON public.organization_units;
CREATE TRIGGER enforce_org_unit_scope
  BEFORE INSERT OR UPDATE ON public.organization_units
  FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_tenant_scope();

DROP TRIGGER IF EXISTS enforce_org_unit_member_scope ON public.organization_unit_members;
CREATE TRIGGER enforce_org_unit_member_scope
  BEFORE INSERT OR UPDATE ON public.organization_unit_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_tenant_scope();

DROP TRIGGER IF EXISTS enforce_org_invitation_scope ON public.organization_invitations;
CREATE TRIGGER enforce_org_invitation_scope
  BEFORE INSERT OR UPDATE ON public.organization_invitations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_tenant_scope();

DROP TRIGGER IF EXISTS enforce_org_authority_scope ON public.organization_authorities;
CREATE TRIGGER enforce_org_authority_scope
  BEFORE INSERT OR UPDATE ON public.organization_authorities
  FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_tenant_scope();

DO $$
DECLARE existing_workspace RECORD;
BEGIN
  FOR existing_workspace IN
    SELECT id, owner_id FROM public.workspaces WHERE workspace_type = 'business'::public.workspace_type
  LOOP
    PERFORM public.bootstrap_business_organization(existing_workspace.id, existing_workspace.owner_id);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.bootstrap_business_organization(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bootstrap_business_organization_trigger() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_business_member_system_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_organization_ownership() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_organization_tenant_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_workspace_organization_update_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_workspace_member_update_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_workspace_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_workspace_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_workspace_admin(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shares_workspace_with(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_organization_permission(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_organization_permissions(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_organization_role_permissions(UUID, UUID, TEXT[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_active_workspace_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_workspace_with(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_organization_permission(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_organization_permissions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_organization_role_permissions(UUID, UUID, TEXT[]) TO authenticated;

GRANT SELECT ON public.organization_permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_role_permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_member_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_units TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_unit_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_invitations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_directory_people TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_authorities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_approval_workflows TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_signature_policies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_integrations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_certificates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_cost_centers TO authenticated;
GRANT SELECT ON public.organization_usage_ledger TO authenticated;
GRANT SELECT, INSERT ON public.organization_audit_events TO authenticated;

ALTER TABLE public.organization_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_member_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_unit_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_directory_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_approval_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_signature_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_usage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_admin_can_update" ON public.workspaces;
CREATE POLICY "workspace_admin_can_update" ON public.workspaces
  FOR UPDATE TO authenticated
  USING (
    public.is_workspace_admin(id)
    OR public.has_organization_permission(id, 'organization.profile.update')
    OR public.has_organization_permission(id, 'security.manage')
    OR public.has_organization_permission(id, 'branding.manage')
  )
  WITH CHECK (
    public.is_workspace_admin(id)
    OR public.has_organization_permission(id, 'organization.profile.update')
    OR public.has_organization_permission(id, 'security.manage')
    OR public.has_organization_permission(id, 'branding.manage')
  );

DROP POLICY IF EXISTS "workspace_admin_update_members" ON public.workspace_members;
CREATE POLICY "workspace_admin_update_members" ON public.workspace_members
  FOR UPDATE TO authenticated
  USING (
    public.is_workspace_admin(workspace_id)
    OR public.has_organization_permission(workspace_id, 'members.update')
    OR public.has_organization_permission(workspace_id, 'members.suspend')
    OR public.has_organization_permission(workspace_id, 'members.offboard')
  )
  WITH CHECK (
    public.is_workspace_admin(workspace_id)
    OR public.has_organization_permission(workspace_id, 'members.update')
    OR public.has_organization_permission(workspace_id, 'members.suspend')
    OR public.has_organization_permission(workspace_id, 'members.offboard')
  );

DROP POLICY IF EXISTS "users_view_own_memberships" ON public.workspace_members;
CREATE POLICY "users_view_own_memberships" ON public.workspace_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_workspace_admin(workspace_id)
    OR public.has_organization_permission(workspace_id, 'members.read')
  );

DROP POLICY IF EXISTS "authenticated_read_org_permissions" ON public.organization_permissions;
CREATE POLICY "authenticated_read_org_permissions" ON public.organization_permissions
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "workspace_members_read_shared_profiles" ON public.user_profiles;
CREATE POLICY "workspace_members_read_shared_profiles" ON public.user_profiles
  FOR SELECT TO authenticated USING (id = auth.uid() OR public.shares_workspace_with(id));

DROP POLICY IF EXISTS "org_members_read_roles" ON public.organization_roles;
CREATE POLICY "org_members_read_roles" ON public.organization_roles
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'roles.read'));
DROP POLICY IF EXISTS "org_admin_manage_roles" ON public.organization_roles;
CREATE POLICY "org_admin_manage_roles" ON public.organization_roles
  FOR ALL TO authenticated USING (public.has_organization_permission(workspace_id, 'roles.manage'))
  WITH CHECK (public.has_organization_permission(workspace_id, 'roles.manage'));

DROP POLICY IF EXISTS "org_members_read_role_permissions" ON public.organization_role_permissions;
CREATE POLICY "org_members_read_role_permissions" ON public.organization_role_permissions
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.organization_roles r
    WHERE r.id = role_id AND public.has_organization_permission(r.workspace_id, 'roles.read')
  ));
DROP POLICY IF EXISTS "org_admin_manage_role_permissions" ON public.organization_role_permissions;
CREATE POLICY "org_admin_manage_role_permissions" ON public.organization_role_permissions
  FOR ALL TO authenticated USING (EXISTS (
    SELECT 1 FROM public.organization_roles r
    WHERE r.id = role_id AND public.has_organization_permission(r.workspace_id, 'roles.manage')
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.organization_roles r
    WHERE r.id = role_id AND public.has_organization_permission(r.workspace_id, 'roles.manage')
  ));

DROP POLICY IF EXISTS "org_members_read_member_roles" ON public.organization_member_roles;
CREATE POLICY "org_members_read_member_roles" ON public.organization_member_roles
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'roles.read'));
DROP POLICY IF EXISTS "org_admin_manage_member_roles" ON public.organization_member_roles;
CREATE POLICY "org_admin_manage_member_roles" ON public.organization_member_roles
  FOR ALL TO authenticated USING (public.has_organization_permission(workspace_id, 'roles.manage'))
  WITH CHECK (public.has_organization_permission(workspace_id, 'roles.manage'));

DROP POLICY IF EXISTS "org_members_read_units" ON public.organization_units;
CREATE POLICY "org_members_read_units" ON public.organization_units
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'teams.read'));
DROP POLICY IF EXISTS "org_admin_manage_units" ON public.organization_units;
CREATE POLICY "org_admin_manage_units" ON public.organization_units
  FOR ALL TO authenticated USING (public.has_organization_permission(workspace_id, 'teams.manage'))
  WITH CHECK (public.has_organization_permission(workspace_id, 'teams.manage'));

DROP POLICY IF EXISTS "org_members_read_unit_members" ON public.organization_unit_members;
CREATE POLICY "org_members_read_unit_members" ON public.organization_unit_members
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.organization_units u
    WHERE u.id = unit_id AND public.has_organization_permission(u.workspace_id, 'teams.read')
  ));
DROP POLICY IF EXISTS "org_admin_manage_unit_members" ON public.organization_unit_members;
CREATE POLICY "org_admin_manage_unit_members" ON public.organization_unit_members
  FOR ALL TO authenticated USING (EXISTS (
    SELECT 1 FROM public.organization_units u
    WHERE u.id = unit_id AND public.has_organization_permission(u.workspace_id, 'teams.manage')
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.organization_units u
    WHERE u.id = unit_id AND public.has_organization_permission(u.workspace_id, 'teams.manage')
  ));

DROP POLICY IF EXISTS "org_members_read_invitations" ON public.organization_invitations;
CREATE POLICY "org_members_read_invitations" ON public.organization_invitations
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'members.read'));
DROP POLICY IF EXISTS "org_admin_manage_invitations" ON public.organization_invitations;
DROP POLICY IF EXISTS "org_admin_create_invitations" ON public.organization_invitations;
CREATE POLICY "org_admin_create_invitations" ON public.organization_invitations
  FOR INSERT TO authenticated WITH CHECK (
    public.has_organization_permission(workspace_id, 'members.invite')
    AND invited_by = auth.uid()
  );
DROP POLICY IF EXISTS "org_admin_update_invitations" ON public.organization_invitations;
CREATE POLICY "org_admin_update_invitations" ON public.organization_invitations
  FOR UPDATE TO authenticated
  USING (public.has_organization_permission(workspace_id, 'members.invite'))
  WITH CHECK (public.has_organization_permission(workspace_id, 'members.invite'));
DROP POLICY IF EXISTS "org_admin_delete_invitations" ON public.organization_invitations;
CREATE POLICY "org_admin_delete_invitations" ON public.organization_invitations
  FOR DELETE TO authenticated
  USING (public.has_organization_permission(workspace_id, 'members.invite'));

DROP POLICY IF EXISTS "org_members_read_directory" ON public.organization_directory_people;
CREATE POLICY "org_members_read_directory" ON public.organization_directory_people
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'directory.read'));
DROP POLICY IF EXISTS "org_admin_manage_directory" ON public.organization_directory_people;
CREATE POLICY "org_admin_manage_directory" ON public.organization_directory_people
  FOR ALL TO authenticated USING (public.has_organization_permission(workspace_id, 'directory.manage'))
  WITH CHECK (public.has_organization_permission(workspace_id, 'directory.manage'));

DROP POLICY IF EXISTS "org_members_read_authorities" ON public.organization_authorities;
CREATE POLICY "org_members_read_authorities" ON public.organization_authorities
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'authorities.read'));
DROP POLICY IF EXISTS "org_admin_manage_authorities" ON public.organization_authorities;
CREATE POLICY "org_admin_manage_authorities" ON public.organization_authorities
  FOR ALL TO authenticated USING (public.has_organization_permission(workspace_id, 'authorities.manage'))
  WITH CHECK (public.has_organization_permission(workspace_id, 'authorities.manage'));

DROP POLICY IF EXISTS "org_members_read_workflows" ON public.organization_approval_workflows;
CREATE POLICY "org_members_read_workflows" ON public.organization_approval_workflows
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'workflows.read'));
DROP POLICY IF EXISTS "org_admin_manage_workflows" ON public.organization_approval_workflows;
CREATE POLICY "org_admin_manage_workflows" ON public.organization_approval_workflows
  FOR ALL TO authenticated USING (public.has_organization_permission(workspace_id, 'workflows.manage'))
  WITH CHECK (public.has_organization_permission(workspace_id, 'workflows.manage'));

DROP POLICY IF EXISTS "org_members_read_signature_policies" ON public.organization_signature_policies;
CREATE POLICY "org_members_read_signature_policies" ON public.organization_signature_policies
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'signature_policies.read'));
DROP POLICY IF EXISTS "org_admin_manage_signature_policies" ON public.organization_signature_policies;
CREATE POLICY "org_admin_manage_signature_policies" ON public.organization_signature_policies
  FOR ALL TO authenticated USING (public.has_organization_permission(workspace_id, 'signature_policies.manage'))
  WITH CHECK (public.has_organization_permission(workspace_id, 'signature_policies.manage'));

DROP POLICY IF EXISTS "org_members_read_integrations" ON public.organization_integrations;
CREATE POLICY "org_members_read_integrations" ON public.organization_integrations
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'integrations.read'));
DROP POLICY IF EXISTS "org_admin_manage_integrations" ON public.organization_integrations;
CREATE POLICY "org_admin_manage_integrations" ON public.organization_integrations
  FOR ALL TO authenticated USING (public.has_organization_permission(workspace_id, 'integrations.manage'))
  WITH CHECK (public.has_organization_permission(workspace_id, 'integrations.manage'));

DROP POLICY IF EXISTS "org_members_read_certificates" ON public.organization_certificates;
CREATE POLICY "org_members_read_certificates" ON public.organization_certificates
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'certificates.read'));
DROP POLICY IF EXISTS "org_admin_manage_certificates" ON public.organization_certificates;
CREATE POLICY "org_admin_manage_certificates" ON public.organization_certificates
  FOR ALL TO authenticated USING (public.has_organization_permission(workspace_id, 'certificates.manage'))
  WITH CHECK (public.has_organization_permission(workspace_id, 'certificates.manage'));

DROP POLICY IF EXISTS "org_members_read_cost_centers" ON public.organization_cost_centers;
CREATE POLICY "org_members_read_cost_centers" ON public.organization_cost_centers
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'billing.read'));
DROP POLICY IF EXISTS "org_admin_manage_cost_centers" ON public.organization_cost_centers;
CREATE POLICY "org_admin_manage_cost_centers" ON public.organization_cost_centers
  FOR ALL TO authenticated USING (public.has_organization_permission(workspace_id, 'billing.manage'))
  WITH CHECK (public.has_organization_permission(workspace_id, 'billing.manage'));

DROP POLICY IF EXISTS "org_members_read_usage" ON public.organization_usage_ledger;
CREATE POLICY "org_members_read_usage" ON public.organization_usage_ledger
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'billing.read'));

DROP POLICY IF EXISTS "org_members_read_audit" ON public.organization_audit_events;
CREATE POLICY "org_members_read_audit" ON public.organization_audit_events
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'audit.read'));
DROP POLICY IF EXISTS "org_members_append_audit" ON public.organization_audit_events;
CREATE POLICY "org_members_append_audit" ON public.organization_audit_events
  FOR INSERT TO authenticated WITH CHECK (
    public.is_active_workspace_member(workspace_id) AND actor_user_id = auth.uid()
  );
