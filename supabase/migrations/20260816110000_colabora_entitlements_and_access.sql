-- Docubox Colabora: commercial entitlement and access boundary.
-- Additive migration. It reuses workspaces, memberships, plans, permissions and audit.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.addon_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'disabled', 'retired')),
  price_monthly NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'MXN',
  trial_days INTEGER NOT NULL DEFAULT 14 CHECK (trial_days BETWEEN 0 AND 90),
  included_users INTEGER,
  default_limits JSONB NOT NULL DEFAULT '{}'::JSONB,
  entitlement_keys TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO public.addon_products (
  product_key, name, description, price_monthly, trial_days, included_users,
  default_limits, entitlement_keys
) VALUES
  (
    'docubox_colabora', 'Docubox Colabora',
    'Tareas, revisiones, espacios, calendario y solicitudes documentales.',
    0, 14, 10,
    '{"active_spaces":25,"external_guests":0,"storage_bytes":10737418240,"comparisons":50}'::JSONB,
    ARRAY[
      'collaboration_core', 'collaboration_advanced_reviews',
      'collaboration_advanced_workflows', 'collaboration_analytics'
    ]
  ),
  (
    'docubox_colabora_pro', 'Docubox Colabora Pro',
    'Salas externas, data rooms, automatizaciones y analitica avanzada.',
    0, 14, 25,
    '{"active_spaces":100,"external_guests":100,"external_rooms":25,"storage_bytes":53687091200,"comparisons":500,"automation_runs":10000,"ai_requests":500}'::JSONB,
    ARRAY[
      'collaboration_core', 'collaboration_advanced_reviews',
      'collaboration_external_rooms', 'collaboration_data_rooms',
      'collaboration_advanced_workflows', 'collaboration_automations',
      'collaboration_analytics', 'collaboration_ai_assistant'
    ]
  )
ON CONFLICT (product_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  entitlement_keys = EXCLUDED.entitlement_keys,
  default_limits = EXCLUDED.default_limits,
  updated_at = CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS public.organization_addon_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.addon_products(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','pending','trialing','active','past_due','suspended','cancelled','expired')),
  billing_interval TEXT NOT NULL DEFAULT 'monthly'
    CHECK (billing_interval IN ('monthly','yearly')),
  provider TEXT,
  provider_customer_reference TEXT,
  provider_subscription_reference TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  trial_started_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  read_only_at TIMESTAMPTZ,
  idempotency_key UUID NOT NULL,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, product_id),
  UNIQUE (workspace_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.organization_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entitlement_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'inactive'
    CHECK (status IN ('inactive','trialing','active','past_due','suspended','cancelled','expired')),
  source TEXT NOT NULL DEFAULT 'addon'
    CHECK (source IN ('plan','addon','trial','grant','migration')),
  addon_subscription_id UUID REFERENCES public.organization_addon_subscriptions(id) ON DELETE SET NULL,
  limits JSONB NOT NULL DEFAULT '{}'::JSONB,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  read_only_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, entitlement_key)
);

CREATE TABLE IF NOT EXISTS public.collaboration_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','configured','read_only','disabled')),
  primary_admin_member_id UUID REFERENCES public.workspace_members(id) ON DELETE SET NULL,
  backup_admin_member_id UUID REFERENCES public.workspace_members(id) ON DELETE SET NULL,
  default_comment_visibility TEXT NOT NULL DEFAULT 'internal'
    CHECK (default_comment_visibility IN ('private','internal','shared','formal')),
  allow_external_comments BOOLEAN NOT NULL DEFAULT false,
  allow_external_downloads BOOLEAN NOT NULL DEFAULT false,
  watermark_external_files BOOLEAN NOT NULL DEFAULT true,
  default_due_days INTEGER NOT NULL DEFAULT 5 CHECK (default_due_days BETWEEN 1 AND 365),
  default_sla_hours INTEGER NOT NULL DEFAULT 72 CHECK (default_sla_hours BETWEEN 1 AND 8760),
  reminder_hours INTEGER[] NOT NULL DEFAULT ARRAY[72,24],
  retention_days INTEGER NOT NULL DEFAULT 2555 CHECK (retention_days BETWEEN 30 AND 36500),
  timezone TEXT NOT NULL DEFAULT 'America/Mexico_City',
  notification_preferences JSONB NOT NULL DEFAULT '{"in_app":true,"email":true,"daily_digest":false,"push":false}'::JSONB,
  quiet_hours JSONB NOT NULL DEFAULT '{}'::JSONB,
  enabled_unit_ids UUID[] NOT NULL DEFAULT '{}',
  onboarding_completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.collaboration_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entitlement_key TEXT NOT NULL,
  meter_key TEXT NOT NULL,
  quantity NUMERIC(18,4) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  idempotency_key TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  UNIQUE (workspace_id, meter_key, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_org_addons_workspace_status
  ON public.organization_addon_subscriptions(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_org_entitlements_workspace_status
  ON public.organization_entitlements(workspace_id, status, entitlement_key);
CREATE INDEX IF NOT EXISTS idx_collaboration_usage_workspace_meter
  ON public.collaboration_usage_events(workspace_id, meter_key, occurred_at DESC);

INSERT INTO public.organization_permissions(permission_key, name, description, category)
VALUES
  ('subscription.manage_addons', 'Administrar complementos', 'Contratar, probar o cancelar complementos.', 'Facturacion'),
  ('collaboration.view_dashboard', 'Ver Colabora', 'Acceder al centro de trabajo colaborativo.', 'Colabora'),
  ('collaboration.manage_settings', 'Configurar Colabora', 'Administrar valores operativos del complemento.', 'Colabora'),
  ('tasks.view', 'Ver tareas colaborativas', 'Consultar tareas dentro de su alcance.', 'Colabora'),
  ('tasks.create', 'Crear tareas colaborativas', 'Crear tareas relacionadas con recursos autorizados.', 'Colabora'),
  ('tasks.assign', 'Asignar tareas', 'Asignar responsables y colaboradores.', 'Colabora'),
  ('tasks.edit', 'Editar tareas', 'Modificar tareas dentro de su alcance.', 'Colabora'),
  ('tasks.complete', 'Completar tareas', 'Completar tareas no bloqueadas.', 'Colabora'),
  ('tasks.cancel', 'Cancelar tareas', 'Cancelar tareas con motivo.', 'Colabora'),
  ('reviews.view', 'Ver revisiones', 'Consultar rondas y comentarios autorizados.', 'Colabora'),
  ('reviews.create', 'Crear revisiones', 'Abrir rondas sobre versiones documentales.', 'Colabora'),
  ('reviews.comment', 'Comentar revisiones', 'Crear comentarios segun audiencia autorizada.', 'Colabora'),
  ('reviews.resolve_comments', 'Resolver comentarios', 'Resolver o reabrir comentarios.', 'Colabora'),
  ('reviews.request_changes', 'Solicitar cambios', 'Solicitar una nueva version.', 'Colabora'),
  ('reviews.approve', 'Aprobar revisiones', 'Aprobar versiones sin comentarios bloqueantes.', 'Colabora'),
  ('versions.view', 'Ver versiones', 'Consultar versiones documentales.', 'Colabora'),
  ('versions.compare', 'Comparar versiones', 'Ejecutar comparaciones medibles.', 'Colabora'),
  ('versions.restore', 'Restaurar versiones', 'Restaurar como una nueva version.', 'Colabora'),
  ('collaboration_spaces.view', 'Ver espacios', 'Consultar espacios autorizados.', 'Colabora'),
  ('collaboration_spaces.create', 'Crear espacios', 'Crear espacios colaborativos.', 'Colabora'),
  ('collaboration_spaces.manage_members', 'Administrar miembros de espacios', 'Gestionar acceso sin ampliar permisos superiores.', 'Colabora'),
  ('collaboration_spaces.archive', 'Archivar espacios', 'Cerrar o archivar espacios.', 'Colabora'),
  ('requests.view', 'Ver solicitudes', 'Consultar solicitudes documentales.', 'Colabora'),
  ('requests.create', 'Crear solicitudes', 'Solicitar documentos y formularios.', 'Colabora'),
  ('requests.review_items', 'Revisar solicitudes', 'Aprobar, rechazar o pedir reemplazo.', 'Colabora'),
  ('rooms.view', 'Ver salas', 'Consultar salas externas autorizadas.', 'Colabora'),
  ('rooms.create', 'Crear salas', 'Crear salas para contrapartes.', 'Colabora'),
  ('rooms.manage_guests', 'Administrar invitados', 'Invitar, revocar y controlar sesiones externas.', 'Colabora'),
  ('rooms.manage_security', 'Administrar seguridad de salas', 'Configurar OTP, descargas y marca de agua.', 'Colabora'),
  ('automations.view', 'Ver automatizaciones', 'Consultar reglas y ejecuciones.', 'Colabora'),
  ('automations.manage', 'Administrar automatizaciones', 'Crear y publicar reglas versionadas.', 'Colabora'),
  ('reports.view', 'Ver reportes colaborativos', 'Consultar indicadores agregados.', 'Colabora'),
  ('reports.export', 'Exportar reportes colaborativos', 'Exportar solo filas autorizadas.', 'Colabora')
ON CONFLICT (permission_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category;

CREATE OR REPLACE FUNCTION public.has_collaboration_entitlement(
  ws_id UUID,
  requested_entitlement TEXT DEFAULT 'collaboration_core',
  require_write BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces w
    JOIN public.workspace_members wm
      ON wm.workspace_id = w.id
     AND wm.user_id = auth.uid()
     AND wm.status = 'active'
    JOIN public.organization_entitlements oe
      ON oe.workspace_id = w.id
     AND oe.entitlement_key = requested_entitlement
    WHERE w.id = ws_id
      AND w.workspace_type = 'business'
      AND COALESCE(w.organization_enabled, TRUE)
      AND oe.status IN ('trialing','active','past_due','suspended','cancelled','expired')
      AND (oe.starts_at IS NULL OR oe.starts_at <= CURRENT_TIMESTAMP)
      AND (
        NOT require_write
        OR (
          oe.status IN ('trialing','active','past_due')
          AND oe.read_only_at IS NULL
          AND (oe.ends_at IS NULL OR oe.ends_at > CURRENT_TIMESTAMP)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_collaboration_access(ws_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace public.workspaces%ROWTYPE;
  v_membership public.workspace_members%ROWTYPE;
  v_subscription public.organization_addon_subscriptions%ROWTYPE;
  v_entitlements JSONB;
  v_permissions JSONB;
  v_write_allowed BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_workspace FROM public.workspaces WHERE id = ws_id;
  SELECT * INTO v_membership FROM public.workspace_members
    WHERE workspace_id = ws_id AND user_id = auth.uid() LIMIT 1;

  IF v_workspace.id IS NULL OR v_membership.id IS NULL THEN
    RETURN jsonb_build_object('eligible', FALSE, 'accessible', FALSE, 'code', 'NOT_A_MEMBER');
  END IF;

  SELECT oas.* INTO v_subscription
  FROM public.organization_addon_subscriptions oas
  JOIN public.addon_products ap ON ap.id = oas.product_id
  WHERE oas.workspace_id = ws_id AND ap.product_key IN ('docubox_colabora','docubox_colabora_pro')
  ORDER BY CASE oas.status WHEN 'active' THEN 1 WHEN 'trialing' THEN 2 ELSE 3 END
  LIMIT 1;

  SELECT COALESCE(jsonb_object_agg(entitlement_key, jsonb_build_object(
    'status', status, 'limits', limits, 'ends_at', ends_at, 'read_only_at', read_only_at
  )), '{}'::JSONB)
  INTO v_entitlements
  FROM public.organization_entitlements
  WHERE workspace_id = ws_id;

  SELECT COALESCE(jsonb_agg(permission_key), '[]'::JSONB)
  INTO v_permissions
  FROM public.get_my_organization_permissions(ws_id);

  v_write_allowed := public.has_collaboration_entitlement(ws_id, 'collaboration_core', TRUE);

  RETURN jsonb_build_object(
    'eligible', v_workspace.workspace_type = 'business' AND COALESCE(v_workspace.organization_enabled, TRUE),
    'accessible', public.has_collaboration_entitlement(ws_id, 'collaboration_core', FALSE),
    'write_allowed', v_write_allowed,
    'workspace_status', CASE WHEN COALESCE(v_workspace.organization_enabled, TRUE) THEN 'active' ELSE 'suspended' END,
    'membership_status', v_membership.status,
    'membership_role', v_membership.role,
    'subscription_status', COALESCE(v_subscription.status, 'available'),
    'trial_ends_at', v_subscription.trial_ends_at,
    'current_period_end', v_subscription.current_period_end,
    'entitlements', v_entitlements,
    'permissions', v_permissions,
    'code', CASE
      WHEN v_workspace.workspace_type <> 'business' THEN 'ORGANIZATION_REQUIRED'
      WHEN v_membership.status <> 'active' THEN 'MEMBERSHIP_INACTIVE'
      WHEN NOT public.has_collaboration_entitlement(ws_id, 'collaboration_core', FALSE) THEN 'ADDON_REQUIRED'
      WHEN NOT v_write_allowed THEN 'READ_ONLY'
      ELSE 'OK'
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_collaboration_trial(
  ws_id UUID,
  requested_product_key TEXT,
  request_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product public.addon_products%ROWTYPE;
  v_subscription public.organization_addon_subscriptions%ROWTYPE;
  v_workspace public.workspaces%ROWTYPE;
  v_entitlement TEXT;
  v_trial_end TIMESTAMPTZ;
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'subscription.manage_addons') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_workspace FROM public.workspaces WHERE id = ws_id FOR UPDATE;
  IF v_workspace.id IS NULL OR v_workspace.workspace_type <> 'business' OR NOT COALESCE(v_workspace.organization_enabled, TRUE) THEN
    RAISE EXCEPTION 'organization_not_eligible' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_product FROM public.addon_products
    WHERE product_key = requested_product_key AND status = 'available';
  IF v_product.id IS NULL THEN RAISE EXCEPTION 'addon_not_available'; END IF;

  SELECT oas.* INTO v_subscription
  FROM public.organization_addon_subscriptions oas
  WHERE workspace_id = ws_id AND product_id = v_product.id;
  IF v_subscription.id IS NOT NULL AND v_subscription.status IN ('trialing','active','past_due') THEN
    RETURN jsonb_build_object('success', TRUE, 'idempotent', TRUE, 'subscription_id', v_subscription.id, 'status', v_subscription.status);
  END IF;
  IF v_subscription.id IS NOT NULL AND v_subscription.trial_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'trial_already_used' USING ERRCODE = '23514';
  END IF;

  v_trial_end := CURRENT_TIMESTAMP + make_interval(days => v_product.trial_days);
  INSERT INTO public.organization_addon_subscriptions(
    workspace_id, product_id, status, trial_started_at, trial_ends_at,
    current_period_start, current_period_end, idempotency_key, created_by
  ) VALUES (
    ws_id, v_product.id, 'trialing', CURRENT_TIMESTAMP, v_trial_end,
    CURRENT_TIMESTAMP, v_trial_end, request_key, auth.uid()
  )
  ON CONFLICT (workspace_id, product_id) DO UPDATE SET
    status = 'trialing', trial_started_at = CURRENT_TIMESTAMP, trial_ends_at = v_trial_end,
    current_period_start = CURRENT_TIMESTAMP, current_period_end = v_trial_end,
    idempotency_key = request_key, updated_at = CURRENT_TIMESTAMP
  RETURNING * INTO v_subscription;

  FOREACH v_entitlement IN ARRAY v_product.entitlement_keys LOOP
    INSERT INTO public.organization_entitlements(
      workspace_id, entitlement_key, status, source, addon_subscription_id,
      limits, starts_at, ends_at
    ) VALUES (
      ws_id, v_entitlement, 'trialing', 'trial', v_subscription.id,
      v_product.default_limits, CURRENT_TIMESTAMP, v_trial_end
    )
    ON CONFLICT (workspace_id, entitlement_key) DO UPDATE SET
      status = 'trialing', source = 'trial', addon_subscription_id = v_subscription.id,
      limits = EXCLUDED.limits, starts_at = CURRENT_TIMESTAMP, ends_at = v_trial_end,
      read_only_at = NULL, updated_at = CURRENT_TIMESTAMP;
  END LOOP;

  INSERT INTO public.collaboration_settings(workspace_id, created_by)
  VALUES (ws_id, auth.uid()) ON CONFLICT (workspace_id) DO NOTHING;

  INSERT INTO public.organization_audit_events(
    workspace_id, actor_user_id, event_type, resource_type, resource_id,
    summary, payload, outcome, severity, module
  ) VALUES (
    ws_id, auth.uid(), 'collaboration.trial.started', 'organization_addon_subscription', v_subscription.id::TEXT,
    'Prueba de Docubox Colabora iniciada',
    jsonb_build_object('product_key', requested_product_key, 'trial_ends_at', v_trial_end),
    'success', 'high', 'colabora'
  );

  RETURN jsonb_build_object('success', TRUE, 'idempotent', FALSE, 'subscription_id', v_subscription.id, 'status', 'trialing', 'trial_ends_at', v_trial_end);
END;
$$;

ALTER TABLE public.addon_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_addon_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS addon_products_authenticated_read ON public.addon_products;
CREATE POLICY addon_products_authenticated_read ON public.addon_products
  FOR SELECT TO authenticated USING (status = 'available');
DROP POLICY IF EXISTS org_addon_authorized_read ON public.organization_addon_subscriptions;
CREATE POLICY org_addon_authorized_read ON public.organization_addon_subscriptions
  FOR SELECT TO authenticated USING (
    public.is_active_workspace_member(workspace_id)
    AND public.has_organization_permission(workspace_id, 'billing.read')
  );
DROP POLICY IF EXISTS org_entitlements_member_read ON public.organization_entitlements;
CREATE POLICY org_entitlements_member_read ON public.organization_entitlements
  FOR SELECT TO authenticated USING (public.is_active_workspace_member(workspace_id));
DROP POLICY IF EXISTS collaboration_settings_member_read ON public.collaboration_settings;
CREATE POLICY collaboration_settings_member_read ON public.collaboration_settings
  FOR SELECT TO authenticated USING (
    public.has_collaboration_entitlement(workspace_id, 'collaboration_core', FALSE)
  );
DROP POLICY IF EXISTS collaboration_usage_authorized_read ON public.collaboration_usage_events;
CREATE POLICY collaboration_usage_authorized_read ON public.collaboration_usage_events
  FOR SELECT TO authenticated USING (
    public.has_collaboration_entitlement(workspace_id, 'collaboration_analytics', FALSE)
    AND public.has_organization_permission(workspace_id, 'reports.view')
  );

REVOKE INSERT, UPDATE, DELETE ON public.addon_products FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.organization_addon_subscriptions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.organization_entitlements FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.collaboration_settings FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.collaboration_usage_events FROM authenticated;

GRANT SELECT ON public.addon_products TO authenticated;
GRANT SELECT ON public.organization_addon_subscriptions TO authenticated;
GRANT SELECT ON public.organization_entitlements TO authenticated;
GRANT SELECT ON public.collaboration_settings TO authenticated;
GRANT SELECT ON public.collaboration_usage_events TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_collaboration_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_collaboration_trial(UUID, TEXT, UUID) TO authenticated;

COMMENT ON FUNCTION public.has_collaboration_entitlement(UUID, TEXT, BOOLEAN)
  IS 'Canonical tenant, membership and entitlement boundary for Docubox Colabora.';
