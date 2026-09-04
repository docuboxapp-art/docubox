# Document Encryption Audit

Date: 2026-08-29

## Executive status

Docubox currently relies on private Supabase Storage buckets and provider-side
encryption at rest. The application does not yet encrypt document payloads before
upload. A copy of the `documents` bucket together with the database is therefore
sufficient to recover current PDF objects without a separate KMS authorization.

The target property is:

```text
Storage compromise != document compromise
Database + Storage compromise != document compromise without KMS access
```

This audit covers application-level encryption only. It does not change the
cryptographic meaning of PAdES, RFC 3161, NOM-151, e.firma, certificates, or
document hashes.

## Existing encryption

| Area | Current implementation | Reusable | Document coverage |
| --- | --- | --- | --- |
| Identity captures | AES-256-GCM envelope object in `src/lib/identity/capture-crypto.ts` | Algorithm conventions only | No |
| Organization secrets | AES-256-GCM in `src/lib/organization/server.ts` | No; purpose and key lifecycle differ | No |
| Google Cloud authentication | Portable ADC/WIF/native provider in `src/lib/certification/google-cloud-auth.ts` | Yes | Authentication only |
| Google Cloud KMS signing | RSA signing provider in `src/lib/certification/key-management.ts` | Auth/client patterns only | No; signing keys cannot be used as an encryption KEK |
| Storage | Private buckets and RLS/backend checks | Yes | Provider-side encryption only |

The production RSA HSM key is restricted to
`RSA_SIGN_PKCS1_3072_SHA256`. It must remain a signing key. Document envelope
encryption requires a dedicated symmetric Google Cloud KMS CryptoKey with
encrypt/decrypt permissions and independent rotation policy.

## Document write paths

| Flow | Primary files | Current at-rest format | Finding |
| --- | --- | --- | --- |
| Create/send document | `src/app/api/documentos/enviar/route.ts` | Plain upload to `documents` | Uses `upsert: true` and creates a long-lived signed URL |
| Mobile upload | `src/app/api/mobile-upload/submit/route.ts` | Plain upload | Must join the document encryption service before becoming canonical |
| Public Colabora upload | `src/app/api/public/colabora/requests/[token]/upload/route.ts` | Plain upload | Authorized public-token flow but payload remains plaintext |
| Scanner upload | `supabase/functions/scan-and-upload/index.ts` | Plain upload | Edge/Deno runtime needs a compatible encryption boundary |
| Visual signature sealing | `supabase/functions/seal-pdf/index.ts`, `src/app/api/documentos/[documentId]/seal-signatures/route.ts` | Plain PDF input/output | The Next route is the product finalization boundary; Edge legacy path remains a migration item |
| Legacy VPS signing | `supabase/functions/sign-pdf-vps/index.ts` | Plain signed PDF | Deprecated path remains outside the new provider architecture |
| PAdES product integration | `src/lib/certification/product-integration.ts` | Plain visual and final PDF in `documents`; plain certified PDF in `certification-artifacts` | Must decrypt before signing and encrypt every persisted PDF output |
| Certification engine | `src/lib/certification/engine.ts` | Plain certificate PDF, certified PDF and package | Legal hashes are plaintext hashes and must remain unchanged |
| NOM-151 | `src/lib/nom151/service.ts`, `src/app/api/nom151/*` | ASN.1 and related artifacts stored directly | Digest binding must continue to target the logical PDF, not ciphertext |
| Generated evidence | Edge functions under `supabase/functions/*` | Mixed plain PDF/XML/image objects | Requires a second, explicitly staged rollout |

## Read and delivery paths

| Flow | Primary files | Finding |
| --- | --- | --- |
| Authenticated viewer | `src/app/api/documentos/[documentId]/viewer-file/route.ts` | Authorization is performed first, but Storage currently serves plaintext through a signed URL |
| Internal document reuse | `src/lib/documents/internal-source.ts` | Downloads plaintext and verifies SHA-256; suitable place to add authorized decryption |
| Public verification | `src/lib/public-verification/gateway.ts`, `src/app/api/verificacion/documentos/[identifier]/route.ts` | Creates signed URLs to final PDFs; encrypted objects require a controlled decrypting endpoint |
| Certification downloads | `src/lib/certification/engine.ts` and certification API routes | Reads artifacts directly from Storage |
| NOM-151 download | `src/app/api/nom151/download/route.ts` | Reads the stored artifact directly |
| Colabora resources | `src/app/api/public/colabora/rooms/[token]/resources/[resourceId]/route.ts` | Direct Storage download after token authorization |

## Version model

`public.document_versions` exists and already stores the logical SHA-256,
Storage path, MIME type, size, status, and immutable lifecycle information. It
does not contain envelope metadata. The initial send route may skip creation of a
version when the Colabora entitlement is unavailable; that behavior is
incompatible with mandatory per-version encryption and must be separated from
the entitlement check.

A normalized `document_encryption_metadata` table is preferable because it:

- keeps wrapped key material out of general document rows;
- supports one independently encrypted object per document version and artifact;
- permits key rewrap without mutating legal document hashes;
- supports auditing, migration state, and future algorithm versions;
- can be locked to `service_role` while document rows retain existing RLS.

## Temporary files

Production document paths primarily use in-memory buffers. OpenSSL-based test,
bootstrap, and trust-onboarding scripts write to `os.tmpdir()` and remove their
working directories. Any future production library requiring a physical PDF must
use a private temporary directory, restrictive permissions, `finally` cleanup,
and must not log sensitive paths.

## Risks and gaps

1. Current Storage objects can begin with `%PDF-`.
2. Database hashes represent plaintext, but there is no separate ciphertext hash.
3. No DEK/KEK separation exists for documents.
4. Signed URLs can expose stored plaintext without passing through an application
   decryption boundary.
5. Initial versions are not guaranteed for every document.
6. PAdES and certification artifacts are persisted as plaintext between stages.
7. Legacy Edge functions cannot automatically consume the Node KMS provider.
8. Existing encrypted identity captures use a different envelope and must not be
   silently reclassified as document encryption.
9. A KMS outage currently has no document-encryption-specific fail-closed state.

## Implementation plan

1. Add a versioned AES-256-GCM implementation with deterministic AAD over
   tenant, document, version, artifact kind, and encryption version.
2. Add a provider-neutral document KEK interface and a Google Cloud KMS symmetric
   implementation using the existing portable Google authentication provider.
3. Add normalized metadata, append-only security events, and service-role-only
   access policies.
4. Encrypt before upload and decrypt only after authorization in the canonical
   send/viewer paths.
5. Adapt internal reuse and legal processing boundaries to consume plaintext only
   in memory and encrypt persisted outputs.
6. Add audit, COPY/VERIFY/SWITCH/DELETE migration, and KEK rewrap tools.
7. Keep legacy reads behind an explicit feature flag during migration and fail
   closed for new writes when encryption is required.
8. Roll remaining Edge-generated evidence and non-document sensitive assets in a
   separately tested phase rather than silently widening the blast radius.

## Initial rollout boundary

No UI component, layout, label, or interaction is changed. The browser continues
to request the same logical documents. The backend becomes responsible for
authorization, ciphertext retrieval, KMS unwrap, authenticated decryption,
plaintext SHA-256 verification, and no-store delivery.
