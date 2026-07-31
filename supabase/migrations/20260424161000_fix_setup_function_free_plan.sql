-- ============================================================
-- Fix: Make setup_free_workspace_and_subscription resilient
-- Migration: 20260424161000_fix_setup_function_free_plan.sql
-- ============================================================
-- Replaces the function so that if the 'free' plan doesn't exist
-- it creates it automatically, preventing registration failures.
-- ============================================================

CREATE OR REPLACE FUNCTION public.setup_free_workspace_and_subscription(
    p_user_id UUID,
    p_full_name TEXT,
    p_account_type TEXT,
    p_personalidad_juridica TEXT,
    p_identity_method TEXT,
    p_rfc TEXT DEFAULT NULL,
    p_curp TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_document_type_1 TEXT DEFAULT NULL,
    p_document_type_2 TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_workspace_id UUID;
    v_plan_id UUID;
    v_subscription_id UUID;
    v_workspace_type public.workspace_type;
    v_period_end TIMESTAMPTZ;
BEGIN
    -- Determine workspace type
    IF p_account_type = 'empresarial' THEN
        v_workspace_type := 'business'::public.workspace_type;
    ELSE
        v_workspace_type := 'personal'::public.workspace_type;
    END IF;

    -- Get free plan id — create it if it doesn't exist
    SELECT id INTO v_plan_id
    FROM public.subscription_plans
    WHERE slug = 'free'
    LIMIT 1;

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

    -- Calculate period end (1 month from now)
    v_period_end := CURRENT_TIMESTAMP + INTERVAL '1 month';

    -- Check if user already has a workspace (avoid duplicates on retry)
    SELECT w.id INTO v_workspace_id
    FROM public.workspaces w
    WHERE w.owner_id = p_user_id
    LIMIT 1;

    IF v_workspace_id IS NULL THEN
        -- Create workspace
        INSERT INTO public.workspaces (id, name, workspace_type, owner_id, description)
        VALUES (
            gen_random_uuid(),
            COALESCE(p_full_name, 'Mi Workspace'),
            v_workspace_type,
            p_user_id,
            'Workspace personal de ' || COALESCE(p_full_name, 'usuario')
        )
        RETURNING id INTO v_workspace_id;

        -- Add user as owner member
        INSERT INTO public.workspace_members (workspace_id, user_id, role)
        VALUES (v_workspace_id, p_user_id, 'owner'::public.workspace_member_role)
        ON CONFLICT DO NOTHING;
    END IF;

    -- Check if user already has an active subscription
    SELECT id INTO v_subscription_id
    FROM public.subscriptions
    WHERE user_id = p_user_id AND status = 'active'
    LIMIT 1;

    IF v_subscription_id IS NULL THEN
        -- Create free subscription
        INSERT INTO public.subscriptions (
            id, user_id, plan_id, workspace_id, status,
            documents_used, documents_limit,
            current_period_start, current_period_end
        )
        VALUES (
            gen_random_uuid(),
            p_user_id,
            v_plan_id,
            v_workspace_id,
            'active'::public.subscription_status,
            0,
            2,
            CURRENT_TIMESTAMP,
            v_period_end
        )
        RETURNING id INTO v_subscription_id;

        -- Record subscription history
        INSERT INTO public.subscription_history (
            user_id, subscription_id, plan_id, plan_name,
            amount, interval, event_type,
            period_start, period_end,
            notes
        )
        VALUES (
            p_user_id,
            v_subscription_id,
            v_plan_id,
            'Plan Gratuito',
            0.00,
            'monthly'::public.subscription_interval,
            'created',
            CURRENT_TIMESTAMP,
            v_period_end,
            'Plan gratuito activado al registrarse. Renovacion mensual automatica.'
        );
    END IF;

    -- Add validated documents to workspace
    IF p_document_type_1 IS NOT NULL THEN
        INSERT INTO public.workspace_documents (
            workspace_id, user_id, document_type, document_name,
            status, is_validated, validated_at
        )
        VALUES (
            v_workspace_id, p_user_id,
            p_document_type_1,
            CASE p_document_type_1
                WHEN 'biometrico' THEN 'Enrolamiento Biometrico'
                WHEN 'efirma_fisica' THEN 'e.Firma Persona Fisica'
                WHEN 'efirma_moral' THEN 'e.Firma Persona Moral'
                ELSE p_document_type_1
            END,
            'active'::public.document_status,
            true,
            CURRENT_TIMESTAMP
        )
        ON CONFLICT DO NOTHING;
    END IF;

    IF p_document_type_2 IS NOT NULL THEN
        INSERT INTO public.workspace_documents (
            workspace_id, user_id, document_type, document_name,
            status, is_validated, validated_at
        )
        VALUES (
            v_workspace_id, p_user_id,
            p_document_type_2,
            CASE p_document_type_2
                WHEN 'biometrico' THEN 'Enrolamiento Biometrico'
                WHEN 'efirma_fisica' THEN 'e.Firma Persona Fisica'
                WHEN 'efirma_moral' THEN 'e.Firma Persona Moral'
                ELSE p_document_type_2
            END,
            'active'::public.document_status,
            true,
            CURRENT_TIMESTAMP
        )
        ON CONFLICT DO NOTHING;
    END IF;

    -- Update user profile with extra data
    UPDATE public.user_profiles
    SET
        full_name = COALESCE(p_full_name, full_name),
        phone = COALESCE(p_phone, phone),
        account_type = COALESCE(p_account_type, account_type),
        personalidad_juridica = COALESCE(p_personalidad_juridica, personalidad_juridica),
        identity_method = COALESCE(p_identity_method, identity_method),
        rfc = COALESCE(p_rfc, rfc),
        curp = COALESCE(p_curp, curp),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_user_id;

    RETURN jsonb_build_object(
        'success', true,
        'workspace_id', v_workspace_id,
        'subscription_id', v_subscription_id,
        'plan_id', v_plan_id
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', SQLERRM
        );
END;
$$;
