-- =============================================================================
-- MIGRACIÓN: fix_subscriptions_and_listar_debug
-- 1. Asigna plan gratuito a todos los usuarios que no tienen suscripción activa
-- 2. Asegura que todos los usuarios tengan workspace personal
-- 3. Asigna workspace_id a documentos sin workspace
-- =============================================================================

-- ── 1. Asignar plan gratuito a usuarios sin suscripción activa ────────────────
DO $$
DECLARE
  rec RECORD;
  v_plan_id UUID;
  v_workspace_id UUID;
  v_subscription_id UUID;
  v_period_end TIMESTAMPTZ;
BEGIN
  -- Obtener el plan gratuito
  SELECT id INTO v_plan_id
  FROM public.subscription_plans
  WHERE slug = 'free'
  LIMIT 1;

  -- Si no existe el plan gratuito, crearlo
  IF v_plan_id IS NULL THEN
    INSERT INTO public.subscription_plans (
      id, name, slug, description, price, interval,
      documents_included, features, is_active
    )
    VALUES (
      gen_random_uuid(),
      'Plan Gratuito',
      'free',
      'Plan gratuito con 2 documentos incluidos. Renovacion mensual automatica.',
      0.00,
      'monthly'::public.subscription_interval,
      2,
      '["2 documentos por mes", "Firma electronica basica", "Historial de documentos", "Soporte por email"]'::jsonb,
      true
    )
    ON CONFLICT (slug) DO UPDATE
      SET updated_at = CURRENT_TIMESTAMP
    RETURNING id INTO v_plan_id;
  END IF;

  v_period_end := CURRENT_TIMESTAMP + INTERVAL '1 month';

  -- Iterar sobre usuarios sin suscripción activa
  FOR rec IN
    SELECT up.id, up.email
    FROM public.user_profiles up
    WHERE NOT EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.user_id = up.id AND s.status = 'active'
    )
  LOOP
    -- Obtener workspace personal del usuario
    SELECT w.id INTO v_workspace_id
    FROM public.workspaces w
    INNER JOIN public.workspace_members wm ON wm.workspace_id = w.id
    WHERE wm.user_id = rec.id
      AND w.workspace_type = 'personal'
    ORDER BY w.created_at ASC
    LIMIT 1;

    -- Si no tiene workspace personal, crearlo
    IF v_workspace_id IS NULL THEN
      v_workspace_id := gen_random_uuid();
      INSERT INTO public.workspaces (id, name, workspace_type, owner_id, description, created_at, updated_at)
      VALUES (
        v_workspace_id,
        COALESCE(
          (SELECT full_name FROM public.user_profiles WHERE id = rec.id LIMIT 1),
          split_part(rec.email, '@', 1)
        ) || ' Workspace',
        'personal'::public.workspace_type,
        rec.id,
        'Espacio de trabajo personal',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.workspace_members (id, workspace_id, user_id, role, joined_at)
      VALUES (
        gen_random_uuid(),
        v_workspace_id,
        rec.id,
        'owner'::public.workspace_member_role,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT (workspace_id, user_id) DO NOTHING;

      RAISE NOTICE 'Workspace personal creado para usuario % (workspace_id: %)', rec.email, v_workspace_id;
    END IF;

    -- Crear suscripción gratuita
    INSERT INTO public.subscriptions (
      id, user_id, plan_id, workspace_id, status,
      documents_used, documents_limit,
      current_period_start, current_period_end
    )
    VALUES (
      gen_random_uuid(),
      rec.id,
      v_plan_id,
      v_workspace_id,
      'active'::public.subscription_status,
      0,
      2,
      CURRENT_TIMESTAMP,
      v_period_end
    )
    RETURNING id INTO v_subscription_id;

    -- Registrar en historial
    INSERT INTO public.subscription_history (
      user_id, subscription_id, plan_id, plan_name,
      amount, interval, event_type,
      period_start, period_end, notes
    )
    VALUES (
      rec.id,
      v_subscription_id,
      v_plan_id,
      'Plan Gratuito',
      0.00,
      'monthly'::public.subscription_interval,
      'created',
      CURRENT_TIMESTAMP,
      v_period_end,
      'Plan gratuito asignado automaticamente a usuario existente.'
    );

    RAISE NOTICE 'Suscripcion gratuita creada para usuario % (subscription_id: %)', rec.email, v_subscription_id;
  END LOOP;

EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error asignando suscripciones: %', SQLERRM;
END $$;

-- ── 2. Asignar workspace_id a documentos que no lo tienen ─────────────────────
DO $$
DECLARE
  docs_fixed INTEGER := 0;
BEGIN
  UPDATE public.documentos d
  SET workspace_id = (
    SELECT w.id
    FROM public.workspaces w
    INNER JOIN public.workspace_members wm ON wm.workspace_id = w.id
    WHERE wm.user_id = d.owner_id
      AND w.workspace_type = 'personal'
    ORDER BY w.created_at ASC
    LIMIT 1
  )
  WHERE d.workspace_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.workspace_members wm2
      WHERE wm2.user_id = d.owner_id
    );

  GET DIAGNOSTICS docs_fixed = ROW_COUNT;
  RAISE NOTICE 'Documentos actualizados con workspace_id: %', docs_fixed;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error asignando workspace_id a documentos: %', SQLERRM;
END $$;

-- ── 3. Crear función de diagnóstico para verificar estado de usuarios ──────────
CREATE OR REPLACE FUNCTION public.diagnostico_usuarios()
RETURNS TABLE(
  user_id UUID,
  email TEXT,
  tiene_workspace BOOLEAN,
  tiene_suscripcion_activa BOOLEAN,
  documentos_count BIGINT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    up.id AS user_id,
    up.email,
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.user_id = up.id
    ) AS tiene_workspace,
    EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.user_id = up.id AND s.status = 'active'
    ) AS tiene_suscripcion_activa,
    (
      SELECT COUNT(*) FROM public.documentos d
      WHERE d.owner_id = up.id AND d.deleted_at IS NULL
    ) AS documentos_count
  FROM public.user_profiles up
  ORDER BY up.email;
$$;
