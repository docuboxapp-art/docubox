-- Migration: Add efirma_stamp_style column to user_profiles
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS efirma_stamp_style TEXT DEFAULT 'EC1';
