-- ============================================================
-- User Registration: Subscriptions, Workspaces & Documents
-- Migration: 20260324090000_user_registration_workspace_subscription.sql
-- ============================================================

-- ── 1. ENUMS ─────────────────────────────────────────────────────────────────

DROP TYPE IF EXISTS public.subscription_status CASCADE;
CREATE TYPE public.subscription_status AS ENUM ('active', 'cancelled', 'expired', 'pending');

DROP TYPE IF EXISTS public.subscription_interval CASCADE;
CREATE TYPE public.subscription_interval AS ENUM ('monthly', 'yearly', 'lifetime');

DROP TYPE IF EXISTS public.document_status CASCADE;
CREATE TYPE public.document_status AS ENUM ('active', 'used', 'expired', 'revoked');

-- ── 2. SUBSCRIPTION PLANS TABLE ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.subscription_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    interval public.subscription_interval NOT NULL DEFAULT 'monthly'::public.subscription_interval,
    documents_included INTEGER NOT NULL DEFAULT 0,
    features JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ── 3. SUBSCRIPTIONS TABLE ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES public.subscription_plans(id),
    workspace_id UUID,
    status public.subscription_status NOT NULL DEFAULT 'active'::public.subscription_status,
    documents_used INTEGER NOT NULL DEFAULT 0,
    documents_limit INTEGER NOT NULL DEFAULT 0,
    current_period_start TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    current_period_end TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ── 4. SUBSCRIPTION HISTORY TABLE ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.subscription_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
    plan_id UUID REFERENCES public.subscription_plans(id),
    plan_name TEXT NOT NULL,
    amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    interval public.subscription_interval NOT NULL DEFAULT 'monthly'::public.subscription_interval,
    event_type TEXT NOT NULL DEFAULT 'created',
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ── 5. WORKSPACE DOCUMENTS TABLE ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.workspace_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL,
    document_name TEXT NOT NULL,
    document_ref TEXT,
    status public.document_status NOT NULL DEFAULT 'active'::public.document_status,
    is_validated BOOLEAN NOT NULL DEFAULT false,
    validated_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ── 6. ADD WORKSPACE_ID FK TO SUBSCRIPTIONS ──────────────────────────────────

ALTER TABLE public.subscriptions
ADD CONSTRAINT subscriptions_workspace_id_fkey
FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL
NOT VALID;

-- ── 7. ADD EXTRA COLUMNS TO USER_PROFILES ────────────────────────────────────

ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT 'personal',
ADD COLUMN IF NOT EXISTS personalidad_juridica TEXT,
ADD COLUMN IF NOT EXISTS identity_method TEXT,
ADD COLUMN IF NOT EXISTS rfc TEXT,
ADD COLUMN IF NOT EXISTS curp TEXT,
ADD COLUMN IF NOT EXISTS full_name TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- ── 8. INDEXES ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace_id ON public.subscriptions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_subscription_history_user_id ON public.subscription_history(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_documents_workspace_id ON public.workspace_documents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_documents_user_id ON public.workspace_documents(user_id);

-- ── 9. FUNCTIONS ──────────────────────────────────────────────────────────────

-- Function: handle_new_user (create user_profiles on auth.users insert)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.user_profiles (id, email, full_name, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
        COALESCE(NEW.raw_user_meta_data->>'avatar_url', NULL)
    )
    ON CONFLICT (id) DO UPDATE
        SET email = EXCLUDED.email,
            full_name = COALESCE(EXCLUDED.full_name, public.user_profiles.full_name),
            updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

-- Function: setup_free_workspace_and_subscription
-- Called after user registration to create workspace, subscription, and history
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

-- ── 10. ENABLE RLS ────────────────────────────────────────────────────────────

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_documents ENABLE ROW LEVEL SECURITY;

-- ── 11. RLS POLICIES ──────────────────────────────────────────────────────────

-- subscription_plans: public read
DROP POLICY IF EXISTS "public_read_subscription_plans" ON public.subscription_plans;
CREATE POLICY "public_read_subscription_plans"
ON public.subscription_plans FOR SELECT TO public USING (true);

-- subscriptions: user owns
DROP POLICY IF EXISTS "users_manage_own_subscriptions" ON public.subscriptions;
CREATE POLICY "users_manage_own_subscriptions"
ON public.subscriptions FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- subscription_history: user reads own
DROP POLICY IF EXISTS "users_read_own_subscription_history" ON public.subscription_history;
CREATE POLICY "users_read_own_subscription_history"
ON public.subscription_history FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "users_insert_own_subscription_history" ON public.subscription_history;
CREATE POLICY "users_insert_own_subscription_history"
ON public.subscription_history FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

-- workspace_documents: user owns
DROP POLICY IF EXISTS "users_manage_own_workspace_documents" ON public.workspace_documents;
CREATE POLICY "users_manage_own_workspace_documents"
ON public.workspace_documents FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- ── 12. TRIGGERS ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 13. SEED FREE PLAN ────────────────────────────────────────────────────────

INSERT INTO public.subscription_plans (id, name, slug, description, price, interval, documents_included, features, is_active)
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
ON CONFLICT (slug) DO NOTHING;
