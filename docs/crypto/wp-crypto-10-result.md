# WP-CRYPTO-10 result

## Scope completed

- Added `CRYPTO_PROVIDER_MODE` with `development` as the only default and
  `PRODUCTION_CERTIFICATION_ENABLED=false` as a second, server-only gate.
- Added production-specific KMS, X.509 and RFC 3161 TSA adapters. Each reads
  only `DOCUBOX_PRODUCTION_*` variables and fails closed when incomplete.
- Added an independent PAdES verification stage. A certification cannot be
  persisted as valid unless both the signing flow and a fresh verification-only
  provider validate ByteRange, CMS, certificate and, for B-T, the RFC 3161
  token.
- Added a deployment-neutral production runbook covering gateway contract,
  staged rollout, rotation, revocation, rollback and disaster recovery.

## Intentional activation boundary

This work does not claim that a production KMS, CA or TSA is already deployed.
Those services require credentials, certificates and network configuration that
must be installed outside Git. Until all variables and providers pass health
checks, production execution remains disabled and no document can be marked
cryptographically valid through the production route.

## Legacy boundary

The historical VPS signer remains available only as the explicit deprecated
`LegacyLocalPemSigningProvider`. It is not selected by production mode and
cannot sign new certification digests.

## Verification performed

- TypeScript compilation.
- Unit tests for mode isolation, production adapter fail-closed behavior and
  independent-verifier enforcement.
