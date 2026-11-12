-- Allow reusable consent and declaration copy alongside existing form defaults.
ALTER TABLE public.form_default_settings
  DROP CONSTRAINT form_default_settings_kind_check;

ALTER TABLE public.form_default_settings
  ADD CONSTRAINT form_default_settings_kind_check
  CHECK (kind IN ('experience', 'appearance', 'pdf', 'legal'));
