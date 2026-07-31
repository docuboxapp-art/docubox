-- ============================================================
-- Fix: phone number not saved on registration
-- Migration: 20260326020000_fix_phone_in_trigger_and_verification.sql
-- ============================================================

-- 1. Fix handle_new_user trigger to also copy phone from raw_user_meta_data
--    Previously it only copied full_name and avatar_url, leaving phone NULL
--    until the RPC ran — which caused duplicate-check to always show "available".
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.user_profiles (id, email, full_name, avatar_url, phone)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
        COALESCE(NEW.raw_user_meta_data->>'avatar_url', NULL),
        COALESCE(NEW.raw_user_meta_data->>'phone', NULL)
    )
    ON CONFLICT (id) DO UPDATE
        SET email      = EXCLUDED.email,
            full_name  = COALESCE(EXCLUDED.full_name, public.user_profiles.full_name),
            phone      = COALESCE(EXCLUDED.phone, public.user_profiles.phone),
            updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

-- 2. Fix setup_free_workspace_and_subscription to also write phone_number
--    into user_verification_status so the verification bar can display it.
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

    -- Get free plan id
    SELECT id INTO v_plan_id
    FROM public.subscription_plans
    WHERE slug = 'free'
    LIMIT 1;

    IF v_plan_id IS NULL THEN
        RAISE EXCEPTION 'Free plan not found in subscription_plans';
    END IF;

    -- Calculate period end (1 month from now)
    v_period_end := CURRENT_TIMESTAMP + INTERVAL '1 month';

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
        );
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
        );
    END IF;

    -- Update user profile with extra data (phone is already set by trigger,
    -- but COALESCE ensures we don't overwrite with NULL if somehow missing)
    UPDATE public.user_profiles
    SET
        full_name            = COALESCE(p_full_name, full_name),
        phone                = COALESCE(p_phone, phone),
        account_type         = COALESCE(p_account_type, account_type),
        personalidad_juridica = COALESCE(p_personalidad_juridica, personalidad_juridica),
        identity_method      = COALESCE(p_identity_method, identity_method),
        rfc                  = COALESCE(p_rfc, rfc),
        curp                 = COALESCE(p_curp, curp),
        updated_at           = CURRENT_TIMESTAMP
    WHERE id = p_user_id;

    -- Ensure user_verification_status has the phone_number populated
    INSERT INTO public.user_verification_status (user_id, phone_number)
    VALUES (p_user_id, p_phone)
    ON CONFLICT (user_id) DO UPDATE
        SET phone_number = COALESCE(p_phone, public.user_verification_status.phone_number),
            updated_at   = CURRENT_TIMESTAMP;

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

-- 3. Back-fill phone_number for any existing users who registered before this fix
UPDATE public.user_verification_status uvs
SET phone_number = up.phone,
    updated_at   = CURRENT_TIMESTAMP
FROM public.user_profiles up
WHERE uvs.user_id = up.id
  AND uvs.phone_number IS NULL
  AND up.phone IS NOT NULL;
