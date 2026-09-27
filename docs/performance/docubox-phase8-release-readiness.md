# Phase 8.2 release readiness (local, 2026-09-24)

**Decision: `READY_FOR_CONTROLLED_DEPLOYMENT=NO`.** No deploy, remote DDL/DCL,
remote fixture, commit, or push was performed. The worktree was already dirty;
unrelated edits were preserved. The two viewer failures are resolved, but the
required staging RLS, full bidirectional cross-tenant, and mobile visual
proofs remain absent.

## Viewer and tests

| Failed test | Expected vs actual | Cause/classification | Resolution and risk |
| --- | --- | --- | --- |
| `viewer keeps the original PDF visible until final evidence is verified` | Expected an unconditional client `!padesBtVerified` check; actual viewer exempts an `additional_access_level` reader from that **client** branch. | `STALE_TEST` after additional-read-access work, not introduced by Phase 8. The server `viewer-file` route still requires `finalDeliverableReady()` and a verified matching final artifact. | Updated the assertion to check both client branches and the server guard. Unauthorized final PDF delivery would be high risk; this source-level check is not a substitute for a live API denial test. |
| `signed document card separates delivery status from technical audit details` | Expected a contiguous auditoría-tab/PAdES expression; actual reordered audit sections contain a nested conditional. | `STALE_TEST` after audit layout reordering, not introduced by Phase 8.1. | Restricted the assertion to the auditoría panel and checked the technical-details guard within it. No UI or certification logic changed. |

The focused viewer file passed **16/16**. The wider Windows Node run passed
**510/514**, 0 failed, 4 skipped. Seven other pre-existing source-shape
assertions initially failed after the additional-access and final-PDF changes;
each was updated only after checking the current guard/permission behavior.
The four Windows skips are OpenSSL-dependent PAdES provider cases (B-B signing,
mutation rejection, B-T timestamping, and B-B-to-B-T upgrade). All four then
passed with real OpenSSL 3.5.5 in Ubuntu/WSL, using a temporary checksum-verified
Node 24.21.0 and the matching Linux esbuild binary outside the repository.
The WSL PAdES file passed **9/9**, 0 skipped. Thus the combined unique relevant
tests have **514 passed, 0 failed, 0 critical skipped**. Database pgTAP tests
were not executed.
`npm run type-check` and `npm run build` both passed (Next.js 16.3.4).

## Tags and migrations

`etiquetas` is `SYSTEM_GLOBAL_CATALOG`: 91 live names matched the 91 seeded
names; there is no tenant key or user-edit UI. Shared authenticated SELECT is
intentional. The live `authenticated_manage_etiquetas` ALL policy and direct
table grants currently permit global writes. The local migration removes that
policy, revokes all PUBLIC/anon/authenticated table privileges, and restores
authenticated SELECT, leaving explicit service-role/postgres grants. Static
tests pass; `supabase/tests/etiquetas_system_catalog_security_contract.sql`
tests SELECT/INSERT/UPDATE/DELETE/anon/admin behavior but has not executed
against staging. The service-role-backed GET route relies
on middleware authentication and merits defense-in-depth review before deploy.

The linked migration history ends at `20260924075503`. These two local files
are absent from that history, in required timestamp order:

| Migration | Change/dependency | Risk, rollback, verification |
| --- | --- | --- |
| `20260924100726_completed_document_additional_access.sql` | Data migration and constraints on `document_access_permissions`; replaces access functions. Depends on the earlier permissions/visibility tables and valid registered grantees. | Explicitly aborts if unresolved permission emails remain; broadens document read semantics only for completed documents. Back up table/functions and test owner/member/participant/additional-reader allow/deny before applying. Rollback requires a reviewed restore of prior functions and grants, not a blind reverse DDL. Not applied/tested in staging. |
| `20260924174932_restrict_system_etiquetas_writes.sql` | Drops authenticated ALL policy and tightens table grants; depends on seeded `etiquetas` table. | Blocks direct shared-catalog mutation by app roles while retaining service-role maintenance. Run pgTAP and real anon/auth/service-role requests after staging apply. Do not restore broad ALL grants/policy as a casual rollback; that reopens cross-tenant mutation. Not applied/tested in staging. |

`MIGRATIONS_STAGING_TEST=UNVERIFIED` until both run in a Supabase Preview Branch
or a separate staging project and the access matrix is verified. The Supabase
connector lists only the linked `databox` project and zero Preview Branches;
there is no approved staging target. No remote migration was applied here.

**Static security review.** The first migration retains the base table's RLS
and `REVOKE ALL` for anon/authenticated; it does not grant direct table access.
Its replacement `has_document_access_permission` permits only a registered
grantee on a completed document at the requested `view/download/evidence`
level. The replacement `can_access_documento` removes the older explicit-ACL
branch from full-row RLS, leaving owner, active custodian manager, and active
participant checks. Additional readers must receive a server-projected view,
not a full `documentos` row. `CREATE OR REPLACE` preserves the prior function
EXECUTE grants; those grants must still be checked in staging. The second
migration changes no tenant key and tightens global-catalog writes. Neither
SQL file adds an obvious cross-tenant read grant, but static review is not a
runtime isolation proof. The first migration can abort on unresolved email
grantees; that is fail-closed. Both rollbacks require a reviewed database
checkpoint and restoration of prior definitions/data, not a blind reversal.

**Exact staging validation after an approved target is available.** Apply the
two files in timestamp order, run the existing 8-assertion pgTAP script at
`supabase/tests/etiquetas_system_catalog_security_contract.sql`, then run
the following read-only checks. Supply synthetic fixture UUIDs for A/B owner,
limited member, participant, and registered additional reader; A must have a
completed granted document and B an unrelated document. Run all role probes
inside a transaction and roll it back.

```sql
SELECT has_table_privilege('authenticated', 'public.document_access_permissions', 'SELECT') AS auth_acl_read,
       has_table_privilege('authenticated', 'public.document_access_permissions', 'INSERT') AS auth_acl_insert,
       has_function_privilege('authenticated', 'public.has_document_access_permission(uuid,text)', 'EXECUTE') AS auth_check,
       has_function_privilege('anon', 'public.has_document_access_permission(uuid,text)', 'EXECUTE') AS anon_check;
-- Expected: false, false, true, false.

SELECT conname FROM pg_constraint
WHERE conrelid = 'public.document_access_permissions'::regclass
  AND conname IN ('document_access_permissions_access_level_check',
                  'document_access_permissions_registered_user_check',
                  'document_access_permissions_no_invitation_check');
-- Expected: all three constraints.

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'owner_a', true);
SELECT set_config('request.jwt.claims',
                  json_build_object('sub', :'owner_a', 'email', :'owner_a_email')::text, true);
SELECT public.can_access_documento(:'doc_a'::uuid) AS own_a,
       public.can_access_documento(:'doc_b'::uuid) AS foreign_b;
-- Expected: true, false. Repeat with owner B, limited members and participants.

SELECT set_config('request.jwt.claim.sub', :'additional_reader_a', true);
SELECT set_config('request.jwt.claims',
                  json_build_object('sub', :'additional_reader_a', 'email', :'additional_reader_a_email')::text, true);
SELECT public.has_document_access_permission(:'doc_a'::uuid, 'view') AS projected_view,
       public.has_document_access_permission(:'doc_a'::uuid, 'download') AS download_level,
       public.has_document_access_permission(:'doc_b'::uuid, 'view') AS foreign_view,
       public.can_access_documento(:'doc_a'::uuid) AS full_row_access;
-- For a view-only A grant: true, false, false, false. Verify the server-projected
-- viewer API permits only the configured capability and denies edits/downloads.
ROLLBACK;
```

For tags the pgTAP expected result is authenticated SELECT allowed and
INSERT/UPDATE/DELETE denied, anon direct access denied, service-role
maintenance allowed, and no authenticated ALL policy. Run staging API probes as
well; a static grant query alone does not prove the request path. None of
these commands was executed against the linked remote project.

## Cross-tenant and audit

The only existing cross-tenant evidence is one A-document RLS allow for A/deny
for B, owner-A UI data, and an empty B workspace. An earlier B browser direct
attempt redirected to login, not an authenticated 403. There is no B-owned
document or participant-only fixture. Docker, Podman, and psql are absent, so
controlled staging fixtures and pgTAP cannot run. Owner/member/participant in
both directions, folders, favorites, tasks, requests, home counts, progressive
and legacy endpoints, and fault-injected fallback remain **unverified**. A
`200 []` is not accepted as an isolation proof. The required response-body
matrix is specified in `../security/docubox-phase8-cross-tenant-validation.md`.
The browser session also expired before a new authenticated visual/API pass;
no account or credential was borrowed to bypass that limit.

The obsolete Mis Documentos `audit_trail` read/subscription is gone by source
inspection. The legal `document_audit_trail` reads in the viewer and activity
API remain. A post-change network proof of zero `audit_trail` 404s and a live
legal-audit read are still pending.

## Session policy, performance, visual

The warm Inicio -> Mis Documentos navigation made 3 protected app requests
(RSC, bootstrap, metadata) plus 2 `true` browser activity RPCs: **5 policy
executions**. The return made 2 protected app requests (RSC, participation)
plus 2 `true` activity RPCs: **4 executions**. The two browser events are the
human click and the later pathname change. A single initial `false` mount
validation was observed; no warm navigation showed a rerender-only `false`
call. Middleware policy timings were 717/752/717 ms for Docs and 1349/822 ms
for Inicio. Local compilation, network variance, and n=1 per direction make
p50/p95, cold/warm paint, TTFB comparison, and speed-improvement claims
unreliable. No authorization check was removed; the remaining double activity
recording was left intact to preserve inactivity semantics. The temporary
measurement code was removed before tests/build.

Desktop Inicio, Mis Documentos, and a completed-document viewer rendered in
the authenticated local browser. The viewer spent tens of seconds in its
loading state before rendering. No comparable PRE screenshots, controlled
mobile viewport, or viewer visual baseline were available. Therefore visual
equivalence cannot be certified. No CSS, layout, copy, navigation, business
flow, or cryptographic implementation was edited in this pass.

`MOBILE_VISUAL_REGRESSION=UNVERIFIED`: there is no valid mobile PRE capture for
the three required routes, and the current authenticated browser session
redirects to login. The remaining check is a same-viewport before/after
comparison for `/inicio`, `/mis-documentos`, and one authorized viewer PDF,
including widgets, list/table, toolbar, tabs, buttons, spacing and responsive
content. A mobile screenshot of the login page would not satisfy this gate.

## OpenSSL closure

All four are in `tests/pades-provider.test.mjs` and are **cryptographic/security
tests**. They were skipped on Windows, then each passed with real OpenSSL in
WSL. The temporary Node archive SHA-256 matched the official Node.js
`SHASUMS256.txt`; the Linux esbuild binary was version `0.28.2`, matching the
repository. No test was replaced by a mock.

| Test (source line) | What it validates | Release impact |
| --- | --- | --- |
| `PAdES-B-B signs a detached CMS with the managed key and verifies ByteRange, CMS and certificate` (199) | Actual CMS signing, PDF ByteRange and certificate verification | Passed in WSL |
| `PAdES verification rejects a post-signature byte mutation and a malformed PDF` (263) | Tamper and malformed-PDF rejection | Passed in WSL |
| `PAdES-B-T embeds and verifies a real RFC 3161 signature timestamp` (349) | TSA timestamp embedding and verification | Passed in WSL |
| `PAdES-B-T upgrades an already verified B-B without signing the document again` (380) | Safe B-B-to-B-T upgrade | Passed in WSL |

`OPENSSL_SKIPPED_TESTS=RESOLVED`. The complete PAdES file passed 9/9 with 0
skipped in WSL. Only disposable Linux tooling under the user's WSL cache was
used; no repository dependency or production environment was changed.

## Gate flags

| Flag | Result |
| --- | --- |
| `VIEWER_TESTS` | `PASS` |
| `MIGRATIONS_STAGING_TEST` | `UNVERIFIED` |
| `SESSION_POLICY_REDUNDANCY` | `PARTIAL` |
| `SESSION_POLICY_SEMANTICS_UNCHANGED` | `true` |
| `TAG_SECURITY_MODEL` | `SYSTEM_GLOBAL_CATALOG` |
| `TAG_WRITE_RESTRICTIONS` | `UNVERIFIED` |
| `TAG_MIGRATION_READY` | `NO` (not tested in staging) |
| `CROSS_TENANT_DATA_LEAK` | `UNVERIFIED` |
| `RLS_SEMANTICS_UNCHANGED` | `unverified` |
| `SECURITY_REGRESSION` | `UNVERIFIED` |
| `VISUAL_REGRESSION` | `UNVERIFIED` |
| `MOBILE_VISUAL_REGRESSION` | `UNVERIFIED` |
| `OPENSSL_SKIPPED_TESTS` | `RESOLVED` |
| `BUSINESS_PROCESS_REGRESSION` | `NONE` for this pass (no flow code edits); end-to-end unverified |
| `CRYPTOGRAPHIC_SEMANTICS_UNCHANGED` | `true` for this pass (no crypto code edits) |
| `TYPECHECK` | `PASS` |
| `PRODUCTION_BUILD` | `PASS` |
| `LOCAL_PERFORMANCE_IMPROVEMENT` | `UNPROVEN` |
| `READY_FOR_CONTROLLED_DEPLOYMENT` | `NO` |

**Exact remaining blockers:** (1) connect a Supabase Preview Branch or a
separate staging project with permissions to apply the two pending migrations
and create synthetic Auth/workspace/document fixtures; only there run the
tag/permission RLS and bidirectional owner/member/participant API/body/count
matrix, including progressive fallback and viewer; (2) obtain a reliable
pre-Phase-8 mobile reference and an authenticated staging/mobile session for
`/inicio`, `/mis-documentos`, and `/visor-documento/[id]`, then compare the
three views at the same viewport. These checks are not authorization to deploy.
No session-policy optimization was made.
