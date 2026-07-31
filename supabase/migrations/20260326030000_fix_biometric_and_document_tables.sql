-- ============================================================
-- Fix biometric status + create document type catalog tables
-- Migration: 20260326030000_fix_biometric_and_document_tables.sql
-- ============================================================

-- ── 1. Fix setup_free_workspace_and_subscription ──────────────────────────────
-- Now correctly sets biometric_verified = true when identity_method = 'biometrico'
-- and also ensures personalidad_juridica, identity_method, rfc, curp are saved.

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
    v_biometric_verified BOOLEAN := false;
    v_biometric_at TIMESTAMPTZ := NULL;
    v_enrollment_result_id UUID := NULL;
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

    -- Update user profile with all registration data
    UPDATE public.user_profiles
    SET
        full_name             = COALESCE(p_full_name, full_name),
        phone                 = COALESCE(p_phone, phone),
        account_type          = COALESCE(p_account_type, account_type),
        personalidad_juridica = COALESCE(p_personalidad_juridica, personalidad_juridica),
        identity_method       = COALESCE(p_identity_method, identity_method),
        rfc                   = COALESCE(p_rfc, rfc),
        curp                  = COALESCE(p_curp, curp),
        updated_at            = CURRENT_TIMESTAMP
    WHERE id = p_user_id;

    -- Determine biometric status based on identity_method
    -- 'biometrico' = user completed biometric enrollment during registration
    IF p_identity_method = 'biometrico' THEN
        -- Look for a completed enrollment result for this user
        SELECT id INTO v_enrollment_result_id
        FROM public.enrollment_results
        WHERE user_id = p_user_id
          AND face_match_passed = true
        ORDER BY created_at DESC
        LIMIT 1;

        v_biometric_verified := true;
        v_biometric_at := CURRENT_TIMESTAMP;
    END IF;

    -- Upsert user_verification_status with phone and biometric status
    INSERT INTO public.user_verification_status (
        user_id,
        phone_number,
        biometric_verified,
        biometric_verified_at,
        biometric_source,
        enrollment_result_id
    )
    VALUES (
        p_user_id,
        p_phone,
        v_biometric_verified,
        v_biometric_at,
        CASE WHEN v_biometric_verified THEN 'enrollment' ELSE NULL END,
        v_enrollment_result_id
    )
    ON CONFLICT (user_id) DO UPDATE
        SET phone_number          = COALESCE(p_phone, public.user_verification_status.phone_number),
            biometric_verified    = CASE
                                      WHEN p_identity_method = 'biometrico' THEN true
                                      ELSE public.user_verification_status.biometric_verified
                                    END,
            biometric_verified_at = CASE
                                      WHEN p_identity_method = 'biometrico' AND public.user_verification_status.biometric_verified_at IS NULL
                                      THEN CURRENT_TIMESTAMP
                                      ELSE public.user_verification_status.biometric_verified_at
                                    END,
            biometric_source      = CASE
                                      WHEN p_identity_method = 'biometrico' THEN 'enrollment'
                                      ELSE public.user_verification_status.biometric_source
                                    END,
            enrollment_result_id  = COALESCE(v_enrollment_result_id, public.user_verification_status.enrollment_result_id),
            updated_at            = CURRENT_TIMESTAMP;

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

-- ── 2. Create grupo_tipo_documento table ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.grupo_tipo_documento (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre      TEXT NOT NULL UNIQUE,
    orden       INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed the 11 groups
INSERT INTO public.grupo_tipo_documento (nombre, orden) VALUES
    ('Legales y Contractuales',       1),
    ('Corporativos y Societarios',    2),
    ('Fiscales y SAT',                3),
    ('Financieros y Bancarios',       4),
    ('Laborales y RH',                5),
    ('Cumplimiento y KYC',            6),
    ('Operativos y Administrativos',  7),
    ('Gubernamentales',               8),
    ('Digitales Avanzados',           9),
    ('Especiales',                   10),
    ('Otros',                        11)
ON CONFLICT (nombre) DO NOTHING;

-- ── 3. Create tipo_documento table ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tipo_documento (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grupo_id                UUID NOT NULL REFERENCES public.grupo_tipo_documento(id) ON DELETE RESTRICT,
    nombre                  TEXT NOT NULL,
    descripcion             TEXT,
    requiere_firma          BOOLEAN NOT NULL DEFAULT true,
    activo                  BOOLEAN NOT NULL DEFAULT true,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tipo_documento_grupo_id ON public.tipo_documento(grupo_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tipo_documento_grupo_nombre ON public.tipo_documento(grupo_id, nombre);

-- ── 4. Seed tipo_documento ────────────────────────────────────────────────────

DO $$
DECLARE
    v_legales_id          UUID;
    v_corporativos_id     UUID;
    v_fiscales_id         UUID;
    v_financieros_id      UUID;
    v_laborales_id        UUID;
    v_cumplimiento_id     UUID;
    v_operativos_id       UUID;
    v_gubernamentales_id  UUID;
    v_digitales_id        UUID;
    v_especiales_id       UUID;
BEGIN
    SELECT id INTO v_legales_id         FROM public.grupo_tipo_documento WHERE nombre = 'Legales y Contractuales';
    SELECT id INTO v_corporativos_id    FROM public.grupo_tipo_documento WHERE nombre = 'Corporativos y Societarios';
    SELECT id INTO v_fiscales_id        FROM public.grupo_tipo_documento WHERE nombre = 'Fiscales y SAT';
    SELECT id INTO v_financieros_id     FROM public.grupo_tipo_documento WHERE nombre = 'Financieros y Bancarios';
    SELECT id INTO v_laborales_id       FROM public.grupo_tipo_documento WHERE nombre = 'Laborales y RH';
    SELECT id INTO v_cumplimiento_id    FROM public.grupo_tipo_documento WHERE nombre = 'Cumplimiento y KYC';
    SELECT id INTO v_operativos_id      FROM public.grupo_tipo_documento WHERE nombre = 'Operativos y Administrativos';
    SELECT id INTO v_gubernamentales_id FROM public.grupo_tipo_documento WHERE nombre = 'Gubernamentales';
    SELECT id INTO v_digitales_id       FROM public.grupo_tipo_documento WHERE nombre = 'Digitales Avanzados';
    SELECT id INTO v_especiales_id      FROM public.grupo_tipo_documento WHERE nombre = 'Especiales';

    -- Legales y Contractuales
    INSERT INTO public.tipo_documento (grupo_id, nombre) VALUES
        (v_legales_id, 'Contrato de prestación de servicios'),
        (v_legales_id, 'Contrato marco de servicios'),
        (v_legales_id, 'Contrato de servicios profesionales'),
        (v_legales_id, 'Contrato laboral por tiempo indeterminado'),
        (v_legales_id, 'Contrato laboral por obra o tiempo determinado'),
        (v_legales_id, 'Contrato de honorarios'),
        (v_legales_id, 'Contrato de confidencialidad (NDA)'),
        (v_legales_id, 'Contrato de no competencia'),
        (v_legales_id, 'Contrato de exclusividad'),
        (v_legales_id, 'Contrato de arrendamiento'),
        (v_legales_id, 'Contrato de comodato'),
        (v_legales_id, 'Contrato de compraventa'),
        (v_legales_id, 'Contrato de suministro'),
        (v_legales_id, 'Contrato de distribución'),
        (v_legales_id, 'Contrato de comisión mercantil'),
        (v_legales_id, 'Contrato de franquicia'),
        (v_legales_id, 'Contrato de outsourcing'),
        (v_legales_id, 'Convenio modificatorio'),
        (v_legales_id, 'Convenio de terminación anticipada'),
        (v_legales_id, 'Convenio de colaboración'),
        (v_legales_id, 'Carta de intención (LOI)'),
        (v_legales_id, 'Carta responsiva')
    ON CONFLICT (grupo_id, nombre) DO NOTHING;

    -- Corporativos y Societarios
    INSERT INTO public.tipo_documento (grupo_id, nombre) VALUES
        (v_corporativos_id, 'Acta constitutiva'),
        (v_corporativos_id, 'Estatutos sociales'),
        (v_corporativos_id, 'Acta de asamblea ordinaria'),
        (v_corporativos_id, 'Acta de asamblea extraordinaria'),
        (v_corporativos_id, 'Acta de consejo de administración'),
        (v_corporativos_id, 'Acuerdo de socios'),
        (v_corporativos_id, 'Acuerdo de accionistas'),
        (v_corporativos_id, 'Poder para actos de administración'),
        (v_corporativos_id, 'Poder para actos de dominio'),
        (v_corporativos_id, 'Poder para pleitos y cobranzas'),
        (v_corporativos_id, 'Revocación de poderes'),
        (v_corporativos_id, 'Designación de representante legal'),
        (v_corporativos_id, 'Nombramiento de administrador único')
    ON CONFLICT (grupo_id, nombre) DO NOTHING;

    -- Fiscales y SAT
    INSERT INTO public.tipo_documento (grupo_id, nombre) VALUES
        (v_fiscales_id, 'Carta autorización SAT'),
        (v_fiscales_id, 'Carta poder para trámites fiscales'),
        (v_fiscales_id, 'Opinión de cumplimiento'),
        (v_fiscales_id, 'Acuse de inscripción RFC'),
        (v_fiscales_id, 'Aviso de cambio de domicilio fiscal'),
        (v_fiscales_id, 'Aviso de actualización de actividades'),
        (v_fiscales_id, 'Aviso de suspensión de actividades'),
        (v_fiscales_id, 'Aviso de reanudación de actividades'),
        (v_fiscales_id, 'Manifestación bajo protesta'),
        (v_fiscales_id, 'Declaración de beneficiario controlador'),
        (v_fiscales_id, 'Carta de residencia fiscal'),
        (v_fiscales_id, 'Autorización uso de e.firma')
    ON CONFLICT (grupo_id, nombre) DO NOTHING;

    -- Financieros y Bancarios
    INSERT INTO public.tipo_documento (grupo_id, nombre) VALUES
        (v_financieros_id, 'Contrato de crédito'),
        (v_financieros_id, 'Contrato de financiamiento'),
        (v_financieros_id, 'Contrato de apertura de cuenta'),
        (v_financieros_id, 'Reconocimiento de adeudo'),
        (v_financieros_id, 'Pagaré'),
        (v_financieros_id, 'Carta de instrucciones bancarias'),
        (v_financieros_id, 'Autorización de cargos automáticos'),
        (v_financieros_id, 'Cesión de derechos de cobro'),
        (v_financieros_id, 'Convenio de pago'),
        (v_financieros_id, 'Contrato de factoraje'),
        (v_financieros_id, 'Arrendamiento financiero')
    ON CONFLICT (grupo_id, nombre) DO NOTHING;

    -- Laborales y RH
    INSERT INTO public.tipo_documento (grupo_id, nombre) VALUES
        (v_laborales_id, 'Contrato individual de trabajo'),
        (v_laborales_id, 'Contrato colectivo de trabajo'),
        (v_laborales_id, 'Reglamento interior de trabajo'),
        (v_laborales_id, 'Código de ética'),
        (v_laborales_id, 'Carta de confidencialidad laboral'),
        (v_laborales_id, 'Aviso de privacidad'),
        (v_laborales_id, 'Alta de empleado'),
        (v_laborales_id, 'Baja de empleado'),
        (v_laborales_id, 'Acta administrativa'),
        (v_laborales_id, 'Finiquito'),
        (v_laborales_id, 'Renuncia voluntaria'),
        (v_laborales_id, 'Convenio de terminación laboral')
    ON CONFLICT (grupo_id, nombre) DO NOTHING;

    -- Cumplimiento y KYC
    INSERT INTO public.tipo_documento (grupo_id, nombre) VALUES
        (v_cumplimiento_id, 'Formato KYC persona física'),
        (v_cumplimiento_id, 'Formato KYB persona moral'),
        (v_cumplimiento_id, 'Declaración de origen de recursos'),
        (v_cumplimiento_id, 'Perfil transaccional'),
        (v_cumplimiento_id, 'Carta de conocimiento del cliente'),
        (v_cumplimiento_id, 'Autorización de verificación biométrica'),
        (v_cumplimiento_id, 'Consulta listas negras'),
        (v_cumplimiento_id, 'Reporte de cumplimiento')
    ON CONFLICT (grupo_id, nombre) DO NOTHING;

    -- Operativos y Administrativos
    INSERT INTO public.tipo_documento (grupo_id, nombre) VALUES
        (v_operativos_id, 'Orden de servicio'),
        (v_operativos_id, 'Orden de compra'),
        (v_operativos_id, 'Solicitud interna'),
        (v_operativos_id, 'Alta de proveedor'),
        (v_operativos_id, 'Alta de cliente'),
        (v_operativos_id, 'Checklist operativo'),
        (v_operativos_id, 'Acta de entrega-recepción'),
        (v_operativos_id, 'Reporte de actividades'),
        (v_operativos_id, 'Autorización interna')
    ON CONFLICT (grupo_id, nombre) DO NOTHING;

    -- Gubernamentales
    INSERT INTO public.tipo_documento (grupo_id, nombre) VALUES
        (v_gubernamentales_id, 'Solicitud administrativa'),
        (v_gubernamentales_id, 'Oficio'),
        (v_gubernamentales_id, 'Escrito libre'),
        (v_gubernamentales_id, 'Notificación oficial'),
        (v_gubernamentales_id, 'Resolución administrativa'),
        (v_gubernamentales_id, 'Licencia'),
        (v_gubernamentales_id, 'Permiso'),
        (v_gubernamentales_id, 'Registro oficial')
    ON CONFLICT (grupo_id, nombre) DO NOTHING;

    -- Digitales Avanzados
    INSERT INTO public.tipo_documento (grupo_id, nombre) VALUES
        (v_digitales_id, 'Documento con sello de tiempo'),
        (v_digitales_id, 'Documento con biometría'),
        (v_digitales_id, 'Documento con evidencia electrónica'),
        (v_digitales_id, 'Documento notariado digital'),
        (v_digitales_id, 'Documento en blockchain'),
        (v_digitales_id, 'Documento con hash verificable'),
        (v_digitales_id, 'Documento inmutable'),
        (v_digitales_id, 'Custodia digital')
    ON CONFLICT (grupo_id, nombre) DO NOTHING;

    -- Especiales
    INSERT INTO public.tipo_documento (grupo_id, nombre) VALUES
        (v_especiales_id, 'Documento personalizado'),
        (v_especiales_id, 'Plantilla corporativa'),
        (v_especiales_id, 'Documento híbrido'),
        (v_especiales_id, 'Documento multientidad'),
        (v_especiales_id, 'Documento con testigos'),
        (v_especiales_id, 'Documento con aprobación previa')
    ON CONFLICT (grupo_id, nombre) DO NOTHING;

EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Seed tipo_documento failed: %', SQLERRM;
END $$;

-- ── 5. RLS for new tables ─────────────────────────────────────────────────────

ALTER TABLE public.grupo_tipo_documento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tipo_documento ENABLE ROW LEVEL SECURITY;

-- Both tables are catalog/reference data — allow authenticated users to read
DROP POLICY IF EXISTS "authenticated_read_grupo_tipo_documento" ON public.grupo_tipo_documento;
CREATE POLICY "authenticated_read_grupo_tipo_documento"
    ON public.grupo_tipo_documento FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "authenticated_read_tipo_documento" ON public.tipo_documento;
CREATE POLICY "authenticated_read_tipo_documento"
    ON public.tipo_documento FOR SELECT
    TO authenticated
    USING (true);

-- Service role can manage catalog data
DROP POLICY IF EXISTS "service_role_manage_grupo_tipo_documento" ON public.grupo_tipo_documento;
CREATE POLICY "service_role_manage_grupo_tipo_documento"
    ON public.grupo_tipo_documento FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_manage_tipo_documento" ON public.tipo_documento;
CREATE POLICY "service_role_manage_tipo_documento"
    ON public.tipo_documento FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
