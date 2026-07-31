-- ============================================================
-- Migration: update_user_subscription function
-- Allows a user to change their active subscription plan.
-- Updates subscriptions table and records in subscription_history.
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_user_subscription(
    p_user_id UUID,
    p_new_plan_slug TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_new_plan_id UUID;
    v_new_plan_name TEXT;
    v_new_plan_price NUMERIC(10,2);
    v_new_plan_docs INTEGER;
    v_new_plan_interval public.subscription_interval;
    v_old_plan_name TEXT;
    v_old_plan_price NUMERIC(10,2);
    v_subscription_id UUID;
    v_old_plan_id UUID;
    v_event_type TEXT;
    v_period_end TIMESTAMPTZ;
BEGIN
    -- Fetch the new plan
    SELECT id, name, price, documents_included, interval
    INTO v_new_plan_id, v_new_plan_name, v_new_plan_price, v_new_plan_docs, v_new_plan_interval
    FROM public.subscription_plans
    WHERE slug = p_new_plan_slug AND is_active = true
    LIMIT 1;

    IF v_new_plan_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Plan not found: ' || p_new_plan_slug);
    END IF;

    -- Fetch current active subscription
    SELECT id, plan_id INTO v_subscription_id, v_old_plan_id
    FROM public.subscriptions
    WHERE user_id = p_user_id AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1;

    -- Fetch old plan info for history
    IF v_old_plan_id IS NOT NULL THEN
        SELECT name, price INTO v_old_plan_name, v_old_plan_price
        FROM public.subscription_plans
        WHERE id = v_old_plan_id;
    END IF;

    -- Determine event type
    IF v_old_plan_price IS NULL OR v_new_plan_price > v_old_plan_price THEN
        v_event_type := 'upgraded';
    ELSIF v_new_plan_price < v_old_plan_price THEN
        v_event_type := 'downgraded';
    ELSE
        v_event_type := 'changed';
    END IF;

    -- Calculate new period end (1 month from now)
    v_period_end := CURRENT_TIMESTAMP + INTERVAL '1 month';

    IF v_subscription_id IS NOT NULL THEN
        -- Update existing subscription
        UPDATE public.subscriptions
        SET
            plan_id = v_new_plan_id,
            documents_limit = v_new_plan_docs,
            documents_used = 0,
            current_period_start = CURRENT_TIMESTAMP,
            current_period_end = v_period_end,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = v_subscription_id;
    ELSE
        -- Create new subscription if none exists
        INSERT INTO public.subscriptions (
            id, user_id, plan_id, status,
            documents_used, documents_limit,
            current_period_start, current_period_end
        )
        VALUES (
            gen_random_uuid(),
            p_user_id,
            v_new_plan_id,
            'active'::public.subscription_status,
            0,
            v_new_plan_docs,
            CURRENT_TIMESTAMP,
            v_period_end
        )
        RETURNING id INTO v_subscription_id;

        v_event_type := 'created';
    END IF;

    -- Record in subscription_history
    INSERT INTO public.subscription_history (
        user_id, subscription_id, plan_id, plan_name,
        amount, interval, event_type,
        period_start, period_end,
        notes
    )
    VALUES (
        p_user_id,
        v_subscription_id,
        v_new_plan_id,
        v_new_plan_name,
        v_new_plan_price,
        v_new_plan_interval,
        v_event_type,
        CURRENT_TIMESTAMP,
        v_period_end,
        CASE
            WHEN v_event_type = 'upgraded' THEN 'Cambio de plan: ' || COALESCE(v_old_plan_name, 'N/A') || ' → ' || v_new_plan_name
            WHEN v_event_type = 'downgraded' THEN 'Cambio de plan: ' || COALESCE(v_old_plan_name, 'N/A') || ' → ' || v_new_plan_name
            ELSE 'Plan activado: ' || v_new_plan_name
        END
    );

    RETURN jsonb_build_object(
        'success', true,
        'subscription_id', v_subscription_id,
        'plan_id', v_new_plan_id,
        'plan_name', v_new_plan_name,
        'event_type', v_event_type
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant execute to authenticated users (called via service role from API)
REVOKE ALL ON FUNCTION public.update_user_subscription(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_user_subscription(UUID, TEXT) TO service_role;

-- Also seed paid plans if they don't exist yet
INSERT INTO public.subscription_plans (id, name, slug, description, price, interval, documents_included, features, is_active)
VALUES
    (
        gen_random_uuid(),
        'Plan Básico',
        'basico',
        'Ideal para freelancers y profesionistas independientes.',
        299.00,
        'monthly'::public.subscription_interval,
        25,
        '["25 documentos mensuales","25 firmas electrónicas","5 GB de almacenamiento","3 plantillas personalizadas","Soporte por email","CFDI incluido"]'::jsonb,
        true
    ),
    (
        gen_random_uuid(),
        'Plan Profesional',
        'profesional',
        'Para equipos en crecimiento que necesitan más capacidad.',
        599.00,
        'monthly'::public.subscription_interval,
        150,
        '["150 documentos mensuales","Firmas ilimitadas","25 GB de almacenamiento","20 plantillas personalizadas","Soporte prioritario","API básica","Reportes mensuales","CFDI incluido"]'::jsonb,
        true
    ),
    (
        gen_random_uuid(),
        'Plan Empresarial',
        'empresarial',
        'Solución completa para empresas con alto volumen de documentos.',
        1299.00,
        'monthly'::public.subscription_interval,
        999999,
        '["Documentos ilimitados","Firmas ilimitadas","100 GB de almacenamiento","Plantillas ilimitadas","Soporte 24/7 dedicado","API & Webhooks avanzados","Reportes personalizados","Certificados digitales avanzados","Usuarios ilimitados","SSO / SAML"]'::jsonb,
        true
    )
ON CONFLICT (slug) DO UPDATE
    SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        price = EXCLUDED.price,
        documents_included = EXCLUDED.documents_included,
        features = EXCLUDED.features,
        is_active = EXCLUDED.is_active,
        updated_at = CURRENT_TIMESTAMP;
