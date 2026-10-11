-- Keep previously emailed long codes usable when a form is relaunched with
-- the shorter eight-character code. Only the service role can read this table.
ALTER TABLE public.form_public_access_codes
  ADD COLUMN legacy_code_lookup text UNIQUE,
  ADD COLUMN legacy_code_hash text;

ALTER TABLE public.form_public_access_codes
  ADD CONSTRAINT form_public_legacy_code_pair_check
  CHECK ((legacy_code_lookup IS NULL) = (legacy_code_hash IS NULL));
