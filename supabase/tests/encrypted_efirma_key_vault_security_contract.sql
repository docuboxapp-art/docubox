BEGIN;
SELECT plan(8);

INSERT INTO auth.users (id, email)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'vault-owner@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'vault-other@example.com');

SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT * FROM public.encrypted_efirma_keys$$,
  '42501',
  NULL,
  'anonymous users cannot read encrypted e.firma keys'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
SELECT results_eq(
  $$INSERT INTO public.encrypted_efirma_keys (
      user_id, certificate_der_base64, certificate_fingerprint_sha256,
      encrypted_key_ciphertext, encrypted_key_iv, encrypted_key_salt
    ) VALUES (
      '11111111-1111-1111-1111-111111111111',
      repeat('Q', 64), repeat('a', 64), repeat('Q', 64), repeat('A', 16), repeat('B', 24)
    ) RETURNING user_id$$,
  ARRAY['11111111-1111-1111-1111-111111111111'::UUID],
  'the owner stores an opaque encrypted key'
);

SELECT results_eq(
  $$SELECT certificate_fingerprint_sha256 FROM public.encrypted_efirma_keys$$,
  ARRAY[repeat('a', 64)],
  'the owner reads their encrypted key'
);

SET LOCAL request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
SELECT is_empty(
  $$SELECT * FROM public.encrypted_efirma_keys$$,
  'another user cannot read the owner key'
);
SELECT is_empty(
  $$UPDATE public.encrypted_efirma_keys
    SET certificate_rfc = 'STOLEN'
    RETURNING certificate_rfc$$,
  'another user cannot update the owner key'
);
SELECT is_empty(
  $$DELETE FROM public.encrypted_efirma_keys RETURNING user_id$$,
  'another user cannot delete the owner key'
);

SET LOCAL request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
SELECT results_eq(
  $$SELECT certificate_rfc FROM public.encrypted_efirma_keys$$,
  ARRAY[NULL::TEXT],
  'the denied update left the owner key unchanged'
);
SELECT results_eq(
  $$DELETE FROM public.encrypted_efirma_keys RETURNING user_id$$,
  ARRAY['11111111-1111-1111-1111-111111111111'::UUID],
  'the owner can delete their encrypted key'
);

SELECT * FROM finish();
ROLLBACK;
