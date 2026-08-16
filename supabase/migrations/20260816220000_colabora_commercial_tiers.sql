-- Align Docubox Colabora and Colabora Pro with the canonical commercial matrix.
-- Additive and non-destructive: Pro data is retained when access is suspended.

ALTER TABLE public.organization_entitlements
  ADD COLUMN IF NOT EXISTS access_level TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organization_entitlements_access_level_check'
  ) THEN
    ALTER TABLE public.organization_entitlements
      ADD CONSTRAINT organization_entitlements_access_level_check
      CHECK (access_level IS NULL OR access_level IN ('enabled', 'basic', 'advanced'));
  END IF;
END $$;

UPDATE public.addon_products
SET entitlement_keys = ARRAY[
      'collaboration_core',
      'collaboration_advanced_reviews',
      'collaboration_analytics'
    ],
    default_limits = '{"active_internal_users":10,"active_spaces":25,"external_guests":0,"external_rooms":0,"data_rooms":0,"storage_bytes":10737418240,"comparisons":50,"automation_runs":0,"ai_requests":0}'::JSONB,
    metadata = metadata || '{"commercial_tier":"standard","analytics_level":"basic"}'::JSONB,
    updated_at = CURRENT_TIMESTAMP
WHERE product_key = 'docubox_colabora';

UPDATE public.addon_products
SET entitlement_keys = ARRAY[
      'collaboration_core',
      'collaboration_advanced_reviews',
      'collaboration_external_rooms',
      'collaboration_data_rooms',
      'collaboration_advanced_workflows',
      'collaboration_automations',
      'collaboration_analytics',
      'collaboration_ai_assistant'
    ],
    default_limits = '{"active_internal_users":25,"active_spaces":100,"external_guests":100,"external_rooms":25,"data_rooms":10,"storage_bytes":53687091200,"comparisons":500,"automation_runs":10000,"ai_requests":500}'::JSONB,
    metadata = metadata || '{"commercial_tier":"pro","analytics_level":"advanced"}'::JSONB,
    updated_at = CURRENT_TIMESTAMP
WHERE product_key = 'docubox_colabora_pro';

CREATE OR REPLACE FUNCTION public.set_collaboration_entitlement_level()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_key TEXT;
BEGIN
  IF NEW.addon_subscription_id IS NOT NULL THEN
    SELECT ap.product_key INTO v_product_key
    FROM public.organization_addon_subscriptions oas
    JOIN public.addon_products ap ON ap.id = oas.product_id
    WHERE oas.id = NEW.addon_subscription_id;
  END IF;

  NEW.access_level := CASE
    WHEN NEW.entitlement_key = 'collaboration_analytics' AND v_product_key = 'docubox_colabora_pro'
      THEN 'advanced'
    WHEN NEW.entitlement_key = 'collaboration_analytics'
      THEN 'basic'
    ELSE 'enabled'
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organization_entitlements_set_level
  ON public.organization_entitlements;
CREATE TRIGGER organization_entitlements_set_level
BEFORE INSERT OR UPDATE OF entitlement_key, addon_subscription_id
ON public.organization_entitlements
FOR EACH ROW EXECUTE FUNCTION public.set_collaboration_entitlement_level();

UPDATE public.organization_entitlements oe
SET access_level = CASE
  WHEN oe.entitlement_key = 'collaboration_analytics'
    AND ap.product_key = 'docubox_colabora_pro' THEN 'advanced'
  WHEN oe.entitlement_key = 'collaboration_analytics' THEN 'basic'
  ELSE 'enabled'
END,
updated_at = CURRENT_TIMESTAMP
FROM public.organization_addon_subscriptions oas
JOIN public.addon_products ap ON ap.id = oas.product_id
WHERE oas.id = oe.addon_subscription_id;

UPDATE public.organization_entitlements
SET access_level = CASE
  WHEN entitlement_key = 'collaboration_analytics' THEN COALESCE(access_level, 'basic')
  ELSE COALESCE(access_level, 'enabled')
END
WHERE access_level IS NULL;

CREATE OR REPLACE FUNCTION public.enforce_single_collaboration_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product public.addon_products%ROWTYPE;
  v_key TEXT;
  v_pro_keys CONSTANT TEXT[] := ARRAY[
    'collaboration_external_rooms',
    'collaboration_data_rooms',
    'collaboration_advanced_workflows',
    'collaboration_automations',
    'collaboration_ai_assistant'
  ];
BEGIN
  IF NEW.status NOT IN ('trialing', 'active', 'past_due') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_product FROM public.addon_products WHERE id = NEW.product_id;
  IF v_product.product_key NOT IN ('docubox_colabora', 'docubox_colabora_pro') THEN
    RETURN NEW;
  END IF;

  UPDATE public.organization_addon_subscriptions other
  SET status = 'cancelled',
      cancelled_at = COALESCE(other.cancelled_at, CURRENT_TIMESTAMP),
      read_only_at = COALESCE(other.read_only_at, CURRENT_TIMESTAMP),
      metadata = other.metadata || jsonb_build_object(
        'superseded_by_product', v_product.product_key,
        'superseded_at', CURRENT_TIMESTAMP
      ),
      updated_at = CURRENT_TIMESTAMP
  FROM public.addon_products other_product
  WHERE other.product_id = other_product.id
    AND other.workspace_id = NEW.workspace_id
    AND other.id <> NEW.id
    AND other_product.product_key IN ('docubox_colabora', 'docubox_colabora_pro')
    AND other.status IN ('trialing', 'active', 'past_due');

  IF v_product.product_key = 'docubox_colabora' THEN
    FOREACH v_key IN ARRAY v_pro_keys LOOP
      UPDATE public.organization_entitlements
      SET status = 'suspended',
          read_only_at = COALESCE(read_only_at, CURRENT_TIMESTAMP),
          ends_at = COALESCE(ends_at, CURRENT_TIMESTAMP),
          metadata = metadata || jsonb_build_object(
            'suspended_by_downgrade', TRUE,
            'suspended_at', CURRENT_TIMESTAMP
          ),
          updated_at = CURRENT_TIMESTAMP
      WHERE workspace_id = NEW.workspace_id
        AND entitlement_key = v_key
        AND status <> 'inactive';
    END LOOP;

    UPDATE public.collaboration_automations
    SET status = 'paused', updated_at = CURRENT_TIMESTAMP
    WHERE workspace_id = NEW.workspace_id AND status = 'active';

    UPDATE public.collaboration_external_sessions
    SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
    WHERE workspace_id = NEW.workspace_id AND revoked_at IS NULL;

    UPDATE public.collaboration_room_guests
    SET status = 'revoked',
        revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
    WHERE workspace_id = NEW.workspace_id
      AND status IN ('pending', 'active');

    UPDATE public.collaboration_rooms
    SET status = 'closed',
        closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
    WHERE workspace_id = NEW.workspace_id
      AND status IN ('draft', 'active');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organization_addons_single_collaboration_plan
  ON public.organization_addon_subscriptions;
CREATE TRIGGER organization_addons_single_collaboration_plan
AFTER INSERT OR UPDATE OF status
ON public.organization_addon_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.enforce_single_collaboration_plan();

-- Resolve legacy dual-active rows in favor of Pro without deleting either subscription.
UPDATE public.organization_addon_subscriptions standard_subscription
SET status = 'cancelled',
    cancelled_at = COALESCE(standard_subscription.cancelled_at, CURRENT_TIMESTAMP),
    read_only_at = COALESCE(standard_subscription.read_only_at, CURRENT_TIMESTAMP),
    metadata = standard_subscription.metadata || '{"superseded_by_product":"docubox_colabora_pro","commercial_reconciliation":true}'::JSONB,
    updated_at = CURRENT_TIMESTAMP
FROM public.addon_products standard_product
WHERE standard_subscription.product_id = standard_product.id
  AND standard_product.product_key = 'docubox_colabora'
  AND standard_subscription.status IN ('trialing', 'active', 'past_due')
  AND EXISTS (
    SELECT 1
    FROM public.organization_addon_subscriptions pro_subscription
    JOIN public.addon_products pro_product ON pro_product.id = pro_subscription.product_id
    WHERE pro_subscription.workspace_id = standard_subscription.workspace_id
      AND pro_product.product_key = 'docubox_colabora_pro'
      AND pro_subscription.status IN ('trialing', 'active', 'past_due')
  );

-- Reconcile existing standard subscriptions that inherited Pro workflows from the first bundle.
UPDATE public.organization_entitlements oe
SET status = 'suspended',
    read_only_at = COALESCE(oe.read_only_at, CURRENT_TIMESTAMP),
    ends_at = COALESCE(oe.ends_at, CURRENT_TIMESTAMP),
    metadata = oe.metadata || '{"suspended_by_commercial_reconciliation":true}'::JSONB,
    updated_at = CURRENT_TIMESTAMP
FROM public.organization_addon_subscriptions oas
JOIN public.addon_products ap ON ap.id = oas.product_id
WHERE oe.workspace_id = oas.workspace_id
  AND ap.product_key = 'docubox_colabora'
  AND oas.status IN ('trialing', 'active', 'past_due')
  AND oe.entitlement_key IN (
    'collaboration_external_rooms',
    'collaboration_data_rooms',
    'collaboration_advanced_workflows',
    'collaboration_automations',
    'collaboration_ai_assistant'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.organization_addon_subscriptions pro_subscription
    JOIN public.addon_products pro_product ON pro_product.id = pro_subscription.product_id
    WHERE pro_subscription.workspace_id = oe.workspace_id
      AND pro_product.product_key = 'docubox_colabora_pro'
      AND pro_subscription.status IN ('trialing', 'active', 'past_due')
  );

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
  v_product_key TEXT;
  v_entitlements JSONB;
  v_permissions JSONB;
  v_write_allowed BOOLEAN := FALSE;
  v_tier TEXT := 'none';
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
  WHERE oas.workspace_id = ws_id
    AND ap.product_key IN ('docubox_colabora', 'docubox_colabora_pro')
  ORDER BY
    CASE oas.status WHEN 'active' THEN 1 WHEN 'trialing' THEN 2 WHEN 'past_due' THEN 3 ELSE 4 END,
    CASE ap.product_key WHEN 'docubox_colabora_pro' THEN 1 ELSE 2 END
  LIMIT 1;
  IF v_subscription.id IS NOT NULL THEN
    SELECT product_key INTO v_product_key
    FROM public.addon_products
    WHERE id = v_subscription.product_id;
  END IF;

  SELECT COALESCE(jsonb_object_agg(entitlement_key, jsonb_build_object(
    'status', status,
    'limits', limits,
    'ends_at', ends_at,
    'read_only_at', read_only_at,
    'access_level', access_level
  )), '{}'::JSONB)
  INTO v_entitlements
  FROM public.organization_entitlements
  WHERE workspace_id = ws_id;

  SELECT COALESCE(jsonb_agg(permission_key), '[]'::JSONB)
  INTO v_permissions
  FROM public.get_my_organization_permissions(ws_id);

  v_write_allowed := public.has_collaboration_entitlement(ws_id, 'collaboration_core', TRUE);
  v_tier := CASE
    WHEN public.has_collaboration_entitlement(ws_id, 'collaboration_advanced_workflows', TRUE) THEN 'pro'
    WHEN public.has_collaboration_entitlement(ws_id, 'collaboration_core', FALSE) THEN 'standard'
    ELSE 'none'
  END;

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
    'product_key', v_product_key,
    'commercial_tier', v_tier,
    'can_manage_subscription', public.has_organization_permission(ws_id, 'subscription.manage_addons'),
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

CREATE OR REPLACE FUNCTION public.get_collaboration_usage_snapshot(ws_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.is_active_workspace_member(ws_id)
     OR NOT public.has_organization_permission(ws_id, 'reports.view') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'active_internal_users', (SELECT COUNT(*) FROM public.workspace_members WHERE workspace_id = ws_id AND status = 'active'),
    'active_spaces', (SELECT COUNT(*) FROM public.collaboration_spaces WHERE workspace_id = ws_id AND status = 'active'),
    'active_external_guests', (SELECT COUNT(*) FROM public.collaboration_room_guests WHERE workspace_id = ws_id AND status IN ('pending', 'active')),
    'external_rooms', (SELECT COUNT(*) FROM public.collaboration_rooms WHERE workspace_id = ws_id AND room_type <> 'data_room' AND status = 'active'),
    'data_rooms', (SELECT COUNT(*) FROM public.collaboration_rooms WHERE workspace_id = ws_id AND room_type = 'data_room' AND status = 'active'),
    'storage_bytes',
      COALESCE((SELECT SUM(file_size) FROM public.documentos WHERE workspace_id = ws_id), 0)
      + COALESCE((SELECT SUM(byte_size) FROM public.collaboration_request_files WHERE workspace_id = ws_id), 0),
    'comparisons', COALESCE((SELECT SUM(quantity) FROM public.collaboration_usage_events WHERE workspace_id = ws_id AND meter_key = 'comparisons' AND occurred_at >= date_trunc('month', CURRENT_TIMESTAMP)), 0),
    'automation_runs', COALESCE((SELECT SUM(quantity) FROM public.collaboration_usage_events WHERE workspace_id = ws_id AND meter_key = 'automation_runs' AND occurred_at >= date_trunc('month', CURRENT_TIMESTAMP)), 0),
    'ai_requests', COALESCE((SELECT SUM(quantity) FROM public.collaboration_usage_events WHERE workspace_id = ws_id AND meter_key = 'ai_requests' AND occurred_at >= date_trunc('month', CURRENT_TIMESTAMP)), 0),
    'generated_at', CURRENT_TIMESTAMP
  ) INTO v_result;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_collaboration_usage(
  ws_id UUID,
  requested_entitlement_key TEXT,
  requested_meter_key TEXT,
  requested_quantity NUMERIC,
  requested_idempotency_key TEXT,
  requested_resource_type TEXT DEFAULT NULL,
  requested_resource_id UUID DEFAULT NULL,
  requested_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id UUID;
  v_event_id UUID;
BEGIN
  IF ws_id IS NULL
     OR NULLIF(trim(requested_entitlement_key), '') IS NULL
     OR NULLIF(trim(requested_meter_key), '') IS NULL
     OR NULLIF(trim(requested_idempotency_key), '') IS NULL
     OR requested_quantity IS NULL
     OR requested_quantity <= 0 THEN
    RAISE EXCEPTION 'invalid_usage_event' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(ws_id::TEXT || ':' || requested_meter_key, 0)
  );

  SELECT id INTO v_existing_id
  FROM public.collaboration_usage_events
  WHERE workspace_id = ws_id
    AND meter_key = requested_meter_key
    AND idempotency_key = requested_idempotency_key;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('event_id', v_existing_id, 'created', FALSE);
  END IF;

  INSERT INTO public.collaboration_usage_events(
    workspace_id, entitlement_key, meter_key, quantity,
    idempotency_key, resource_type, resource_id, metadata
  ) VALUES (
    ws_id, requested_entitlement_key, requested_meter_key, requested_quantity,
    requested_idempotency_key, requested_resource_type, requested_resource_id,
    COALESCE(requested_metadata, '{}'::JSONB)
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object('event_id', v_event_id, 'created', TRUE);
END;
$$;

-- Pro tables require a currently writable Pro entitlement. Historical rows remain stored and can
-- only be exposed through an explicitly authorized export service after downgrade.
DROP POLICY IF EXISTS collab_rooms_read ON public.collaboration_rooms;
CREATE POLICY collab_rooms_read ON public.collaboration_rooms FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_external_rooms', TRUE) AND public.has_organization_permission(workspace_id, 'rooms.view'));
DROP POLICY IF EXISTS collab_room_guests_read ON public.collaboration_room_guests;
CREATE POLICY collab_room_guests_read ON public.collaboration_room_guests FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_external_rooms', TRUE) AND public.has_organization_permission(workspace_id, 'rooms.view'));
DROP POLICY IF EXISTS collab_room_resources_read ON public.collaboration_room_resources;
CREATE POLICY collab_room_resources_read ON public.collaboration_room_resources FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_external_rooms', TRUE) AND public.has_organization_permission(workspace_id, 'rooms.view'));
DROP POLICY IF EXISTS collab_external_events_read ON public.collaboration_external_events;
CREATE POLICY collab_external_events_read ON public.collaboration_external_events FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_external_rooms', TRUE) AND public.has_organization_permission(workspace_id, 'rooms.view'));
DROP POLICY IF EXISTS collab_automations_read ON public.collaboration_automations;
CREATE POLICY collab_automations_read ON public.collaboration_automations FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_automations', TRUE) AND public.has_organization_permission(workspace_id, 'automations.view'));
DROP POLICY IF EXISTS collab_automation_versions_read ON public.collaboration_automation_versions;
CREATE POLICY collab_automation_versions_read ON public.collaboration_automation_versions FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_automations', TRUE) AND public.has_organization_permission(workspace_id, 'automations.view'));
DROP POLICY IF EXISTS collab_automation_runs_read ON public.collaboration_automation_runs;
CREATE POLICY collab_automation_runs_read ON public.collaboration_automation_runs FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_automations', TRUE) AND public.has_organization_permission(workspace_id, 'automations.view'));
DROP POLICY IF EXISTS collab_negotiation_read ON public.collaboration_negotiation_items;
CREATE POLICY collab_negotiation_read ON public.collaboration_negotiation_items FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_advanced_workflows', TRUE) AND public.has_organization_permission(workspace_id, 'reviews.view'));
DROP POLICY IF EXISTS collab_committees_read ON public.collaboration_committees;
CREATE POLICY collab_committees_read ON public.collaboration_committees FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_advanced_workflows', TRUE) AND public.has_organization_permission(workspace_id, 'collaboration_spaces.view'));
DROP POLICY IF EXISTS collab_committee_votes_read ON public.collaboration_committee_votes;
CREATE POLICY collab_committee_votes_read ON public.collaboration_committee_votes FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_advanced_workflows', TRUE) AND public.has_organization_permission(workspace_id, 'collaboration_spaces.view'));
DROP POLICY IF EXISTS collab_closing_rooms_read ON public.collaboration_closing_rooms;
CREATE POLICY collab_closing_rooms_read ON public.collaboration_closing_rooms FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_advanced_workflows', TRUE) AND public.has_organization_permission(workspace_id, 'collaboration_spaces.view'));

REVOKE ALL ON FUNCTION public.set_collaboration_entitlement_level() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_single_collaboration_plan() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_collaboration_usage_snapshot(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_collaboration_usage_snapshot(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.record_collaboration_usage(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_collaboration_usage(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, UUID, JSONB)
  TO service_role;

COMMENT ON COLUMN public.organization_entitlements.access_level
  IS 'Semantic entitlement level. Analytics uses basic or advanced; boolean capabilities use enabled.';
COMMENT ON FUNCTION public.get_collaboration_usage_snapshot(UUID)
  IS 'Tenant-scoped usage snapshot for the canonical Colabora meters.';
COMMENT ON FUNCTION public.record_collaboration_usage(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, UUID, JSONB)
  IS 'Backend-only idempotent writer for billable Colabora usage events.';
