# Document Encryption Migration

## Inventory

```powershell
npm run security:audit-document-encryption -- --tenant=<uuid> --limit=100
```

Classifications are `PLAINTEXT`, `ENCRYPTED`, `UNKNOWN`, `CORRUPT`, and `MISSING`.
The audit does not modify objects.

## Controlled migration

```powershell
npm run security:migrate-document-encryption -- --dry-run --tenant=<uuid> --limit=25
npm run security:migrate-document-encryption -- --tenant=<uuid> --limit=25 --resume=<uuid>
```

The implementation follows `COPY -> VERIFY -> SWITCH -> DELETE`:

1. verify the legacy plaintext SHA-256;
2. encrypt to a new version path;
3. decrypt and compare byte for byte;
4. conditionally switch the document row;
5. delete the old plaintext only after the switch succeeds.

Use small batches and retain backups. Keep
`DOCUMENT_LEGACY_DECRYPTION_ALLOWED=true` only during the audited transition.
Turn it off after the audit reports no expected plaintext objects.

The first migration script targets canonical original document objects. Signed,
certified, generated evidence, and legacy Edge-function outputs must be migrated
with artifact-aware batches after their readers are confirmed on the backend
decryption boundary.
