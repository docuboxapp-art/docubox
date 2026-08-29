# Docubox production cryptography

This directory contains operational guidance only. It must never contain a
production private key, KMS credential, CA private key, TSA token or generated
certificate bundle.

## Provider boundary

Docubox uses three backend-only adapters in production:

1. `GoogleCloudKmsProvider` calls the configured Google Cloud HSM key version
   through an injected `GoogleCloudAuthProvider`. The authentication provider
   can use local ADC, external Workload Identity Federation or GCP native ADC
   without changing KMS, CMS or PAdES. `getPublicKey` must report
   `protectionLevel=HSM`; the provider signs SHA-256 digests through
   `asymmetricSign` and verifies every signature locally.
2. `ProductionCertificateProvider` reads only the public signing certificate,
   chain and trusted root from secret-mounted paths, then verifies that the
   certificate public key matches the KMS public key.
3. `ProductionTimestampAuthorityProvider` sends RFC 3161 requests to an HTTPS
   TSA and verifies the returned token, policy, nonce, CMS and TSA chain.

No adapter falls back to development, local PEM or a visual seal in production.

## Portable authentication

Use `GCP_AUTH_MODE=workload_identity` for an external production host and
`GCP_AUTH_MODE=gcp_native` for a Google Cloud runtime. `local_adc` is intended
for local development and controlled operational verification.

`HOSTING_PROVIDER` selects only the `WorkloadSubjectTokenProvider`. It never
changes the key resource or cryptographic implementation. Production rejects
Service Account JSON files and private-key environment variables. See
`docs/crypto/google-cloud-portable-auth.md` for the complete variable contract.

## Required Google Cloud resources

The backend configuration names one immutable key version. The expected
resource for this rollout is:

`projects/project-702d9de4-d29c-49f2-82c/locations/us-east1/keyRings/docubox-pades-prod/cryptoKeys/docubox-pades-production-signing/cryptoKeyVersions/1`

Grant `roles/cloudkms.signerVerifier` on the CryptoKey to the production signer
service account. Do not grant project Owner or KMS Admin to the signing
workload. The key must use `RSA_SIGN_PKCS1_3072_SHA256`, version `1`, and HSM
protection. Run `npm run test:kms:hsm-production` before issuing a certificate.

The production certificate is public material only. Generate it with
`npm run crypto:bootstrap:hsm-production-certificate` after configuring the
real legal subject. The same public certificate path is used as the private
trust root for this pinned deployment; no private key or PKCS#12 file exists.

## Controlled rollout

1. Confirm that the service account, key ring, key and version exist, then run
   the HSM E2E with `CRYPTO_PROVIDER_MODE=development` still active.
2. Deploy with `CRYPTO_PROVIDER_MODE=production` and
   `PRODUCTION_CERTIFICATION_ENABLED=false`.
3. Run provider health checks using a non-document KMS probe and a disposable
   RFC 3161 request in a staging tenant.
4. Compare the independent PAdES verification report with the signing report.
5. Enable a canary tenant, then set
   `PRODUCTION_CERTIFICATION_ENABLED=true` only after the canary passes.
6. Monitor provider latency, certificate expiry, timestamp failures and failed
   verification reports. Roll back by setting the flag to `false`; existing
   signed PDFs remain immutable and verifiable.

## Rotation, revocation and disaster recovery

- Create a new KMS key version and issue a certificate for its public key.
- Verify the certificate/KMS key match in staging before setting it active.
- Keep previous public certificates and chains available to validate existing
  PDFs. Never overwrite signed artifacts.
- On suspected compromise, disable production certification, revoke the
  affected certificate through the CA, rotate the KMS version and record the
  incident in the security audit log.
- Back up only encrypted KMS/HSM configuration, public certificates, trust
  roots and verification artifacts. Recovery must restore references and
  policies, not export private keys.
