-- ============================================================
-- Seed: Insert Free Plan into subscription_plans
-- Migration: 20260424160000_seed_free_plan.sql
-- ============================================================
-- This migration ensures the 'free' plan exists in subscription_plans.
-- Without this record, setup_free_workspace_and_subscription() fails
-- and new users don't get a workspace or subscription assigned.
-- ============================================================

INSERT INTO public.subscription_plans (
    id,
    name,
    slug,
    description,
    price,
    interval,
    documents_included,
    features,
    is_active
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
    SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        price = EXCLUDED.price,
        documents_included = EXCLUDED.documents_included,
        features = EXCLUDED.features,
        is_active = EXCLUDED.is_active,
        updated_at = CURRENT_TIMESTAMP;
