# WP-CRYPTO-07 result

## Implemented controls

- Added a non-destructive Supabase migration that fixes `search_path` for all
  current public SECURITY DEFINER functions, revokes `PUBLIC` execution from
  workspace RLS helpers, and prevents creation in the public schema by
  untrusted roles.
- Replaced owner-only reads on `document_certifications` with explicit
  workspace and tenant checks. Related evidence manifests, evidence items and
  timestamp records inherit that authorization chain.
- Protected the `certification-artifacts` bucket from authenticated update and
  delete operations. Certification artifacts require a new immutable path.
- Hardened `seal-pdf`: it ignores client-provided `file_url`, derives an
  allowed source path from the authorized `documentos` row, and refuses to
  overwrite an existing sealed PDF.
- Hardened `sign-pdf-vps`: it derives signer identity from the authenticated
  participant, rejects unlisted or mismatched signers, requires a workspace,
  and refuses to overwrite an existing signed PDF.
- Replaced wildcard CORS in both privileged crypto routes with an explicit
  origin allowlist. Configure `DOCUBOX_ALLOWED_ORIGINS` in production.
- Removed the organization credential-encryption fallback to
  `SUPABASE_SERVICE_ROLE_KEY`.

## Verification performed locally

`tests/wp-crypto-07-security-hardening.test.mjs` verifies the source-level
regressions for tenant policy structure, immutable paths, signer authorization,
CORS, secret separation and the required inventory documentation.

## Required environment validation

The migration has not been applied by this package. Before marking the release
as deployed, apply it to Supabase and execute the runtime inventory and
cross-tenant checks in
`docs/crypto/wp-crypto-07-security-definer-inventory.md`.

The cross-tenant check must prove that user A cannot select certification or
evidence records belonging to user B's workspace. This is intentionally a live
database test because RLS behavior depends on the deployed role memberships and
existing policies.

## Remaining operating rules

- New SECURITY DEFINER functions require a fixed search path, an explicit
  execute-grant decision, tenant authorization, and a regression test.
- New Edge Functions using `service_role` must authenticate the caller and
  authorize the exact tenant resource before any Storage or database action.
- Do not enable the legacy VPS route as PAdES evidence. Its status remains
  legacy/manual-review until a verified provider result is recorded.
