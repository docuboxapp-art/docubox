-- Migration: add active_filters and custom_date_ranges columns to user_view_preferences
-- Stores the currently applied filter values and custom date ranges per user per view

ALTER TABLE public.user_view_preferences
  ADD COLUMN IF NOT EXISTS active_filters JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.user_view_preferences
  ADD COLUMN IF NOT EXISTS custom_date_ranges JSONB NOT NULL DEFAULT '{}'::jsonb;
