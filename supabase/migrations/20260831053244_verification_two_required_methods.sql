-- Email and biometric verification are the only required identity methods.
-- Phone data remains available as an optional contact attribute.

CREATE OR REPLACE FUNCTION public.update_user_verification_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := CURRENT_TIMESTAMP;
  NEW.verification_steps_completed :=
    (CASE WHEN NEW.email_verified THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.biometric_verified THEN 1 ELSE 0 END);
  NEW.all_verified := (NEW.email_verified AND NEW.biometric_verified);
  RETURN NEW;
END;
$$;

COMMENT ON COLUMN public.user_verification_status.phone_verified IS
  'Optional phone verification evidence; it does not gate identity completion.';
COMMENT ON COLUMN public.user_verification_status.verification_steps_completed IS
  'Completed required methods: email and biometric (0-2).';
COMMENT ON COLUMN public.user_verification_status.all_verified IS
  'True when the required email and biometric methods are verified.';

UPDATE public.user_verification_status
SET updated_at = CURRENT_TIMESTAMP;
