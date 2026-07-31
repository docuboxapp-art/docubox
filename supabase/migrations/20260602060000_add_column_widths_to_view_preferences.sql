-- Migration: add column_widths_config to user_view_preferences
-- Stores per-user resizable column width preferences for all datatables in /mis-documentos

ALTER TABLE public.user_view_preferences
  ADD COLUMN IF NOT EXISTS column_widths_config JSONB NOT NULL DEFAULT '{}'::jsonb;
