-- Preserve saved visual choices after AC0 becomes signature-only.
-- Existing signed responses keep their recorded evidence untouched.
ALTER TABLE public.user_profiles
  ALTER COLUMN autografa_stamp_style SET DEFAULT 'AC1';

UPDATE public.user_profiles
SET autografa_stamp_style = CASE
  WHEN autografa_stamp_style = 'AC1' THEN 'AC2'
  ELSE 'AC1'
END
WHERE autografa_stamp_style IS NULL
   OR autografa_stamp_style IN ('AC0', 'AC1');
