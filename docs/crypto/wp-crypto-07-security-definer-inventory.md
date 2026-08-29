# WP-CRYPTO-07 privileged function inventory

## Scope

This inventory covers every `SECURITY DEFINER` occurrence currently declared by
the repository's Supabase migrations: 108 declarations across 38 migrations.
The migration list is the source-controlled inventory; the SQL below is the
authoritative runtime inventory and must be run after deployment because a
database may also contain manually created functions.

| Group | Migration families | Required control |
| --- | --- | --- |
| Workspace, registration and subscription | `20260323181212_workspaces.sql`, `20260323230000_enrollment_results.sql`, `20260324090000_user_registration_workspace_subscription.sql`, `2026042416*.sql`, `20260424170000_update_subscription_function.sql`, `20260514231000_extend_setup_function_full_profile.sql` | Fixed `search_path`, explicit execute grants, caller scope by `auth.uid()` |
| Documents, participation, evidence and forms | `202603260*.sql`, `2026033008*.sql`, `202604060*.sql`, `202604262*.sql`, `2026050*.sql`, `2026051*.sql`, `20260518040000_xml_generation_queue.sql`, `20260519120000_participation_order_schema.sql` | Document/workspace authorization and immutable artifact paths |
| Case files and public verification | `20260803010000_expedientes_digitales.sql`, `2026080802*.sql`, `20260808040000_public_verification_center.sql`, `20260808120000_security_integrity_hardening.sql` | Tenant filtering, public access limited to explicit public artifacts |
| Organization governance | `2026081512*.sql`, `2026081516*.sql`, `2026081519*.sql`, `2026081522*.sql`, `2026081523*.sql`, `2026081601*.sql`, `2026081603*.sql`, `2026081605*.sql`, `2026081610*.sql` | Active-member and role checks, no credential fallback |
| Colabora | `2026081611*.sql`, `2026081617*.sql`, `2026081618*.sql`, `2026081619*.sql`, `2026081622*.sql` | Tenant entitlement checks and least-privilege execution |
| Certification | `20260805010000_cryptographic_certification_engine.sql`, `20260817192825_crypto_foundation_truthful_certification.sql`, `202608211*.sql` | Exact version binding, certification tenant scope and append-only artifacts |

`20260821210000_wp_crypto_07_security_hardening.sql` applies a fixed
`search_path = pg_catalog, public` to every current `public` SECURITY DEFINER
function. It also revokes the default `PUBLIC` execute permission from the RLS
helpers and grants them only to `authenticated` and `service_role`.

## Runtime inventory query

Run this in the Supabase SQL editor after each deployment and attach the CSV to
the release record. It reports identity, owner, fixed search path and role
execution rights without exposing function bodies or secrets.

```sql
select
  n.nspname as schema_name,
  p.oid::regprocedure as function_identity,
  pg_get_userbyid(p.proowner) as owner,
  coalesce(array_to_string(p.proconfig, ', '), '') as function_config,
  has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'execute') as service_role_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.prosecdef
  and n.nspname not in ('pg_catalog', 'information_schema')
order by n.nspname, p.oid::regprocedure::text;
```

Pass criteria for a new privileged function:

1. It has `search_path=pg_catalog, public` or another fixed, reviewed path.
2. Its owner is approved and it has no `PUBLIC` execute grant unless it is
   explicitly public by product design.
3. It enforces tenant membership internally or only operates on rows protected
   by an equivalent RLS policy.
4. It has an authorization and cross-tenant regression test.

## Service role register

`service_role` bypasses RLS. It is only allowed in backend or Edge Function
code where the function validates an authenticated principal and a scoped
document/workspace before performing the privileged action. The crypto routes
covered in this package are `seal-pdf` and `sign-pdf-vps`.

| Route | Why service role is needed | Required guard |
| --- | --- | --- |
| `seal-pdf` | Read private source bytes and create one sealed artifact | Authenticated owner/admin authorization, source document lookup, DB-owned storage path, immutable destination |
| `sign-pdf-vps` | Read sealed bytes and store the legacy signature response | Authenticated participant match, derived signer identity, workspace-required path, immutable destination |

Never use `SUPABASE_SERVICE_ROLE_KEY` as encryption material, a frontend
variable, or a fallback for another secret.
`ORGANIZATION_CREDENTIAL_ENCRYPTION_KEY` is a dedicated backend secret.

## Release verification

1. Apply the WP-07 migration.
2. Run the runtime inventory query and verify fixed `search_path` and execute
   privileges.
3. Use two test users in different workspaces: a user must not read another
   workspace's `document_certifications`, manifests, manifest items or
   timestamp records.
4. Confirm a non-participant receives `SIGNER_NOT_AUTHORIZED` from
   `sign-pdf-vps`; a mismatched browser signer identity receives
   `SIGNER_IDENTITY_MISMATCH`.
5. Seal/sign a test document once, then repeat it and expect
   `SEALED_PDF_EXISTS` or `SIGNED_PDF_EXISTS` without replacing bytes.
6. Set `DOCUBOX_ALLOWED_ORIGINS` in production and confirm a foreign Origin
   receives a rejected preflight.
