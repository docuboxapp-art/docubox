-- Native RLS and Colabora must agree on suspended, expired and disabled access.
-- This does not create or modify a subscription or entitlement.
CREATE OR REPLACE FUNCTION public.get_user_workspace_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT m.workspace_id FROM public.workspace_members m JOIN public.workspaces w ON w.id=m.workspace_id
 WHERE m.user_id=(SELECT auth.uid()) AND m.status='active'
 AND (m.access_expires_at IS NULL OR m.access_expires_at>CURRENT_TIMESTAMP)
 AND (w.workspace_type<>'business' OR coalesce(w.organization_enabled,true))
$$;
REVOKE ALL ON FUNCTION public.get_user_workspace_ids() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_user_workspace_ids() TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.has_collaboration_entitlement(
  ws_id UUID,
  requested_entitlement TEXT DEFAULT 'collaboration_core',
  require_write BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces w
    JOIN public.workspace_members wm
      ON wm.workspace_id = w.id
     AND wm.user_id = auth.uid()
     AND wm.status = 'active'
     AND (wm.access_expires_at IS NULL OR wm.access_expires_at > CURRENT_TIMESTAMP)
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
SET search_path = ''
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

  IF v_membership.status IS DISTINCT FROM 'active' OR v_membership.access_expires_at <= CURRENT_TIMESTAMP THEN
    RETURN jsonb_build_object('eligible', v_workspace.workspace_type='business' AND COALESCE(v_workspace.organization_enabled,TRUE),
      'accessible',FALSE,'write_allowed',FALSE,'membership_status',CASE WHEN v_membership.access_expires_at<=CURRENT_TIMESTAMP THEN 'expired' ELSE v_membership.status END,
      'code',CASE WHEN v_membership.access_expires_at<=CURRENT_TIMESTAMP THEN 'MEMBERSHIP_EXPIRED' ELSE 'MEMBERSHIP_INACTIVE' END);
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
REVOKE ALL ON FUNCTION public.has_collaboration_entitlement(uuid,text,boolean),public.get_my_collaboration_access(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.has_collaboration_entitlement(uuid,text,boolean),public.get_my_collaboration_access(uuid) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
