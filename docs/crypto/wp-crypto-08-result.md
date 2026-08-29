# WP-CRYPTO-08: Supabase Security Hardening Result

## Applied to Supabase

On 2026-08-21, the production Supabase project received the following
non-destructive cryptographic migrations in order:

1. `wp_crypto_01_capability_statuses`
2. `wp_crypto_02_certification_orchestrator`
3. `wp_crypto_03_key_management_provider`
4. `wp_crypto_04_x509_certificate_layer`
5. `wp_crypto_05_pades_engine`
6. `wp_crypto_06_rfc3161_tsa`
7. `wp_crypto_07_security_hardening`

The deployed policy set now includes workspace-scoped reads for certification,
evidence manifest and timestamp records. The private `certification-artifacts`
bucket has restrictive authenticated update and delete policies, so a completed
artifact cannot be replaced or removed through the authenticated Storage API.

## Edge functions deployed

- `seal-pdf` version 9
- `sign-pdf-vps` version 7
- `nom151-generate` version 11
- `send-email-notifications` version 71

The first two use the authorization and immutable-path controls introduced by
WP-CRYPTO-07. The legacy VPS route remains deprecated and cannot be presented
as PAdES evidence without a verified provider result.

## NOM-151 provider observation

The current provider integration has a recent `issued` record with Nubarium
status `OK`, a provider validation code, a persisted source hash, a persisted
constancy hash and an ASN.1 artifact in the private `nom151-constancias`
bucket. Earlier authentication and source-hash mismatch failures remain only
as auditable history and are not valid constancies.

## Residual platform advisories

Supabase still reports historic non-cryptographic security advisories. The
new crypto tables with RLS but no client policies are intentional: all grants
to `anon` and `authenticated` were revoked and the backend service role is the
only writer. The remaining organization and legacy function advisories need a
separate, compatibility-tested remediation; they must not be broadly revoked
without proving the corresponding product flows.

## Remaining runtime validation

1. Run a cross-tenant RLS test with two real workspace users.
2. Configure `DOCUBOX_ALLOWED_ORIGINS` in every deployed Edge Function
   environment before accepting browser traffic from a production origin.
3. Keep `CRYPTO_CERTIFICATION_E2E_ENABLED` disabled until KMS, X.509, PAdES
   and TSA health checks are actually ready.
4. Run a controlled certification in a non-production workspace and verify the
   resulting PDF and RFC 3161 token with an external verifier.
