-- Migration: dashboard_layout
-- Adds dashboard_layout JSONB column to user_profiles for persisting widget layout per user

ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS dashboard_layout JSONB;
