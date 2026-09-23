ALTER TABLE public.user_module_preferences
  ADD COLUMN IF NOT EXISTS active_module_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

UPDATE public.user_module_preferences
SET active_module_ids = ARRAY[active_module_id]
WHERE active_module_id IS NOT NULL
  AND cardinality(active_module_ids) = 0;

ALTER TABLE public.user_module_preferences
  DROP CONSTRAINT IF EXISTS user_module_preferences_two_apps_check;

ALTER TABLE public.user_module_preferences
  ADD CONSTRAINT user_module_preferences_two_apps_check
  CHECK (
    cardinality(active_module_ids) <= 2
    AND active_module_ids <@ ARRAY[
      'formularios',
      'plantillas',
      'firmado-prueba-vida',
      'expedientes',
      'notifica',
      'credit-titles',
      'bulk-signatures',
      'certifica',
      'lucia'
    ]::TEXT[]
  );

ALTER TABLE public.user_module_preferences ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_module_preferences FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_module_preferences TO authenticated;

DROP POLICY IF EXISTS "users_manage_own_module_preferences"
  ON public.user_module_preferences;
CREATE POLICY "users_manage_own_module_preferences"
  ON public.user_module_preferences
  FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

COMMENT ON COLUMN public.user_module_preferences.active_module_ids IS
  'Applications enabled from App Market. The free plan permits up to two.';
