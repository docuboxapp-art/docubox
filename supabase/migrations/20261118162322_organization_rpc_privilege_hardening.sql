-- Organizational administration has no anonymous RPC entry points. Preserve
-- existing authenticated/service entry points while removing inherited PUBLIC
-- grants; triggers and bootstrap provisioning remain internal.
DO $permissions$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT p.oid::regprocedure AS signature,
      has_function_privilege('authenticated',p.oid,'EXECUTE') AS browser_allowed,
      has_function_privilege('service_role',p.oid,'EXECUTE') AS service_allowed,
      p.prorettype='pg_catalog.trigger'::regtype OR p.proname='bootstrap_business_organization' AS internal_only
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE '%organization%'
  LOOP
    IF item.browser_allowed AND NOT item.internal_only THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',item.signature);
    END IF;
    IF item.service_allowed THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',item.signature);
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon',item.signature);
    IF item.internal_only THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated',item.signature);
    END IF;
  END LOOP;
END;
$permissions$;
NOTIFY pgrst,'reload schema';
