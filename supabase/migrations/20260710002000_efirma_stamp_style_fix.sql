-- Migration: Re-apply efirma_stamp_style column to user_profiles
-- Reason: 20260709220000_efirma_stamp_style.sql was not applied to Supabase
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS efirma_stamp_style TEXT DEFAULT 'EC1';
