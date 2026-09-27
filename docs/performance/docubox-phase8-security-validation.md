# Phase 8 security validation (local, 2026-09-24)

No migration, policy, workspace authorization, middleware, or cryptographic implementation was changed in this phase. The Docs bootstrap still delegates to the two existing authenticated handlers, and the participation handler queries `documentos` with an authenticated client under RLS before mapping the response. The metadata endpoint authenticates its bearer token and filters folders by `owner_id`; its labels behavior is described below.

| Check | Evidence | Result |
| --- | --- | --- |
| Owner session | Signed-in Inicio showed nonzero document/participation counts; Mis Documentos showed owner data | Observed in UI |
| Second user / separate workspace | Signed-in second account had zero Inicio document and participation counts and an empty Mis Documentos list; database membership check showed a different workspace ID | Observed in UI |
| One known owner document under RLS | Read-only transaction with `SET LOCAL ROLE authenticated` and the owner's `auth.uid()` claim returned one row; the same query with the second user's claim returned zero | Passed for one A -> B fixture; SQL simulation is not a full browser/session test |
| Anonymous Docs bootstrap | Direct `/api/documentos/read-bootstrap` without credentials returned 401 | Passed |
| Anonymous list metadata | Direct `/api/documentos/list-metadata` without credentials returned 401 | Passed |
| Direct browser access to owner document as second user | The navigation ultimately redirected to `/login`; no authenticated 403 could be observed | Inconclusive; not counted as cross-tenant pass |
| Participant-only account | No distinct participant-only fixture tested | Not verified |
| Limited workspace member | Second account is a member of another workspace, but has no fixture documents for limited-role ABAC | Not verified |
| Reverse B -> A | Second workspace had no document fixture | Not verified |
| Inactivity, absolute timeout, revoked session | Middleware and policy were not changed; no controlled expiry run in this test | Not verified in runtime |
| Legacy endpoints | Code-level checks retain their authenticated handlers; no full direct runtime matrix | Partial |

## Existing global-label limitation

`public.etiquetas` has no owner or workspace column. It contained 91 rows in the read-only schema check, and its existing authenticated SELECT policies use `true`. `/api/documentos/list-metadata` returns that global catalog (via its current service client) to any authenticated caller. This is not an introduced leak from the in-flight deduplication, but it means the requested guarantee that tenant A cannot receive tenant B's labels **cannot be demonstrated**, and may be false if the catalog contains tenant-specific labels. A tenant-scoped label model and migration would change existing product behavior and is outside this read-path-only phase. Until resolved, do not claim complete tenant metadata isolation.

The existing `authenticated_manage_etiquetas` policy also has `ALL` with `USING (true)`. That is a separate pre-existing authorization concern if labels are intended to be tenant-private; this phase did not relax or modify it.

## Scope of assurance

The owner-document RLS check is a positive/negative control for one row, not proof about every table or access level. Browser checks were performed with two real signed-in accounts, but the direct-document attempt lost its session. No credentials, tokens, or document IDs are stored in this report.

`SECURITY_REGRESSION=NONE` is not marked PASS because the full role/session matrix was not run. `RLS_SEMANTICS_UNCHANGED=true` and `SESSION_POLICY_SEMANTICS_UNCHANGED=true` are supported by the absence of changes in those files, not by exhaustive runtime proof. `CROSS_TENANT_DATA_LEAK=NONE` remains **unverified** due to the global-label design and incomplete bidirectional test.
