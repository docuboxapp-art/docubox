-- Signature attempts may be inserted by authenticated runtime RPCs. The trigger
-- needs narrowly scoped definer access to the private launch policy, without
-- granting clients SELECT on it or exposing a callable mutation.
ALTER FUNCTION case_runtime_private.case_launch_signature_method_guard() SECURITY DEFINER;
ALTER FUNCTION case_runtime_private.case_launch_signature_method_guard() SET search_path='';
REVOKE ALL ON FUNCTION case_runtime_private.case_launch_signature_method_guard() FROM PUBLIC,anon,authenticated;
