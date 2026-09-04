# Pre-encryption schema snapshot

Captured read-only from Supabase project `kbjejiclhgjmiasauxyr` on
2026-08-30. No production object was modified while capturing this snapshot.

## Scope

This snapshot covers only objects affected by
`20260829232609_document_encryption_metadata.sql`:

- legacy `public.document_encryption_metadata`;
- dependent legacy view `public.v_documents_missing_participant_deks`;
- `public.document_participant_deks.trg_sync_dek_counts`;
- the legacy participant-DEK helper functions;
- `public.prevent_frozen_document_version_mutation()`;
- related indexes, constraints, policies, RLS flags, ownership, and grants.

## Production observations

- PostgreSQL: `17.6` on `aarch64-unknown-linux-gnu`, 64-bit.
- Database size: `126 MB`.
- `document_encryption_metadata` rows: `0`.
- `document_participant_deks` rows: `0`.
- `document_encryption_security_events`: absent.
- Migration `20260829232609` in `supabase_migrations.schema_migrations`: absent.
- Legacy metadata table owner: `postgres`.
- Legacy metadata table: RLS enabled, not forced.
- Legacy metadata table ACL: owner `postgres`; `anon`, `authenticated`, and
  `service_role` had all table privileges.
- The legacy diagnostic view was backend-only: owner `postgres`; ACL for
  `postgres` and `service_role` only; comment was
  `Backend-only diagnostic view for participant DEK coverage. Never exposed to client roles.`

## Dependency finding

`v_documents_missing_participant_deks` depends on legacy-only columns
(`encrypted_dek`, `iv_or_nonce`, `sha256_original`, `sha256_ciphertext`,
`key_version`, `uses_per_participant_deks`, and `participant_deks_count`).
The prepared migration cannot drop the legacy table while this view exists.
The migration therefore explicitly drops this dependent legacy view without
`CASCADE`. Its exact definition is in `LEGACY-OBJECTS.sql` and is restored by
`../ROLLBACK-DOCUMENT-ENCRYPTION-SCHEMA.sql`.

## Files

- `LEGACY-OBJECTS.sql`: exact definitions and metadata needed for the scoped
  rollback.
- `CATALOG-QUERIES.sql`: read-only catalog queries used for the capture.
- `../ROLLBACK-DOCUMENT-ENCRYPTION-SCHEMA.sql`: rollback guarded against
  non-empty new encryption metadata/events.
