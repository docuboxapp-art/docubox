-- Organization advanced administration.
-- Extends the governance foundation without replacing existing security,
-- certification, subscription, notification or audit records.

ALTER TABLE public.organization_integrations
  ADD COLUMN IF NOT EXISTS integration_type TEXT NOT NULL DEFAULT 'application',
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'sandbox',
  ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS installed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE public.organization_certificates
  ADD COLUMN IF NOT EXISTS alias TEXT,
  ADD COLUMN IF NOT EXISTS rfc TEXT,
  ADD COLUMN IF NOT EXISTS custody_type TEXT NOT NULL DEFAULT 'metadata_only',
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'sandbox',
  ADD COLUMN IF NOT EXISTS provider_name TEXT,
  ADD COLUMN IF NOT EXISTS key_reference TEXT,
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replaced_by UUID REFERENCES public.organization_certificates(id) ON DELETE SET NULL;

ALTER TABLE public.organization_cost_centers
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'MXN',
  ADD COLUMN IF NOT EXISTS alert_threshold_percent INTEGER NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS owner_member_id UUID REFERENCES public.workspace_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.organization_audit_events
  ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'info',
  ADD COLUMN IF NOT EXISTS module TEXT,
  ADD COLUMN IF NOT EXISTS correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'ui',
  ADD COLUMN IF NOT EXISTS before_payload JSONB,
  ADD COLUMN IF NOT EXISTS after_payload JSONB,
  ADD COLUMN IF NOT EXISTS evidence_refs JSONB NOT NULL DEFAULT '[]'::JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_integrations_type_check') THEN
    ALTER TABLE public.organization_integrations ADD CONSTRAINT org_integrations_type_check
      CHECK (integration_type IN ('application', 'sso', 'scim', 'kyc', 'notification', 'storage', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_integrations_environment_check') THEN
    ALTER TABLE public.organization_integrations ADD CONSTRAINT org_integrations_environment_check
      CHECK (environment IN ('sandbox', 'production'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_certificates_custody_check') THEN
    ALTER TABLE public.organization_certificates ADD CONSTRAINT org_certificates_custody_check
      CHECK (custody_type IN ('metadata_only', 'local_temporary', 'kms', 'hsm', 'external'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_certificates_environment_check') THEN
    ALTER TABLE public.organization_certificates ADD CONSTRAINT org_certificates_environment_check
      CHECK (environment IN ('sandbox', 'production'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_cost_centers_alert_check') THEN
    ALTER TABLE public.organization_cost_centers ADD CONSTRAINT org_cost_centers_alert_check
      CHECK (alert_threshold_percent BETWEEN 1 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_audit_outcome_check') THEN
    ALTER TABLE public.organization_audit_events ADD CONSTRAINT org_audit_outcome_check
      CHECK (outcome IN ('success', 'denied', 'failed', 'partial'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_audit_severity_check') THEN
    ALTER TABLE public.organization_audit_events ADD CONSTRAINT org_audit_severity_check
      CHECK (severity IN ('info', 'warning', 'high', 'critical'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_audit_origin_check') THEN
    ALTER TABLE public.organization_audit_events ADD CONSTRAINT org_audit_origin_check
      CHECK (origin IN ('ui', 'api', 'system', 'integration'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.organization_trusted_networks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  network_cidr CIDR NOT NULL,
  mode TEXT NOT NULL DEFAULT 'allow' CHECK (mode IN ('allow', 'block')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, network_cidr)
);

CREATE TABLE IF NOT EXISTS public.organization_security_alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'high', 'critical')),
  channels TEXT[] NOT NULL DEFAULT ARRAY['in_app']::TEXT[],
  recipients TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, event_key)
);

CREATE TABLE IF NOT EXISTS public.organization_session_revocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  member_id UUID NOT NULL REFERENCES public.workspace_members(id) ON DELETE RESTRICT,
  session_id UUID REFERENCES public.user_sessions(id) ON DELETE SET NULL,
  scope TEXT NOT NULL DEFAULT 'single' CHECK (scope IN ('single', 'member_all')),
  reason TEXT,
  revoked_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.organization_communication_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT,
  legal_version INTEGER NOT NULL DEFAULT 1,
  variables TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, template_key, legal_version)
);

CREATE TABLE IF NOT EXISTS public.organization_sender_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  sender_name TEXT,
  sender_email TEXT,
  reply_to TEXT,
  dns_status TEXT NOT NULL DEFAULT 'pending' CHECK (dns_status IN ('pending', 'verified', 'failed')),
  verification_reference TEXT,
  last_checked_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, domain)
);

CREATE TABLE IF NOT EXISTS public.organization_api_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  key_prefix TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  rotated_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  UNIQUE (workspace_id, key_prefix)
);

CREATE TABLE IF NOT EXISTS public.organization_webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  event_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  secret_hash TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  secret_iv TEXT NOT NULL,
  secret_tag TEXT NOT NULL,
  secret_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'degraded', 'disabled', 'revoked')),
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_delivery_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.organization_webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  endpoint_id UUID NOT NULL REFERENCES public.organization_webhook_endpoints(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  event_id UUID NOT NULL DEFAULT gen_random_uuid(),
  attempt_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed', 'discarded')),
  response_status INTEGER,
  response_time_ms INTEGER,
  error_code TEXT,
  next_retry_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (endpoint_id, event_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS public.organization_certificate_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  certificate_id UUID NOT NULL REFERENCES public.organization_certificates(id) ON DELETE CASCADE,
  member_id UUID REFERENCES public.workspace_members(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES public.organization_units(id) ON DELETE CASCADE,
  document_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  amount_limit NUMERIC(16,2),
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (member_id IS NOT NULL OR unit_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_org_trusted_networks_workspace ON public.organization_trusted_networks(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_org_alert_rules_workspace ON public.organization_security_alert_rules(workspace_id, enabled);
CREATE INDEX IF NOT EXISTS idx_org_revocations_workspace ON public.organization_session_revocations(workspace_id, revoked_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_communication_workspace ON public.organization_communication_templates(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_org_sender_domains_workspace ON public.organization_sender_domains(workspace_id, dns_status);
CREATE INDEX IF NOT EXISTS idx_org_api_credentials_workspace ON public.organization_api_credentials(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_org_webhooks_workspace ON public.organization_webhook_endpoints(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_org_webhook_deliveries_endpoint ON public.organization_webhook_deliveries(endpoint_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_certificate_permissions_certificate ON public.organization_certificate_permissions(certificate_id);
CREATE INDEX IF NOT EXISTS idx_org_audit_correlation ON public.organization_audit_events(workspace_id, correlation_id);

CREATE OR REPLACE FUNCTION public.organization_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_organization_security_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  session_hours INTEGER;
  concurrent_sessions INTEGER;
BEGIN
  IF NEW.workspace_type <> 'business'::public.workspace_type THEN
    RETURN NEW;
  END IF;

  session_hours := COALESCE((NEW.security_settings ->> 'session_max_hours')::INTEGER, 12);
  concurrent_sessions := COALESCE((NEW.security_settings ->> 'max_concurrent_sessions')::INTEGER, 3);
  IF session_hours < 1 OR session_hours > 168 THEN
    RAISE EXCEPTION 'organization_session_duration_out_of_range' USING ERRCODE = '22023';
  END IF;
  IF concurrent_sessions < 1 OR concurrent_sessions > 20 THEN
    RAISE EXCEPTION 'organization_concurrent_sessions_out_of_range' USING ERRCODE = '22023';
  END IF;

  IF COALESCE((NEW.security_settings ->> 'sso_enforced')::BOOLEAN, FALSE) THEN
    IF NOT COALESCE((NEW.security_settings ->> 'emergency_access')::BOOLEAN, FALSE) THEN
      RAISE EXCEPTION 'organization_sso_requires_emergency_access' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_integrations oi
      WHERE oi.workspace_id = NEW.id
        AND oi.integration_type = 'sso'
        AND oi.status = 'connected'
    ) THEN
      RAISE EXCEPTION 'organization_sso_provider_not_operational' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_organization_security_settings ON public.workspaces;
CREATE TRIGGER trg_validate_organization_security_settings
  BEFORE INSERT OR UPDATE OF security_settings ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.validate_organization_security_settings();

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'organization_trusted_networks', 'organization_security_alert_rules',
    'organization_communication_templates', 'organization_sender_domains',
    'organization_webhook_endpoints', 'organization_cost_centers'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON public.%I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.organization_touch_updated_at()',
      table_name, table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.get_organization_security_sessions(ws_id UUID)
RETURNS TABLE (
  session_id UUID,
  member_id UUID,
  user_id UUID,
  full_name TEXT,
  email TEXT,
  device_name TEXT,
  device_type TEXT,
  browser TEXT,
  os TEXT,
  ip_address TEXT,
  location TEXT,
  is_current BOOLEAN,
  last_active_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  risk_level TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'security.read') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    us.id,
    wm.id,
    wm.user_id,
    COALESCE(up.full_name, up.email, 'Usuario'),
    up.email,
    us.device_name,
    us.device_type,
    us.browser,
    us.os,
    us.ip_address,
    us.location,
    us.is_current,
    us.last_active_at,
    us.created_at,
    us.expires_at,
    CASE
      WHEN us.expires_at IS NOT NULL AND us.expires_at <= CURRENT_TIMESTAMP THEN 'expired'
      WHEN us.last_active_at < CURRENT_TIMESTAMP - INTERVAL '30 days' THEN 'stale'
      ELSE 'normal'
    END
  FROM public.workspace_members wm
  JOIN public.user_profiles up ON up.id = wm.user_id
  JOIN public.user_sessions us ON us.user_id = wm.user_id
  WHERE wm.workspace_id = ws_id
    AND wm.status = 'active'
  ORDER BY us.last_active_at DESC NULLS LAST;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_organization_session(
  ws_id UUID,
  target_session_id UUID,
  revocation_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_member_id UUID;
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'security.manage') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;

  SELECT wm.id INTO target_member_id
  FROM public.user_sessions us
  JOIN public.workspace_members wm ON wm.user_id = us.user_id
  WHERE us.id = target_session_id AND wm.workspace_id = ws_id AND wm.status = 'active';

  IF target_member_id IS NULL THEN
    RAISE EXCEPTION 'organization_session_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.user_sessions
  SET expires_at = CURRENT_TIMESTAMP, is_current = FALSE,
      session_token = 'revoked:' || id::TEXT || ':' || extract(epoch from CURRENT_TIMESTAMP)::BIGINT::TEXT
  WHERE id = target_session_id;

  INSERT INTO public.organization_session_revocations (
    workspace_id, member_id, session_id, scope, reason, revoked_by
  ) VALUES (
    ws_id, target_member_id, target_session_id, 'single', NULLIF(trim(revocation_reason), ''), auth.uid()
  );

  INSERT INTO public.organization_audit_events (
    workspace_id, actor_user_id, event_type, resource_type, resource_id,
    summary, severity, module, correlation_id
  ) VALUES (
    ws_id, auth.uid(), 'security.session.revoked', 'user_session', target_session_id::TEXT,
    'Sesión organizacional revocada', 'high', 'security', gen_random_uuid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_organization_crypto_overview(ws_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'certificates.read') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'certificate_count', (SELECT count(*) FROM public.organization_certificates oc WHERE oc.workspace_id = ws_id),
    'valid_certificates', (SELECT count(*) FROM public.organization_certificates oc WHERE oc.workspace_id = ws_id AND oc.status = 'valid'),
    'expiring_certificates', (SELECT count(*) FROM public.organization_certificates oc WHERE oc.workspace_id = ws_id AND (oc.status = 'expiring' OR oc.valid_until BETWEEN CURRENT_TIMESTAMP AND CURRENT_TIMESTAMP + INTERVAL '45 days')),
    'certifications_completed', (SELECT count(*) FROM public.document_certifications dc WHERE dc.workspace_id = ws_id AND dc.status = 'COMPLETED'),
    'certifications_failed', (SELECT count(*) FROM public.document_certifications dc WHERE dc.workspace_id = ws_id AND dc.status = 'FAILED'),
    'last_certification_at', (SELECT max(dc.completed_at) FROM public.document_certifications dc WHERE dc.workspace_id = ws_id AND dc.status = 'COMPLETED')
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_organization_security_sessions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_organization_session(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_organization_crypto_overview(UUID) TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_trusted_networks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_security_alert_rules TO authenticated;
GRANT SELECT ON public.organization_session_revocations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_communication_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_sender_domains TO authenticated;
GRANT SELECT ON public.organization_webhook_deliveries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_certificate_permissions TO authenticated;

-- API credential and webhook endpoint secrets are intentionally service-only.
REVOKE ALL ON public.organization_api_credentials FROM anon, authenticated;
REVOKE ALL ON public.organization_webhook_endpoints FROM anon, authenticated;

ALTER TABLE public.organization_trusted_networks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_security_alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_session_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_communication_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_sender_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_api_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_certificate_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_security_read_networks" ON public.organization_trusted_networks;
CREATE POLICY "org_security_read_networks" ON public.organization_trusted_networks
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'security.read'));
DROP POLICY IF EXISTS "org_security_manage_networks" ON public.organization_trusted_networks;
CREATE POLICY "org_security_manage_networks" ON public.organization_trusted_networks
  FOR ALL TO authenticated USING (public.has_organization_permission(workspace_id, 'security.manage'))
  WITH CHECK (public.has_organization_permission(workspace_id, 'security.manage'));

DROP POLICY IF EXISTS "org_security_read_alerts" ON public.organization_security_alert_rules;
CREATE POLICY "org_security_read_alerts" ON public.organization_security_alert_rules
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'security.read'));
DROP POLICY IF EXISTS "org_security_manage_alerts" ON public.organization_security_alert_rules;
CREATE POLICY "org_security_manage_alerts" ON public.organization_security_alert_rules
  FOR ALL TO authenticated USING (public.has_organization_permission(workspace_id, 'security.manage'))
  WITH CHECK (public.has_organization_permission(workspace_id, 'security.manage'));

DROP POLICY IF EXISTS "org_security_read_revocations" ON public.organization_session_revocations;
CREATE POLICY "org_security_read_revocations" ON public.organization_session_revocations
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'security.read'));

DROP POLICY IF EXISTS "org_branding_read_templates" ON public.organization_communication_templates;
CREATE POLICY "org_branding_read_templates" ON public.organization_communication_templates
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'branding.read'));
DROP POLICY IF EXISTS "org_branding_manage_templates" ON public.organization_communication_templates;
CREATE POLICY "org_branding_manage_templates" ON public.organization_communication_templates
  FOR ALL TO authenticated USING (public.has_organization_permission(workspace_id, 'branding.manage'))
  WITH CHECK (public.has_organization_permission(workspace_id, 'branding.manage'));

DROP POLICY IF EXISTS "org_branding_read_domains" ON public.organization_sender_domains;
CREATE POLICY "org_branding_read_domains" ON public.organization_sender_domains
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'branding.read'));
DROP POLICY IF EXISTS "org_branding_manage_domains" ON public.organization_sender_domains;
CREATE POLICY "org_branding_manage_domains" ON public.organization_sender_domains
  FOR ALL TO authenticated USING (public.has_organization_permission(workspace_id, 'branding.manage'))
  WITH CHECK (public.has_organization_permission(workspace_id, 'branding.manage'));

DROP POLICY IF EXISTS "org_integrations_read_deliveries" ON public.organization_webhook_deliveries;
CREATE POLICY "org_integrations_read_deliveries" ON public.organization_webhook_deliveries
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'integrations.read'));

DROP POLICY IF EXISTS "org_certificates_read_permissions" ON public.organization_certificate_permissions;
CREATE POLICY "org_certificates_read_permissions" ON public.organization_certificate_permissions
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'certificates.read'));
DROP POLICY IF EXISTS "org_certificates_manage_permissions" ON public.organization_certificate_permissions;
CREATE POLICY "org_certificates_manage_permissions" ON public.organization_certificate_permissions
  FOR ALL TO authenticated USING (public.has_organization_permission(workspace_id, 'certificates.manage'))
  WITH CHECK (public.has_organization_permission(workspace_id, 'certificates.manage'));

-- Service-role policies are explicit to make the intended trust boundary clear.
DROP POLICY IF EXISTS "service_manage_org_api_credentials" ON public.organization_api_credentials;
CREATE POLICY "service_manage_org_api_credentials" ON public.organization_api_credentials
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS "service_manage_org_webhooks" ON public.organization_webhook_endpoints;
CREATE POLICY "service_manage_org_webhooks" ON public.organization_webhook_endpoints
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

COMMENT ON TABLE public.organization_api_credentials IS
  'Organization API credentials. Only a SHA-256 hash and public prefix are stored.';
COMMENT ON TABLE public.organization_webhook_endpoints IS
  'Webhook endpoints. Signing secrets are encrypted server-side and never selected by authenticated clients.';
COMMENT ON COLUMN public.organization_certificates.key_reference IS
  'Opaque reference to KMS/HSM/external custody. Never contains private key material.';
