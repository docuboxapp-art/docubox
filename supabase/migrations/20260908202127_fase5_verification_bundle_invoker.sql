-- The service role already owns the required table privileges. Keep this
-- read-only bundle on invoker rights so the function never broadens access.

ALTER FUNCTION public.get_public_document_verification_bundle(TEXT)
  SECURITY INVOKER;

REVOKE ALL ON FUNCTION public.get_public_document_verification_bundle(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_document_verification_bundle(TEXT)
  TO service_role;
