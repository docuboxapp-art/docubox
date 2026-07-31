-- Migration: add custom_filters column to user_view_preferences
-- Stores custom sidebar filters ("Creados por mí") per user

ALTER TABLE public.user_view_preferences
  ADD COLUMN IF NOT EXISTS custom_filters JSONB NOT NULL DEFAULT '[]'::jsonb;
