-- Add click_sign_stamp_style column to user_profiles
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS click_sign_stamp_style TEXT DEFAULT 'CC1';
