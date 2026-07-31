-- Update profile for user imssjose24@gmail.com
-- Data: nombre=Luis Alberto, apellido_paterno=Hernández, apellido_materno=García,
--       curp=HEBL861015HSLRL502, telefono=8691074369

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

  -- Update user_profiles with the provided data
  UPDATE public.user_profiles
  SET
    nombre           = 'Luis Alberto',
    apellido_paterno = 'Hernández',
    apellido_materno = 'García',
    curp             = 'HEBL861015HSLRL502',
    telefono         = '8691074369',
    phone            = '8691074369',
    full_name        = 'Luis Alberto Hernández García',
    updated_at       = NOW()
  WHERE id = target_user_id;

  IF NOT FOUND THEN
    RAISE NOTICE 'No user_profiles row found for id %. Inserting...', target_user_id;
    INSERT INTO public.user_profiles (id, email, full_name, nombre, apellido_paterno, apellido_materno, curp, telefono, phone, updated_at)
    VALUES (
      target_user_id,
      'imssjose24@gmail.com',
      'Luis Alberto Hernández García',
      'Luis Alberto',
      'Hernández',
      'García',
      'HEBL861015HSLRL502',
      '8691074369',
      '8691074369',
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      nombre           = EXCLUDED.nombre,
      apellido_paterno = EXCLUDED.apellido_paterno,
      apellido_materno = EXCLUDED.apellido_materno,
      curp             = EXCLUDED.curp,
      telefono         = EXCLUDED.telefono,
      phone            = EXCLUDED.phone,
      full_name        = EXCLUDED.full_name,
      updated_at       = NOW();
  END IF;

  RAISE NOTICE 'Profile updated successfully for imssjose24@gmail.com (id: %)', target_user_id;
END $$;
