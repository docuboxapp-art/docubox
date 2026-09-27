# Phase 8 PRE/POST comparison (local, 2026-09-24)

`PRE` means the code path before this turn's in-flight metadata fix unless otherwise noted. The original pre-bootstrap Docs request count is from the prior code graph, not a saved HAR. `N/D` means no defensible measurement. Details: [home graph](docubox-phase8-home-request-graph.md), [network trace](docubox-phase8-har-analysis.md), [security validation](docubox-phase8-security-validation.md).

| Metric | PRE | POST | Result |
| --- | --- | --- | --- |
| Inicio protected app requests | 2 core by code | 2 observed in each owner transition | Unchanged; no new home bootstrap |
| Inicio API requests | 1 participation API | 1 observed | Unchanged |
| Inicio session-policy executions | 2 middleware + 1-2 direct browser RPCs observed | Same code; 3 and 4 total across two samples | No proven reduction |
| Home bootstrap p50 | Not implemented | Not implemented | N/A, rejected as low value |
| Home bootstrap p95 | Not implemented | Not implemented | N/A |
| Inicio first useful content | N/D | N/D | Paint milestone not captured |
| Docs protected app requests | >=5 original code path; 4 in first trace due duplicate metadata | 3 in second trace | One observed duplicate metadata request removed; original 5 -> 3 is code-path comparison |
| Docs session-policy executions | 4 middleware + 2 direct RPCs in first trace | 3 middleware + 1 direct RPC in second trace | Reduced in observed navigation, not a latency claim |
| First owned docs | N/D | N/D | Progressive order preserved by code; paint not timestamped |
| Docs complete initial state | N/D | N/D | Not timestamped |
| Inicio payload | 4,823/4,824 B core app samples; Supabase payload N/D | No home code change | Unchanged within measurement precision |
| Docs payload | 46,091 B core app sample with duplicate; Supabase payload N/D | 37,666 B core app sample | 8,425 B duplicate response removed; full-page payload N/D |
| Error rate | N/D | Core app requests observed 200; two pre-existing `audit_trail` calls returned 404 per Docs run | Full error rate N/D |

The local participation API took 25.1 and 8.5 seconds; the Docs progressive request took 28.3 and 9.7 seconds. The variance, Next development build activity, and n=2 per route make percentages and p50/p95 unreliable. A read-only RLS-role SQL plan for the participation projection completed in 4.37 ms, so one simple document scan is not evidence for a new index or materialized read model. `PERFORMANCE_IMPROVEMENT=UNPROVEN`; the **request deduplication** itself is proven by the trace.

## Decisions

- `PRIVATE_SWR_CACHE_RECOMMENDED=NO` for this phase. The dashboard already has a 15-second user-keyed document cache and realtime invalidation. Repeat-navigation data is too sparse to justify another private cache; cached data must never authorize access.
- `CONTROLLED_PREFETCH_RECOMMENDED=NO`. The participation API was expensive and variable in local traces; prefetch could increase traffic before showing a verified benefit.
- `HOME_READ_MODEL_REQUIRED=NO`. Four document widgets already share two datasets, and the sampled RLS document plan was fast. No evidence supports a new table or RPC.
- `OPTIMIZATION_REJECTED_LOW_VALUE`: one monolithic Inicio bootstrap would combine different auth, verification, shell, and activity lifecycles without a measured benefit.

## Verification and phase gate

- Focused Node tests: 72 passed, 0 failed. `npx tsc --noEmit` passed. `npm run build` passed (Next.js 16.3.4). Login route on restarted dev server returned 200 and rendered without an error overlay.
- Anonymous new Docs APIs returned 401. Owner and second-workspace UI checks plus one positive/negative RLS SQL fixture were run. Participant-only, limited workspace member, reverse-tenant, session expiry/revocation, and authenticated direct denial remain unverified.
- No visual components, CSS, layouts, loaders, or navigation were edited. The temporary measurement component was removed. Desktop/mobile before-after screenshots were not obtained, so `VISUAL_REGRESSION=NONE` is not marked PASS.
- No migration, Supabase deployment, Vercel deployment, commit, or push was made. The existing dirty worktree includes unrelated changes and an untracked migration; this phase added none and did not verify that migration's production status.

## Final flags

| Flag | Assessment |
| --- | --- |
| `SECURITY_REGRESSION=NONE` | Unverified full matrix; no security code changed in this turn |
| `RLS_SEMANTICS_UNCHANGED=true` | Code/schema unchanged in this turn; one RLS fixture tested |
| `CROSS_TENANT_DATA_LEAK=NONE` | **Not established**: global `etiquetas` catalog has no tenant key; bidirectional fixture missing |
| `SESSION_POLICY_SEMANTICS_UNCHANGED=true` | Middleware and policy unchanged in this turn; 72 focused tests passed |
| `BUSINESS_PROCESS_REGRESSION=NONE` | Unverified end-to-end; no business flow code changed |
| `VISUAL_REGRESSION=NONE` | Unverified screenshot comparison; no UI code changed |
| `CRYPTOGRAPHIC_SEMANTICS_UNCHANGED=true` | No cryptographic code changed in this turn |
| `PHASE_5_REGRESSION=NONE` | Unverified full regression suite |
| `STATELESS_APP_LAYER=true` | Server remains stateless; metadata dedup is browser-side in-flight only |
| `PERFORMANCE_IMPROVEMENT` | `UNPROVEN` for page speed; one duplicate request removal proven |

## Phase 8.1 session/security closure addendum (local, 2026-09-24)

The exact request classification is in
`docubox-phase8-session-policy-audit.md`. A rerender-triggered browser
`enforce_docubox_session_policy(false)` was eliminated by stabilizing the
`AuthProvider` timeout callbacks. The page and each API still receive fresh
middleware checks; activity recording and browser expiry checks remain.
The earlier trace did not include RPC arguments. A temporary POST probe now
classified the warm navigation calls and was removed before final checks:

| Route | PRE observed | POST measured | Code-level expectation |
| --- | --- | --- | --- |
| Inicio | 3 and 4 total executions in two prior transitions | 4: 2 middleware + 2 `true` activity calls | No rerender-only `false` call |
| Mis Documentos | 6 before metadata dedup, 4 after in prior transitions | 5: 3 middleware + 2 `true` activity calls | Three protected app requests; no rerender-only `false` call |

Both `true` calls are triggered by a human click and the resulting pathname
change; their timestamps were 2-3 seconds apart in this sample. Removing the
second could change the existing inactivity deadline, so no semantic change
was made. This is **not** an acceptance target of one validation. No p50/p95
or end-to-end speed gain is claimed.

The `audit_trail` 404 cause was the unused Mis Documentos effect querying a
table absent from the live schema. It and its unused Realtime subscription were
removed. `document_audit_trail` used by legal audit was untouched. A source
search confirms no `audit_trail` read in Mis Documentos; a fresh network trace
is still required to prove zero 404s at runtime.

The 91 `etiquetas` rows are the shared system seed. A local-only migration
`20260924174932_restrict_system_etiquetas_writes.sql` removes broad
authenticated writes while preserving shared SELECT. Remote RLS is unchanged
until the migration is deliberately deployed and verified. See
`../security/docubox-tags-scope-audit.md` and
`../security/docubox-phase8-cross-tenant-validation.md` for the model and
incomplete A/B matrix.

Release-readiness recheck: the two viewer expectations were updated after
checking the server final-deliverable guard and the reordered audit markup.
The expanded relevant Node run now has 510 pass, 0 fail, 4 skip (514 total).
`npm run type-check` passed; build outcome is recorded in the separate
release-readiness report. Desktop `/inicio`, `/mis-documentos`, and the viewer
rendered in the authenticated local browser, but comparable PRE/mobile
captures were unavailable. No remote migration, commit, push, or deployment
was performed.

| Flag | Phase 8.1 result |
| --- | --- |
| `SESSION_POLICY_REDUNDANCY` | `PARTIAL`: rerender cause removed; click plus route activity still makes two legitimate `true` calls per navigation |
| `SESSION_POLICY_SEMANTICS_UNCHANGED` | `true` by code/test review; no timeout or middleware change |
| `TAG_SECURITY_MODEL` | `SYSTEM_GLOBAL_CATALOG` |
| `TAG_RLS_STATUS` | `PENDING` local migration not applied/tested remotely |
| `CROSS_TENANT_DATA_LEAK` | `UNVERIFIED` full role/resource fixture absent |
| `SECURITY_REGRESSION` | `UNVERIFIED` full cross-tenant runtime matrix absent |
| `VISUAL_REGRESSION` | `UNVERIFIED` no comparable mobile/PRE captures |
| `BUSINESS_PROCESS_REGRESSION` | `NONE` for this test-only/migration-readiness pass; end-to-end flow matrix still unverified |
| `CRYPTOGRAPHIC_SEMANTICS_UNCHANGED` | `true` no crypto implementation edited in Phase 8.1 |
| `PERFORMANCE_IMPROVEMENT` | `UNPROVEN` without comparable POST timings |

**Deployment gate:** apply and test pending migrations in a controlled local
database, run the bidirectional owner/member/participant tenant matrix and
mobile visual comparison, and verify the runtime `audit_trail` 404 is gone.
The separate release-readiness report is authoritative for the final gate.
Phase 9 was not started.
