# Phase 8.1 cross-tenant validation matrix (2026-09-24)

The available real fixture has an owner in workspace A with documents, and a
member in workspace B with no documents. Prior UI checks showed owner data for
A and an empty list and zero counters for B. A read-only SQL RLS-role test of
one known A document returned 1 row for A and 0 for B. Direct browser access
as B redirected to login, so that attempt **does not** prove an authenticated
403. There is no B document or participant-only account fixture. No synthetic
production data was created.

`Observed` means a specific test was run; `unverified` does not imply allow or
deny. The intended matrix is allow within authorized scope and deny across
tenant boundaries, except explicitly granted document participation.

| Resource | A -> A | A -> B | B -> B | B -> A | Evidence/limit |
| --- | --- | --- | --- | --- | --- |
| Documents | Observed owner allow | Unverified (no B document) | Empty fixture only | One-row RLS deny observed; browser direct denial unverified | Prior SQL/UI trace |
| Participations | Owner UI counts observed | Unverified | Zero fixture only | Unverified | No participant-only fixture |
| Folders | Unverified | Unverified | Unverified | Unverified | Metadata handler filters owner ID; runtime matrix absent |
| Tags | Shared catalog by design | Shared catalog by design | Shared catalog by design | Shared catalog by design | 91 system labels, not tenant labels |
| Favorites | Unverified | Unverified | Unverified | Unverified | No two-tenant fixture |
| Tasks | Unverified | Unverified | Unverified | Unverified | No two-tenant fixture |
| Requests | Unverified | Unverified | Unverified | Unverified | No two-tenant fixture |
| Inicio widgets/counts | Owner counts observed | Unverified | Zero fixture only | Unverified | Zero is not a denial proof |
| Docs list metadata | Owner folders + global tags observed | Unverified | Empty-folder + global-tag fixture | Unverified | Folder authorization by owner ID reviewed in code |

The Docs bootstrap delegates to the existing owned and participation handlers;
their independent authorization is preserved. Legacy fallbacks remain protected
by middleware and handler checks. Neither participant role nor membership may
be inferred from the other. No page authorization was reused as API
authorization. Complete closure needs controlled A/B owner, member, and
participant fixtures; direct authenticated allow/deny API checks; and matching
positive/negative RLS tests for each resource, including counts and metadata.

The `audit_trail` 404s were unrelated to tenant isolation. Mis Documentos
referenced a nonexistent `audit_trail` table in an unused activity effect and
Realtime subscription. The live schema contains `document_audit_trail`, which
the document visor still uses for legal audit. The dead Docs read/subscription
was removed; no legal audit writer, table, or viewer behavior was changed.
The prior two 404s per Docs run have no request retry in that effect, but did
add failed network calls and a subscription attempt. A new runtime trace is
needed to confirm zero 404s after the edit.

`CROSS_TENANT_DATA_LEAK=UNVERIFIED`; the narrow A-document RLS check passed,
but the required role/resource matrix is incomplete. `SECURITY_REGRESSION`
and business-flow regression remain unverified until the runtime matrix runs.

## Release-readiness execution limit

The connected Supabase account exposes only the linked `databox` project and
zero Preview Branches; no separate staging project is available. In this pass
we stopped before any remote fixture or migration operation, as required. The
available B account
has no B-owned document, folder, favorites, task, or request fixture. Owner B,
limited members A/B, participant-only A/B, reverse document access, dashboard
aggregate isolation, progressive endpoints, and fallback fault-injection all
remain unverified. A `200 []` for B is not treated as a cross-tenant denial
proof. The exact closure is to run the matrix above with synthetic fixtures
in a Supabase Preview Branch or separate staging project, including response-body
IDs, titles, counts, folder names, and metadata, not just status codes.

## Required fixture/role inventory for closure

Create these fixtures only in Supabase Preview/staging, never in the linked
project. The existing owner-A account and empty B workspace are not
enough to close the matrix.

| Actor | Authorized positive case | Negative case still missing |
| --- | --- | --- |
| Owner A and Owner B | Own document, folder, favorite, task, request, metadata and Inicio counts | The other tenant's records and aggregates |
| Limited Member A and Member B | Only records granted by current workspace RBAC/ABAC | Other workspace and ungranted same-workspace document |
| Participant A and Participant B | Their assigned document and participation | Other same-workspace documents and every private record of the other tenant |

For **each** actor, inspect documents, participations, folders, favorites,
tasks, requests, list metadata, Inicio widgets/counts, `read-bootstrap`,
`list-metadata`, and legacy fallback. Record status **and** response-body IDs,
names, titles, counts, folder names, and metadata. Fault-inject a progressive
bootstrap failure and confirm fallback is bounded and independently
authorized. The prior redirect to login is not an authenticated denial proof.
None of these full bidirectional checks ran in this pass:
`CROSS_TENANT_DATA_LEAK=UNVERIFIED`.
