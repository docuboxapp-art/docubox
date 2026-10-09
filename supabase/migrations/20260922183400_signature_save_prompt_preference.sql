ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS signature_save_prompt_dismissed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.user_profiles.signature_save_prompt_dismissed IS
  'Oculta la invitacion para guardar la firma autografa despues de capturarla.';
