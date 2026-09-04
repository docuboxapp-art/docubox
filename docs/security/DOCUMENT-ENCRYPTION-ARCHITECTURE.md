# Document Encryption Architecture

## Cryptographic boundary

Each persisted document version is encrypted independently:

```text
plaintext bytes -> SHA-256 -> random 32-byte DEK -> AES-256-GCM
DEK + deterministic AAD -> Google Cloud KMS symmetric encrypt -> wrapped DEK
ciphertext -> private Storage
wrapped DEK + nonce + tag + hashes -> backend-only PostgreSQL metadata
```

The PAdES RSA/HSM signing key is not used as a KEK. Envelope encryption uses a
dedicated `GOOGLE_SYMMETRIC_ENCRYPTION` CryptoKey. Both providers reuse the
portable Google authentication layer, but their IAM permissions and rotation
lifecycles remain separate.

## AAD format

AAD is UTF-8 JSON with fixed insertion order:

```json
{"schema":"docubox.document-encryption-aad","version":1,"tenant_id":"...","document_id":"...","document_version_id":"...","artifact_kind":"document"}
```

It binds ciphertext and wrapped DEK to one tenant, document, version, artifact
role, and encryption version. Swapping any of those values causes KMS unwrap or
AES-GCM authentication to fail.

## Storage contract

Encrypted objects use `application/octet-stream`. Logical filename and MIME type
live in `document_encryption_metadata`. Browser delivery always crosses a backend
authorization endpoint. Legal hashes remain hashes of the plaintext logical
document; `ciphertext_sha256` is stored separately.

## Legal operations

PAdES, RFC 3161 and NOM-151 receive verified plaintext bytes in memory. Their
outputs are encrypted as new artifacts before persistence. Ciphertext is never
substituted for the legal document digest, CMS input, ByteRange, or MessageImprint.

## Runtime limitation

Node.js cannot guarantee physical erasure from managed-runtime memory. The
implementation minimizes lifetimes and calls `fill(0)` on DEK and owned buffers
where practical, without claiming cryptographic RAM erasure.
