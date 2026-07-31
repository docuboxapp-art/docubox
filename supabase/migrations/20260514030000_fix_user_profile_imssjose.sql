-- Fix profile for imssjose24@gmail.com
-- Correct name: Jose Alberto Gonzalez (previously set incorrectly to Luis Alberto Hernández García)

DO $$
DECLARE
  target_user_id UUID;
BEGIN
  -- Find the user by email in auth.users
  SELECT id INTO target_user_id
  FROM auth.users
  WHERE email = 'imssjose24@gmail.com'
  LIMIT 1;

  IF target_user_id IS NULL THEN
    RAISE NOTICE 'User imssjose24@gmail.com not found in auth.users';
    RETURN;
  END IF;

  -- Update user_profiles with the corrected name
  UPDATE public.user_profiles
  SET
    nombre           = 'Jose',
    apellido_paterno = 'Alberto',
    apellido_materno = 'Gonzalez',
    full_name        = 'Jose Alberto Gonzalez',
    updated_at       = NOW()
  WHERE id = target_user_id;

  IF NOT FOUND THEN
    RAISE NOTICE 'No user_profiles row found for id %. Inserting...', target_user_id;
    INSERT INTO public.user_profiles (id, email, full_name, nombre, apellido_paterno, apellido_materno, updated_at)
    VALUES (
      target_user_id,
      'imssjose24@gmail.com',
      'Jose Alberto Gonzalez',
      'Jose',
      'Alberto',
      'Gonzalez',
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      nombre           = EXCLUDED.nombre,
      apellido_paterno = EXCLUDED.apellido_paterno,
      apellido_materno = EXCLUDED.apellido_materno,
      full_name        = EXCLUDED.full_name,
      updated_at       = NOW();
  END IF;

  RAISE NOTICE 'Profile corrected successfully for imssjose24@gmail.com (id: %)', target_user_id;
END $$;
