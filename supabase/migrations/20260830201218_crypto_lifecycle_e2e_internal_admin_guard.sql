-- Exposes only the existing internal-admin flag to server code that already
-- holds service_role. Tenant users cannot invoke this function through the
-- Data API, and the auth schema remains private.
CREATE OR REPLACE FUNCTION public.is_internal_super_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(
    (
      SELECT users.is_super_admin
      FROM auth.users
      WHERE users.id = p_user_id
    ),
    false
  );
$function$;

REVOKE ALL ON FUNCTION public.is_internal_super_admin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_internal_super_admin(uuid) TO service_role;
