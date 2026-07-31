-- Migration: Fix user_verification_status records and email_verified state
-- 1. Ensure all existing user_profiles have a verification_status record
-- 2. Reset email_verified to false for users whose auth email is NOT confirmed
--    (this cannot be done in SQL directly since auth.users.email_confirmed_at
--     is the source of truth — the VerificationProgressBar will sync on next load)

-- Ensure every user_profile has a verification_status row
INSERT INTO public.user_verification_status (user_id)
SELECT id FROM public.user_profiles
WHERE id NOT IN (SELECT user_id FROM public.user_verification_status)
ON CONFLICT (user_id) DO NOTHING;

-- Reset email_verified for all users to false so the frontend re-syncs
-- from auth.users.email_confirmed_at on next dashboard load.
-- Users who truly confirmed their email will be re-marked as verified
-- by the VerificationProgressBar sync logic.
UPDATE public.user_verification_status
SET email_verified = false,
    email_verified_at = NULL
WHERE email_verified = true;
