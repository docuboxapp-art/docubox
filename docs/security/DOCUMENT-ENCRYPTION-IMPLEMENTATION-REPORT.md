# DOCUMENT ENCRYPTION IMPLEMENTATION REPORT

Date: 2026-08-30

Status: **IMPLEMENTED_PENDING_PRODUCTION_E2E**. The schema activation and the
real Supabase Storage + Google Cloud KMS HSM encryption E2E now pass. PAdES,
RFC 3161, NOM-151, constancias, deployment, and legacy migration remain separate
gates and are not claimed here until their real E2Es pass.

## Activation update (2026-08-30)

This section supersedes the earlier preflight statements below where they say
that the schema was not applied. The earlier abort is retained as historical
evidence.

- Risk decision: `PRODUCTION_CHANGE_WITHOUT_VERIFIED_BACKUP`; `risk_accepted=true`;
  `scope=document_encryption_schema_only`. Supabase reported no verified
  restorable backup (`backups=null`, PITR disabled).
- Precheck inside the DDL transaction: `document_encryption_metadata` rows = 0.
- Applied source: `supabase/migrations/20260829232609_document_encryption_metadata.sql`.
  Applied SHA-256: `AADB603C401A9371852FEED6152F735FB0E46F0621D148519740E3F1503FE519`.
- Transaction result: PASS. Migration history was not modified. The dependency
  view was dropped before replacing the empty legacy metadata table; the legacy
  `trg_sync_dek_counts` trigger was removed.
- Post-apply schema: `document_encryption_metadata` and
  `document_encryption_security_events` exist with RLS enabled, no authenticated
  or anonymous grants, and backend `service_role` access only. No forbidden
  plaintext key or credential columns exist.
- Encryption security advisors: 0 encryption-related WARN findings. Two expected
  INFO findings remain for backend-only RLS tables without user-facing policies.
- Storage configuration: private `documents` now accepts
  `application/octet-stream`, required for ciphertext uploads.
- Production E2E: `DOCUMENT ENCRYPTION PRODUCTION E2E VERIFIED`. A real
  Supabase Storage object was uploaded through AES-256-GCM envelope encryption
  and Google Cloud KMS HSM, direct Storage bytes did not begin with `%PDF-`,
  authorized decryption matched the original SHA-256, and altered ciphertext,
  nonce, AAD, wrapped DEK, and KMS resource were rejected.
- Legacy audit: 12 plaintext objects, 1 corrupt object, 0 encrypted objects
  before migration. The corrupt object remains untouched and quarantined.
- Regression: full suite 135/135 PASS, type-check PASS, directed lint PASS, and
  production build PASS with 213 generated pages. No legacy document was migrated.
- Production deploy: Vercel deployment `dpl_276SaupLKqmFDm16Q4QJdKQ75pkM` is
  `Ready` at `https://docubox-delta.vercel.app`. Public login smoke returned 200;
  protected dashboard/listing and internal health routes remained protected.

The artifact runner reuses an existing document/version and cleans only its
temporary Storage object and metadata. Append-only security events remain as
auditable evidence. The final product status therefore remains
`IMPLEMENTED_PENDING_PRODUCTION_E2E`, and backup status remains
`DISASTER_RECOVERY_BACKUP_PENDING`.

## 1. Previous state

Canonical original, visual, PAdES, certification, and NOM-151 objects were stored
as plaintext application payloads in private Supabase buckets. Storage privacy did
not provide separation between a bucket/database compromise and document content.

## 2. Vulnerabilities found

- PDF objects could begin with `%PDF-`.
- Long-lived signed URLs existed in document send/reuse paths.
- Browser-side replacement uploaded directly and requested a public URL.
- Plaintext and ciphertext hashes were not separated.
- There was no per-version DEK, wrapped key, contextual AAD, or KMS unwrap boundary.
- PAdES and NOM-151 artifacts were persisted directly after generation.
- Legacy Edge and temporary upload paths remain outside the canonical Node backend.

See `DOCUMENT-ENCRYPTION-AUDIT.md` for the complete inventory.

## 3. Architecture implemented

The backend now has a provider-neutral envelope encryption layer under
`src/lib/crypto/document-encryption`. It generates a random 32-byte DEK per
persisted object/version, encrypts with AES-256-GCM, wraps the DEK through a
dedicated symmetric KMS provider, uploads only ciphertext, and stores normalized
metadata separately.

## 4. Files modified

Primary integration points:

- canonical send and version creation;
- authenticated viewer and internal reuse;
- backend-only file replacement from the existing viewer modal;
- visual signing/PAdES input and persisted PDF outputs;
- certification artifacts and authenticated/public verification reads;
- NOM-151 PAdES input, ASN.1 persistence, and download;
- public document verification delivery.

No component layout, CSS, label, modal, or visible interaction was redesigned.

## 5. Migration created

`20260829232609_document_encryption_metadata.sql` creates:

- `document_encryption_metadata` with service-role-only access;
- append-only `document_encryption_security_events`;
- indexes and RLS;
- a narrowly constrained frozen-version path switch for verified migrations.

The checkout is linked to project ref `kbjejiclhgjmiasauxyr`, which matches the
configured Supabase URL. The migration is **not applied**. A read-only
reconciliation captured PostgreSQL 17.6, 225 migration files currently present,
199 files tracked by Git, and 25 remote migration-history entries. The 25 remote
files now present are diagnostic copies fetched from Supabase and remain
untracked. No `db push` or migration-history repair was performed.

The 25 authoritative remote migration files were fetched for diagnosis. Twenty-
three are SQL-equivalent to local files with different timestamps; the remaining
two belong to migration sequences whose later remote migrations complete the
effective changes. A second dry-run still refuses to continue because the
historical local versions are not registered remotely. Applying with
`--include-all` would replay the full schema history and is not safe.

The fail-closed classification contains 0 `APPLIED_BUT_UNTRACKED`, 1
`ACTUALLY_PENDING`, 25 `SUPERSEDED`, 25 `REMOTE_ONLY`, and 174 `UNKNOWN`. The
local replay and restorable `pg_dump` are blocked because this host has neither
Docker nor Podman. The CLI security advisor also reports 195 warnings, including
86 authenticated and 76 anonymous `SECURITY DEFINER` execution findings plus 29
mutable `search_path` findings. No DDL was issued to change them. Full evidence
is under `docs/security/supabase-reconciliation/`.

Remote inspection also found an empty, legacy `document_encryption_metadata`
table with an incompatible schema and authenticated write policies. The target
migration now replaces that legacy table only when it is empty and otherwise
fails closed. `document_encryption_security_events` is not present remotely.

A later direct-schema preflight was aborted before DDL. The corrected atomic
precheck confirms that the legacy table contains zero rows, but Supabase listed
no recoverable physical backup (`backups=null`, PITR disabled). The legacy table
also grants all table privileges to `anon` and `authenticated`, while two related
`SECURITY DEFINER` functions remain executable by both roles. No schema, data,
migration history, Storage object, or deployment was changed. Evidence is recorded in
`supabase-reconciliation/DOCUMENT-ENCRYPTION-DIRECT-SCHEMA-APPLY.md`.

## 6. KMS provider

Implemented: Google Cloud KMS symmetric provider using the existing portable
Google auth abstraction. The provider supports injected clients and therefore is
not coupled to Vercel.

Created and verified external resource:

`projects/project-702d9de4-d29c-49f2-82c/locations/us-east1/keyRings/docubox-pades-prod/cryptoKeys/docubox-document-kek`

It has purpose `ENCRYPT_DECRYPT`, algorithm `GOOGLE_SYMMETRIC_ENCRYPTION`,
primary version `1` enabled, and protection level `HSM`.

Read-only inspection of `docubox-pades-prod` found only:

- `docubox-pades` - `ASYMMETRIC_SIGN`;
- `docubox-pades-production-signing` - `ASYMMETRIC_SIGN`.

Neither was reused as a document KEK. The production runtime identity is
`docubox-pades-prod-signer@project-702d9de4-d29c-49f2-82c.iam.gserviceaccount.com`.
It has key-scoped `roles/cloudkms.cryptoKeyEncrypterDecrypter` plus read-only
`roles/cloudkms.viewer`, which is required to validate live key metadata.

A real provider call generated a random 32-byte DEK, wrapped it with KMS,
unwrapped it, and verified byte equality. Result:
`DOCUMENT_KEK_KMS_E2E_VERIFIED`. A deliberately invalid key resource failed
closed with `DOCUMENT_KEY_WRAP_FAILED`.

Vercel Production now has the backend-only references
`DOCUMENT_ENCRYPTION_KMS_PROVIDER`, `DOCUMENT_ENCRYPTION_KMS_KEY_RESOURCE`, and
`DOCUMENT_ENCRYPTION_KMS_PROTECTION_LEVEL`. No deployment was performed. The
runtime policy forces mandatory encryption whenever `VERCEL_ENV=production`, so
deploying this tree is itself the activation point and must wait for the database
migration and Storage E2E.

## 7. Algorithm

`AES-256-GCM`, encryption version `1`.

## 8. DEKs

Each encryption call generates 32 cryptographically random bytes. Plaintext DEKs
are not returned to callers or persisted. Owned buffers are overwritten after use
where practical, without claiming guaranteed managed-runtime RAM erasure.

## 9. Nonces

Each encryption call generates a random 12-byte nonce. Tests verify that repeated
encryption of identical bytes produces different DEKs, nonces, and ciphertext.

## 10. Authentication tags

AES-GCM uses a 16-byte tag. A modified tag, nonce, ciphertext, or AAD fails closed.
Tags are backend-only metadata and are never returned to the UI.

## 11. AAD

Deterministic UTF-8 JSON binds schema, encryption version, tenant, document,
document version, and artifact kind. KMS wrapping and AES-GCM both use the same
AAD, preventing cross-tenant/document/version swapping.

## 12. Storage

New encrypted paths use `payload.enc`, `visual.enc`, `pades-bb.enc`, or
`pades-bt.enc` where the product path supports it. Ciphertext is uploaded with
`application/octet-stream` and `upsert: false`. Original MIME/name remain in
backend metadata.

## 13. Downloads and preview

Authorization occurs first. Backend then loads ciphertext and metadata, checks
ciphertext SHA-256, unwraps the DEK, authenticates/decrypts, checks plaintext
size/SHA-256, and returns `private, no-store`. The authenticated PDF viewer keeps
range support. Public delivery rechecks `completed + public` before decryption.

## 14. PAdES

PAdES continues to sign logical PDF bytes in memory. Visual, certified B-B, and
B-T PDFs are encrypted only after generation/verification. ByteRange, CMS, X.509,
SPKI binding, and PDF hashes were not redefined.

## 15. NOM-151

Nubarium receives the verified plaintext PAdES-B-T bytes. The document digest
remains the logical PDF SHA-256. The returned ASN.1 artifact is encrypted before
Storage when the feature is enabled. Provider, parser, trust, and verification
semantics were not modified.

## 16. RFC 3161

MessageImprint, token, serial, policy OID, and chain validation remain unchanged.
Persisted TSA artifacts are routed through the encryption boundary in the
certification engine/product upgrade path.

## 17. Audit and metrics

Append-only events cover encryption/decryption success and failure, integrity,
unwrap failure, legacy access, views/downloads, and key rotation. Metrics include
encrypt/decrypt and KMS wrap/unwrap latency without confidential labels.

## 18. Legacy migration

`audit-document-encryption.ts` classifies objects. The migration script supports
`--dry-run`, `--tenant`, `--document`, `--limit`, and `--resume`, and implements
`COPY -> VERIFY -> SWITCH -> DELETE` for canonical original documents.

Existing signed/certified artifacts and Edge-generated evidence require bounded,
artifact-aware migration batches after deployment verification.

The real read-only inventory currently contains 7 documents and 13 Storage
objects: 12 `PLAINTEXT`, 1 `CORRUPT`, 0 `ENCRYPTED`, and 0 migrated. The corrupt
object is a plaintext PDF whose stored SHA-256 does not match its registered
logical hash; it must be investigated before any migration attempt.

## 19. Key rotation

`rewrap-document-keys.ts` unwraps with the old KEK, wraps with the new KEK, and
atomically updates only wrapped-key metadata. Document ciphertext and legal hashes
remain unchanged.

## 20. Tests

- New encryption tests: **11/11 PASS**.
- Complete repository suite: **135/135 PASS**.
- Wrong DEK, nonce, tag, ciphertext, AAD, empty file, 8 MiB file, unique DEK/nonce,
  injected Google client, and rewrap are covered.

## 21. Storage `%PDF-` evidence

Automated in-memory proof: ciphertext does not start with `%PDF-` and decrypts
byte-for-byte to the original PDF.

Real Supabase Storage proof is **pending** because the metadata migration cannot
be pushed safely while migration histories diverge. The symmetric KMS HSM key is
available and its real wrap/unwrap path passes. This report therefore does not
claim the requested Storage upload/download E2E.

## 22. Typecheck

PASS (`tsc --noEmit` and production build TypeScript phase).

## 23. Lint

New encryption modules, scripts, tests, and routes: PASS with zero warnings.

The repository-wide directed lint over historical edited files remains noisy due
to pre-existing formatting/CRLF and explicit-`any` debt; no bulk formatting or
unrelated refactor was performed.

## 24. Build

PASS (`next build --webpack`, 213 pages generated).

## 25. Remaining risks

- Mobile upload staging, public Colabora request files, scanner Edge output,
  legacy `seal-pdf`/`sign-pdf-vps`, form artifacts, biometric/session media, and
  some generated evidence remain a documented second phase.
- Existing objects remain plaintext until audited migration executes.
- Encrypted metadata loss or KEK destruction can make objects unrecoverable.
- The new HSM KEK does not yet have an automatic rotation schedule; define the
  production cadence before rollout rather than inventing it during bootstrap.
- Whole-buffer encryption is currently used; streaming/chunked encryption should
  be evaluated for files above current application limits.

## 26. External configuration required

1. Keep the 174 `UNKNOWN` migration-history entries in the separate
   `SUPABASE-MIGRATION-HISTORY-HARDENING` work package; they are not a prerequisite
   for the surgical encryption-schema operation.
2. Establish and verify a recoverable PostgreSQL backup or restore point.
3. Stop concurrent writes to the legacy metadata table and confirm a stable row
   count of zero inside the direct-apply transaction.
4. Apply only `20260829232609_document_encryption_metadata.sql` directly, without
   `db push` or migration repair.
5. Start with `DOCUMENT_LEGACY_DECRYPTION_ALLOWED=true` during migration.
6. Run a real Storage upload/download/PAdES/TSA/NOM-151 E2E.
7. Confirm no expected object starts with `%PDF-`, then enable mandatory writes
   and proceed with bounded legacy migration.

Current legacy counts: detected `13`, migrated `0`, pending `13` (including one
integrity mismatch that must not be migrated automatically).

## 27. Completion assertion

The KMS prerequisite is complete and independently verified. The end-to-end
property is not yet operationally proven in Supabase because the direct schema
operation was stopped by unavailable backup evidence. The corrected legacy-table
precheck is zero, and migration-history hardening remains separate. Current exact state:
`IMPLEMENTED_PENDING_PRODUCTION_E2E`.
