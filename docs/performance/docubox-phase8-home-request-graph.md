# Phase 8: authenticated Inicio request graph

Measured on 2026-09-24 against the local Next.js development server on port 4028. The trace is `PerformanceResourceTiming` plus `Server-Timing`, not a full HAR. URL query **keys** were retained; values, tokens, document identifiers, and response bodies were not recorded. Cross-origin Supabase payload and wait phases are hidden by Resource Timing restrictions.

## Actual path

1. `/inicio?_rsc`: Next middleware runs claims and `enforce_docubox_session_policy` before the page renders.
2. `AuthContext` also calls `/rest/v1/rpc/enforce_docubox_session_policy` directly. The shell loads notification count (`Sidebar`) and notification list (`TopNav`) separately.
3. `DocumentsDashboardPage` starts `user_profiles.dashboard_layout` and `subscriptions` concurrently. It also starts two shared document reads concurrently: a direct, RLS-protected `documentos` owner query and `/api/documentos/mis-participaciones?view=dashboard`.
4. The four document widgets (`estado_documentos`, `estado_participaciones`, `sugeridos`, `sin_revision`) derive their views from those same two datasets. They make no independent network requests.
5. `VerificationProgressBar` concurrently reads `user_profiles.phone` and `user_verification_status`; it may subsequently reconcile verification data, including reads from `enrollment_results` and writes. This is not a pure bootstrap read.
6. `ActivityAuditLog` concurrently reads three distinct `documentos` scopes: latest owned lifecycle rows, non-owned participation rows, and workspace expiration alerts.
7. The workspace shell may read `workspace_members` and `organization_entitlements` during a cold authentication. Those did not appear in the two warm Inicio transitions and are not included in the warm counts.

| Widget / shell | Source and exact fields | Needed vs excess | Session policy |
| --- | --- | --- | --- |
| Document status, participation status, suggestions, unreviewed | Shared owner `documentos`: `id,nombre,estado,fecha_vencimiento,created_at,participantes,owner_id,es_urgente`; shared participant API response: ID, name, status, priority, received/expires time, own signature status | Owner JSONB `participantes` is needed for current counters; participant API fetches full JSONB server-side but sends a reduced dashboard DTO | API gets middleware policy and authenticated RLS; direct owner read uses browser auth/RLS, not middleware |
| Available documents and plan | `subscriptions`: `documents_used,documents_limit,plan_id,subscription_plans(name)` | Selected fields are used for plan and quota | Browser Supabase auth/RLS |
| Layout | `user_profiles.dashboard_layout` | Used to preserve widget configuration | Browser Supabase auth/RLS |
| Activity log | `documentos` owner: `id,nombre,estado,created_at,updated_at,ultimo_paso` (30); non-owner: `id,nombre,participantes,updated_at` (20); workspace alerts: `id,nombre,fecha_vencimiento,estado` | `ultimo_paso` is selected but not consumed. Queries have different scopes/limits from dashboard datasets, so replacing them with the shared owner read would alter visible history | Browser Supabase auth/RLS; workspace filter for alerts |
| Verification banner | `user_profiles.phone`, `user_verification_status.*`; conditional `enrollment_results(id,created_at)` | `*` is broader than the rendered status, but this path can reconcile/write verification status and was left untouched | Browser Supabase auth/RLS |
| Notifications (shell) | Sidebar `notifications` count; TopNav `notifications` list | Two independent reads of the same table but different projections and component lifecycles | Browser Supabase auth/RLS |
| Quick actions | Static links | No read | None |

## Observed warm transitions

`total` includes resource entries, not only data calls. App-core requests are the protected page and API requests. Direct Supabase RPC calls are counted separately.

| Transition | App-core | Supabase resources | Direct session-policy RPC | App-core encoded bytes | Notable duration |
| --- | ---: | ---: | ---: | ---: | --- |
| Login to Inicio, owner | 2 | 11 | 1 | 4,823 | page 576 ms; participation API 25,105 ms |
| Docs to Inicio, owner | 2 | 12 | 2 | 4,824 | page 1,080 ms; participation API 8,540 ms |

Both Inicio paths made four direct `documentos` reads: shared owner dataset plus three ActivityAuditLog scopes. They also made two `notifications` reads and two different `user_profiles` projections. No per-widget document-request fan-out was found. The two timings are noisy development samples, not p50/p95 or evidence of a speedup.

## Bootstrap decision

`OPTIMIZATION_REJECTED_LOW_VALUE`: no `/api/inicio/bootstrap` or `get_home_bootstrap()` was added. The four core document widgets already share one owner query and one participant API. A new API would remove at most one direct owner round trip from this core pair while adding server auth/serialization and retaining the separate shell, verification, and activity scopes. It would not make the *whole page* one protected operation. Verification can write, and activity queries have different semantics. A single service-role aggregate would be especially inappropriate for RLS isolation.

The observed long waits are not explained by the RLS document scan alone: a read-only owner-role `EXPLAIN (ANALYZE, BUFFERS)` of the dashboard participation projection returned 14 rows with an index scan, 534 shared hits, and 4.37 ms execution time. This one SQL plan does not reproduce the full PostgREST/auth/session path. No index or read model was added without stronger evidence.
