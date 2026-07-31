-- Migration: add firma_autografa_url to user_profiles
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS firma_autografa_url TEXT;
