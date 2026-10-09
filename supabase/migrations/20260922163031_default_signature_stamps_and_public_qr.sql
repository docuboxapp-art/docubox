-- Apply the product defaults to every existing profile and to profiles created
-- in the future. Users can still select another stamp after this migration.
ALTER TABLE public.user_profiles
  ALTER COLUMN autografa_stamp_style SET DEFAULT 'AC1',
  ALTER COLUMN efirma_stamp_style SET DEFAULT 'EC2',
  ALTER COLUMN click_sign_stamp_style SET DEFAULT 'CC2';

UPDATE public.user_profiles
SET autografa_stamp_style = 'AC1',
    efirma_stamp_style = 'EC2',
    click_sign_stamp_style = 'CC2'
WHERE autografa_stamp_style IS DISTINCT FROM 'AC1'
   OR efirma_stamp_style IS DISTINCT FROM 'EC2'
   OR click_sign_stamp_style IS DISTINCT FROM 'CC2';
