# Pre-encryption backup report

## Final status

`BACKUP_NOT_VERIFIED`

The mandatory backup/restore preflight stopped before any production access or
backup operation because the required local container runtime is unavailable.
No production DDL, data mutation, Storage mutation, migration repair, `db push`,
Vercel deployment, or encryption migration was executed.

## Required report

| Item | Result | Evidence |
| --- | --- | --- |
| 1. Date | PASS | `2026-08-30T02:59:28.108Z` |
| 2. Project ref | PASS | `kbjejiclhgjmiasauxyr` |
| 3. PostgreSQL version | NOT EXECUTED | Remote query intentionally skipped after the mandatory Docker preflight failed. The previously observed remote version was `PostgreSQL 17.6`, but it is not presented as a result of this run. |
| 4. Database size | NOT EXECUTED | Remote query intentionally skipped after the mandatory Docker preflight failed. |
| 5. Backup method | BLOCKED | Planned method: Supabase CLI logical dumps for roles, schema, and data, plus byte-for-byte Storage object copies, followed by restoration to a disposable Supabase project. |
| 6. Roles backup | FAIL | `roles.sql` was not generated. |
| 7. Schema backup | FAIL | `schema.sql` was not generated. |
| 8. Data backup | FAIL | `data.sql` was not generated. |
| 9. Backup hashes | FAIL | There are no dump files to hash. `BACKUP-MANIFEST.json` was not created because no backup exists. |
| 10. Storage objects expected | NOT REVALIDATED | Known baseline: 13 objects (`12 PLAINTEXT`, `1 CORRUPT`). No production query was run in this attempt. |
| 11. Storage objects backed up | FAIL | 0 objects copied. |
| 12. Storage hashes | FAIL | No backup copies exist to hash or compare. |
| 13. Restore target | FAIL | No disposable Supabase restore project was selected or modified. |
| 14. Restore | FAIL | Not attempted; no restorable dump exists. |
| 15. Structure validation | FAIL | No restored database exists for comparison. |
| 16. Row-count validation | FAIL | No restored database exists for source/restore comparison. |
| 17. Corrupt object preserved | PASS | Production object was not read, changed, repaired, migrated, overwritten, or deleted. No backup copy was created, so byte-for-byte backup preservation remains unverified. |
| 18. Final state | FAIL | `BACKUP_NOT_VERIFIED` |

## Preflight evidence

| Check | Result | Detail |
| --- | --- | --- |
| `docker --version` | FAIL | PowerShell reports that `docker` is not recognized. |
| `docker info` | FAIL | PowerShell reports that `docker` is not recognized; daemon status cannot be queried. |
| Docker Desktop executable | FAIL | Not found in the standard Program Files or Local AppData locations. |
| Docker Windows service | FAIL | No Docker service is registered. |
| Docker Desktop installation registry entry | FAIL | No Docker Desktop uninstall entry was found. |
| WSL | FAIL | Windows reports that Windows Subsystem for Linux is not installed. |
| Podman fallback | FAIL | `podman` is not installed. |
| `supabase --version` | PASS | Supabase CLI `2.116.0`. |

## Exact blocker

Docker Desktop and its daemon are unavailable. On this host, installation also
requires enabling/installing WSL 2 (or configuring another Docker-compatible
container backend). The requested process explicitly requires stopping at this
condition, so dump generation, Storage download, disposable-project restore,
schema comparison, and row-count comparison were not started.

## Production invariants

- Production was not queried during this attempt.
- Production PostgreSQL and Storage were not modified.
- No credentials, database passwords, service-role keys, tokens, or KMS
  material were written to disk or documentation.
- No local `backups/` directory was created, so `.gitignore` did not require a
  new entry.
- The prior platform backup observation remains: `backups = null`,
  `pitr_enabled = false`, and no recoverable physical backup was demonstrated.

## Resume gate

Resume this work package only after `docker --version` succeeds and
`docker info` confirms an operational daemon. A successful run must still
generate non-empty logical dumps, hash all artifacts, copy and hash all Storage
objects, restore into a disposable isolated project, and compare critical
structure and row counts before the final status may change to
`BACKUP_RESTORE_VERIFIED`.

References:

- Supabase database backups: https://supabase.com/docs/guides/platform/backups
- Supabase CLI database dump: https://supabase.com/docs/reference/cli/supabase-db-dump
