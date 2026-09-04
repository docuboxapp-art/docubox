# Document Encryption Key Rotation

KEK rotation does not require PDF re-encryption:

```text
wrapped DEK (old KEK) -> authorized unwrap -> wrap with new KEK -> atomic metadata update
```

Run `npm run security:rewrap-document-keys -- --dry-run` first. Configure
`DOCUMENT_ENCRYPTION_OLD_KMS_KEY_RESOURCE` and
`DOCUMENT_ENCRYPTION_NEW_KMS_KEY_RESOURCE`, then run in bounded batches with
`--limit=`. Keep the old key enabled until every row has been verified with the
new provider and backups have completed.

The Storage ciphertext and both plaintext/ciphertext hashes remain unchanged.
Every successful update appends `DOCUMENT_KEY_ROTATED`.

Full decrypt/new-DEK/re-encrypt is reserved for algorithm changes or incident
response and requires a separate, approved migration plan.
