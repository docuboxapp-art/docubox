-- Migration: add grid_columns_config column to user_view_preferences
-- Stores grid card field preferences per user

ALTER TABLE public.user_view_preferences
  ADD COLUMN IF NOT EXISTS grid_columns_config JSONB NOT NULL DEFAULT '[]'::jsonb;
