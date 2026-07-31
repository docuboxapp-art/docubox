-- Add autografa_stamp_style column to user_profiles
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS autografa_stamp_style TEXT DEFAULT 'AC1';
