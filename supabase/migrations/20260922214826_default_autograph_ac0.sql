-- AC0 is the default for existing and future autograph signers. Previously
-- completed responses retain the style recorded with their evidence.
ALTER TABLE public.user_profiles
  ALTER COLUMN autografa_stamp_style SET DEFAULT 'AC0';

UPDATE public.user_profiles
SET autografa_stamp_style = 'AC0'
WHERE autografa_stamp_style IS DISTINCT FROM 'AC0';
