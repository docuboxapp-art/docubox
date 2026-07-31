-- Migration: user_verification_status
-- Tracks 3-step verification per user:
--   1. Email OTP validation
--   2. Phone OTP validation
--   3. Biometric validation (may be pre-completed via enrollment)

-- ─── Table ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_verification_status (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,

  -- Step 1: Email OTP
  email_verified            BOOLEAN NOT NULL DEFAULT false,
  email_verified_at         TIMESTAMPTZ,
  email_otp_sent_at         TIMESTAMPTZ,
  email_otp_attempts        INTEGER NOT NULL DEFAULT 0,

  -- Step 2: Phone OTP
  phone_verified            BOOLEAN NOT NULL DEFAULT false,
  phone_verified_at         TIMESTAMPTZ,
  phone_otp_sent_at         TIMESTAMPTZ,
  phone_otp_attempts        INTEGER NOT NULL DEFAULT 0,
  phone_number              TEXT,

  -- Step 3: Biometric
  biometric_verified        BOOLEAN NOT NULL DEFAULT false,
  biometric_verified_at     TIMESTAMPTZ,
  -- Source: 'enrollment' | 'manual' | null
  biometric_source          TEXT,
  -- Reference to enrollment_results if completed via enrollment
  enrollment_result_id      UUID REFERENCES public.enrollment_results(id) ON DELETE SET NULL,

  -- Overall progress (0-3)
  verification_steps_completed INTEGER NOT NULL DEFAULT 0,
  all_verified              BOOLEAN NOT NULL DEFAULT false,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Unique: one record per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_verification_status_user_id
  ON public.user_verification_status (user_id);

CREATE INDEX IF NOT EXISTS idx_user_verification_status_all_verified
  ON public.user_verification_status (all_verified);

-- ─── Function: update updated_at ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_user_verification_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := CURRENT_TIMESTAMP;
  -- Recalculate steps_completed and all_verified automatically
  NEW.verification_steps_completed :=
    (CASE WHEN NEW.email_verified     THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.phone_verified     THEN 1 ELSE 0 END) +
    (CASE WHEN NEW.biometric_verified THEN 1 ELSE 0 END);
  NEW.all_verified := (NEW.email_verified AND NEW.phone_verified AND NEW.biometric_verified);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_verification_updated_at ON public.user_verification_status;
CREATE TRIGGER trg_user_verification_updated_at
  BEFORE INSERT OR UPDATE ON public.user_verification_status
  FOR EACH ROW EXECUTE FUNCTION public.update_user_verification_updated_at();

-- ─── Function: auto-create verification record on new user ────────────────────
-- When a new user_profile is created, insert a blank verification record.
-- If the user registered via biometric enrollment, mark biometric as verified.
CREATE OR REPLACE FUNCTION public.init_user_verification_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_enrollment_result_id UUID;
  v_biometric_verified   BOOLEAN := false;
  v_biometric_source     TEXT := NULL;
  v_biometric_at         TIMESTAMPTZ := NULL;
BEGIN
  -- Check if user completed biometric enrollment
  IF NEW.identity_method = 'biometric' THEN
    SELECT id INTO v_enrollment_result_id
    FROM public.enrollment_results
    WHERE user_id = NEW.id
      AND face_match_passed = true
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_enrollment_result_id IS NOT NULL THEN
      v_biometric_verified := true;
      v_biometric_source   := 'enrollment';
      v_biometric_at       := CURRENT_TIMESTAMP;
    END IF;
  END IF;

  INSERT INTO public.user_verification_status (
    user_id,
    email_verified,
    biometric_verified,
    biometric_verified_at,
    biometric_source,
    enrollment_result_id
  ) VALUES (
    NEW.id,
    false,
    v_biometric_verified,
    v_biometric_at,
    v_biometric_source,
    v_enrollment_result_id
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_init_user_verification ON public.user_profiles;
CREATE TRIGGER trg_init_user_verification
  AFTER INSERT ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.init_user_verification_status();

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.user_verification_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_verification_status" ON public.user_verification_status;
CREATE POLICY "users_manage_own_verification_status"
  ON public.user_verification_status
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─── Backfill existing users ──────────────────────────────────────────────────
DO $$
DECLARE
  rec RECORD;
  v_enrollment_result_id UUID;
  v_biometric_verified   BOOLEAN;
  v_biometric_source     TEXT;
  v_biometric_at         TIMESTAMPTZ;
BEGIN
  FOR rec IN
    SELECT id, identity_method FROM public.user_profiles
  LOOP
    v_biometric_verified := false;
    v_biometric_source   := NULL;
    v_biometric_at       := NULL;
    v_enrollment_result_id := NULL;

    IF rec.identity_method = 'biometric' THEN
      SELECT id INTO v_enrollment_result_id
      FROM public.enrollment_results
      WHERE user_id = rec.id
        AND face_match_passed = true
      ORDER BY created_at DESC
      LIMIT 1;

      IF v_enrollment_result_id IS NOT NULL THEN
        v_biometric_verified := true;
        v_biometric_source   := 'enrollment';
        v_biometric_at       := CURRENT_TIMESTAMP;
      END IF;
    END IF;

    INSERT INTO public.user_verification_status (
      user_id,
      email_verified,
      biometric_verified,
      biometric_verified_at,
      biometric_source,
      enrollment_result_id
    ) VALUES (
      rec.id,
      false,
      v_biometric_verified,
      v_biometric_at,
      v_biometric_source,
      v_enrollment_result_id
    )
    ON CONFLICT (user_id) DO NOTHING;
  END LOOP;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Backfill failed: %', SQLERRM;
END $$;
