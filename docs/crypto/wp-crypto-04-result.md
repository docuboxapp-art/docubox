# WP-CRYPTO-04 - X.509 Certificate Layer result

## Result

**PASS - development X.509 boundary implemented.** A signing certificate is
now checked against the public key obtained from `KeyManagementProvider` before
the certification engine can proceed beyond its foundation-only mode.

## Delivered

- `src/lib/certification/certificates.ts` defines `CertificateProvider`,
  `DevelopmentCertificateProvider`, PKCS#10 CSR generation with remote digest
  signing, X.509 metadata extraction, chain validation and health checks.
- The CSR uses `KeyManagementProvider.getPublicKey()` for SPKI and
  `KeyManagementProvider.signDigest()` for its PKCS#10 signature. The managed
  signing private key is never exported.
- `src/lib/certification/providers.ts` includes the certificate provider in
  the provider set. A missing, invalid, expired, future-dated or key-mismatched
  certificate keeps the flow fail-closed.
- `src/lib/certification/engine.ts` persists public certificate metadata only
  after a valid key-binding and chain check. It cannot promote invalid
  certificate material to a valid certification capability.
- `supabase/migrations/20260821123000_wp_crypto_04_x509_certificate_layer.sql`
  extends `cryptographic_keys` non-destructively with public X.509 fields and
  an expiry index.
- `infra/pki/` provides a development root CA issuer and a signing-certificate
  issuer. Both write CA state outside the repository by default.

## Validation states

The provider returns `valid`, `expiring_soon`, `expired`, `not_yet_valid`,
`invalid_chain`, `key_mismatch`, `environment_mismatch`, or `not_configured`.
Only `valid` and `expiring_soon` pass the engine gate. A development certificate
is never evidence of a production-qualified certificate.

## Security controls

- No signing key, CA private key, PKCS#12 bundle, token or AppRole credential
  is stored in PostgreSQL or emitted to a frontend.
- The development CA key is created under `DOCUBOX_PKI_STATE_DIR` rather than
  under `infra/pki/`; its path is excluded from Git.
- The certificate public key is compared as exact DER SPKI bytes with the
  managed public key using a timing-safe comparison.
- A certificate chain must terminate in the configured development root and
  each issuer signature, certificate validity window and development identity
  are checked.

## Verification

- `npm.cmd run type-check`
- `node --test tests\\certificate-provider.test.mjs tests\\key-management-provider.test.mjs tests\\certification-orchestrator.test.mjs tests\\crypto-foundation.test.mjs`

The certificate tests generate temporary keys only to emulate the Key Management
Provider and a temporary CA. They validate the remotely signed CSR using
OpenSSL, confirm a trusted chain, detect a key mismatch, and cover the remaining
certificate status transitions.

## Required environment activation

Apply the migration and bootstrap OpenBao first. Then issue a certificate from
the CSR with the scripts in `infra/pki/` and configure the backend-only public
certificate paths. Until that activation exists, the system remains
foundation-only and cannot claim a configured institutional certificate.
