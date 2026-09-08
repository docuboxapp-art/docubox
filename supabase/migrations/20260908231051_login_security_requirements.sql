-- Consolidates the post-login security checks into one service-only lookup.
-- The caller validates the Supabase access token before invoking this function.
CREATE OR REPLACE FUNCTION public.get_login_security_requirements(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  bootstrap_super_admin BOOLEAN := false;
  totp_enabled BOOLEAN := false;
  passkey_enrolled BOOLEAN := false;
  staff_requires_passkey BOOLEAN := false;
  staff_role TEXT := NULL;
  platform_staff BOOLEAN := false;
BEGIN
  SELECT COALESCE(users.is_super_admin, false)
  INTO bootstrap_super_admin
  FROM auth.users users
  WHERE users.id = p_user_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_totp_settings totp
    WHERE totp.user_id = p_user_id
      AND totp.is_enabled = TRUE
      AND totp.confirmed_at IS NOT NULL
  ) INTO totp_enabled;

  SELECT EXISTS (
    SELECT 1
    FROM public.webauthn_credentials credentials
    WHERE credentials.user_id = p_user_id
      AND credentials.is_active = TRUE
  ) INTO passkey_enrolled;

  SELECT staff.requires_passkey, roles.role_key
  INTO staff_requires_passkey, staff_role
  FROM public.platform_staff staff
  JOIN public.platform_roles roles ON roles.id = staff.role_id
  WHERE staff.user_id = p_user_id
    AND staff.status = 'active'
    AND (staff.valid_until IS NULL OR staff.valid_until > CURRENT_TIMESTAMP);

  platform_staff := bootstrap_super_admin OR FOUND;

  RETURN jsonb_build_object(
    'totp_enabled', totp_enabled,
    'platform_staff', platform_staff,
    'platform_super_admin', bootstrap_super_admin OR COALESCE(staff_role = 'DOCUBOX_SUPER_ADMIN', false),
    'passkey_required', bootstrap_super_admin OR (
      platform_staff AND (
        staff_requires_passkey OR COALESCE(staff_role = 'DOCUBOX_SUPER_ADMIN', false)
      )
    ),
    'passkey_enrolled', passkey_enrolled,
    'enrollment_required', platform_staff AND NOT totp_enabled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_login_security_requirements(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_login_security_requirements(UUID) TO service_role;
