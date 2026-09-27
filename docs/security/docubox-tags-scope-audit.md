# Phase 8.1 label scope and RLS audit (2026-09-24)

**Current model: `SYSTEM_GLOBAL_CATALOG`.** The `etiquetas` migration seeds 91
fixed rows; the linked database has exactly 91 rows, all with the same original
seed timestamp, and the sorted live names exactly match the sorted seed names.
There is no `workspace_id`, `organization_id`, `owner_id`, or
`created_by` column, and no UI/API write path to `etiquetas` was found. The
current names are catalog categories, not evidence of tenant-created labels.
Only 6 documents in one workspace currently reference catalog IDs; that usage
does not make the labels private to that workspace.

Usage audit: creation is migration seed only; direct reads occur in
`/api/documentos/etiquetas`, `/api/documentos/list-metadata`, document obtain,
participation requests, and the template creator. Documents and templates
store selected IDs in `etiquetas_ids`; Mis Documentos filters and renders those
IDs through the shared catalog. No catalog edit/delete or tenant-owned label
creation path was found. `document_metaetiquetas` is a different, per-document
entity and must not be conflated with the system catalog.

The live table currently has three policies: two authenticated SELECT `true`
policies and `authenticated_manage_etiquetas` (`ALL`, `USING(true)`,
`WITH CHECK(true)`). This means any authenticated user can currently mutate
shared labels if table grants allow it. The local migration
`20260924174932_restrict_system_etiquetas_writes.sql` removes only that ALL
policy and revokes all table privileges from PUBLIC, anon, and authenticated,
then restores authenticated SELECT. Explicit service-role and migration-owner
grants remain. It is **not applied remotely**. The direct
`/api/documentos/etiquetas` endpoint also uses service role; the existing
middleware protects the endpoint but the route does not separately check a
user token. That defense-in-depth gap remains to be reviewed before deployment.

There is no tenant-label A/B test to perform under this global catalog: both
tenants intentionally receive the same 91 system labels. A future feature for
custom labels would require an explicit product decision (`HYBRID` versus
workspace-only) and a separate owner/workspace key, policy, migration, API
filter, and two-tenant tests. Do not silently interpret these 91 labels as
tenant-private or claim tenant-private tag isolation.

`TAG_SECURITY_MODEL=SYSTEM_GLOBAL_CATALOG` for the implemented product.
`TAG_RLS_STATUS=PENDING` until the local migration is applied and verified in
the target database; no runtime RLS test on the new policy has occurred.
`supabase/tests/etiquetas_system_catalog_security_contract.sql` covers the
expected grant/policy matrix but has not run against a Preview Branch or
separate staging project. The connected Supabase account exposes only the
linked `databox` project and zero Preview Branches. The migration is therefore
not verified for release; `TAG_WRITE_RESTRICTIONS=UNVERIFIED`.

## Controlled staging validation to run later

1. Provision/connect a Supabase Preview Branch or a separate staging project
   with permissions to apply migrations and create synthetic test users/data.
   Apply migrations through `20260924174932` in timestamp order there only.
2. Run the SQL in
   `supabase/tests/etiquetas_system_catalog_security_contract.sql` and confirm
   all 8 assertions pass.
   Expected grants: authenticated `SELECT=true`, `INSERT/UPDATE/DELETE=false`;
   anon `SELECT/INSERT=false`; service role `INSERT/UPDATE/DELETE=true`.
3. Confirm an authenticated direct API request can read all 91 seed labels but
   cannot insert, update or delete any; confirm service-role maintenance of a
   test row in a rolled-back transaction. Check `pg_policies` retains
   authenticated SELECT but not `authenticated_manage_etiquetas` ALL.

The pgTAP SQL is prepared but **not executed**. RLS remains enabled; the
migration only tightens grants/policy, preserves explicit service-role/postgres
grants, and adds no tenant key. A rollback should restore a reviewed database
checkpoint, not reinstate the unsafe authenticated ALL grant/policy.
