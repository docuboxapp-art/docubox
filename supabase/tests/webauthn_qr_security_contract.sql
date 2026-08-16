BEGIN;

SELECT plan(4);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.webauthn_qr_tokens'::regclass),
  'WebAuthn QR tokens have row-level security enabled'
);

SELECT ok(
  (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.webauthn_qr_tokens'::regclass),
  'WebAuthn QR tokens force row-level security'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.webauthn_qr_tokens', 'SELECT'),
  'anonymous clients cannot read QR enrollment tokens'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.webauthn_qr_tokens', 'SELECT'),
  'authenticated clients cannot read QR enrollment tokens directly'
);

SELECT * FROM finish();
ROLLBACK;
