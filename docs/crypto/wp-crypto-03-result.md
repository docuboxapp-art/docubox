# WP-CRYPTO-03 - Key Management Provider result

## Result

**PASS - implementation baseline.** The certification flow now receives a
`KeyManagementProvider` through `createCertificationProviderSet()` rather than
knowing gateway/OpenBao details. Production activation remains fail-closed
until the OpenBao runtime is bootstrapped and its backend-only secrets are set.

## Delivered

- `src/lib/certification/key-management.ts` defines `KeyManagementProvider`,
  OpenBao Transit and legacy provider boundaries.
- `OpenBaoTransitProvider` authenticates by AppRole, signs canonical bytes in
  Transit, verifies the result locally and remotely, and records key version.
- `LegacyLocalPemSigningProvider` is explicitly deprecated and refuses new
  certification digest signing. The historical Edge Function remains isolated
  behind its own legacy adapter for compatibility.
- `src/lib/certification/key-management-health.ts` persists only provider
  metadata, health outcomes, latency and key references; no secret values.
- `src/app/api/internal/crypto/key-management-health/route.ts` is a
  backend-only, token-protected synthetic health endpoint.
- `supabase/migrations/20260821120000_wp_crypto_03_key_management_provider.sql`
  adds configuration/health audit records and RLS-protected access.
- `infra/openbao/` includes persistent local development configuration,
  least-privilege runtime policy, operator policy and bootstrap runbook.

## Security controls

- No private key, OpenBao token, Role ID or Secret ID is persisted in Supabase
  or passed to the frontend.
- OpenBao refuses non-TLS remote addresses. The local compose service binds to
  loopback only.
- RSA keys below 2048 bits, digest/content mismatches, malformed signatures and
  failed remote verification are rejected.
- Provider tests use a synthetic non-document payload; they never sign a real
  document during a health check.

## Pending external activation

The migration must be applied and OpenBao must be initialized/unsealed outside
this repository before health checks can return `OPERATIONAL`. Until then the
provider fails closed and the certification engine cannot claim a valid KMS
signature.
