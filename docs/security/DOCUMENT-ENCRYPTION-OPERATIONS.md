# Document Encryption Operations

## Required backend configuration

```text
DOCUMENT_ENCRYPTION_ENABLED=true
DOCUMENT_ENCRYPTION_REQUIRED=true
DOCUMENT_LEGACY_DECRYPTION_ALLOWED=true   # migration window only
DOCUMENT_ENCRYPTION_KMS_PROVIDER=gcp
DOCUMENT_ENCRYPTION_KMS_KEY_RESOURCE=projects/project-702d9de4-d29c-49f2-82c/locations/us-east1/keyRings/docubox-pades-prod/cryptoKeys/docubox-document-kek
DOCUMENT_ENCRYPTION_KMS_PROTECTION_LEVEL=hsm
GCP_PROJECT_ID=project-702d9de4-d29c-49f2-82c
GCP_SERVICE_ACCOUNT_EMAIL=docubox-pades-prod-signer@project-702d9de4-d29c-49f2-82c.iam.gserviceaccount.com
```

The CryptoKey must be symmetric and have an enabled primary version. The runtime
identity has `roles/cloudkms.cryptoKeyEncrypterDecrypter` and the read-only
`roles/cloudkms.viewer`, both scoped to this CryptoKey. The viewer permission is
required by the provider health check to validate purpose, algorithm, primary
version, state, and protection level. Never add a service-account JSON key or
local KEK fallback.

## Health and failure behavior

When encryption is required, upload routes fail closed if KMS, metadata, Storage,
wrap, or verification fails. Decryption checks ciphertext SHA-256, KMS/AAD,
AES-GCM tag, plaintext size, and plaintext SHA-256 before delivery.

Operational events are written without DEKs, ciphertext, authorization headers,
or full cryptographic payloads. Download responses use `private, no-store` and
`Pragma: no-cache`.

## Disaster recovery

Recovery requires all four components:

1. encrypted Storage object;
2. `document_encryption_metadata` row;
3. database relationship to tenant/document/version;
4. an enabled KMS key version able to decrypt the wrapped DEK.

Back up database and Storage consistently. Disable destruction schedules for KEK
versions until retention, litigation hold, NOM-151, and contractual obligations
have been reviewed. A missing KEK can make every dependent document irrecoverable.

## Metrics

Security event rows provide encrypt/decrypt success and failure counts plus KMS
latencies. Labels must remain limited to IDs already governed by backend access;
never attach document content, DEKs, tags, credentials, or PDF base64.
