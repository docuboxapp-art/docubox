# Phase 8.1 session-policy request map (2026-09-24)

This map was written before changing session code. It describes the signed-in
`/inicio` and `/mis-documentos` local traces in `docubox-phase8-har-analysis.md`.
Counts are requests, not SQL subqueries. A click, route change, and React rerender
can overlap, so direct browser RPC counts vary.

| # | Route/request | Origin | Class and reason | Necessary? | Remove? |
| --- | --- | --- | --- | --- | --- |
| 1 | `GET /inicio` RSC | Next navigation -> `src/middleware.ts` | `NAVIGATION_AUTH`: fresh claims and session-policy check for the protected page | Yes | No |
| 2 | `GET /api/documentos/mis-participaciones` | Inicio dashboard -> middleware | `API_AUTHORIZATION`: the API must be independently protected | Yes | No |
| 3 | `GET /mis-documentos` RSC | Next navigation -> middleware | `NAVIGATION_AUTH` | Yes | No |
| 4 | `GET /api/documentos/read-bootstrap` | Docs list -> middleware | `API_AUTHORIZATION`: consolidated owned and participation data | Yes | No |
| 5 | `GET /api/documentos/list-metadata` | Docs filters/folders -> middleware | `API_AUTHORIZATION`: independently protected metadata | Yes | No |
| 6 | `POST /rest/v1/rpc/enforce_docubox_session_policy` (`false`) | `AuthProvider` -> `useSessionTimeout` mount effect | `SESSION_EXPIRY`: establishes browser warning/sign-out deadlines; not server authorization | Yes on mount | No |
| 7 | Same RPC (`true`) | Human pointer/key/touch/popstate or pathname-change recorder, 1 s debounce | `USER_ACTIVITY_RECORD`: extends deadline only for intentional activity | Yes | No |
| 8 | Same RPC (`false`) | `AuthProvider` rerender -> new inline callback identities -> `scheduleTimers`/`synchronizePolicy`/effect change | `REDUNDANT_VALIDATION`: same browser policy query without changed authentication or user activity | No | Yes, stabilize callback identities |

The first Inicio trace had 2 middleware RPCs and 1 direct RPC; the return trace
had 2 + 2. The first Docs trace had 4 middleware RPCs (including duplicate
metadata) and 2 direct RPCs; after metadata dedup it had 3 + 1. Exact direct
RPC attribution cannot be recovered from the prior resource-only trace because
it did not record the `p_record_user_activity` request body or React effect
origin. Rows 6-8 are therefore code-proven causes, not per-request HAR labels.

`getClaims(accessToken)` in middleware verifies identity before the policy RPC.
`getSession()` in the client retrieves a bearer token but is not treated as
server authorization; Docs APIs independently verify it with `getUser(token)`.
`AuthContext.getUser()` is an explicit helper, not the initial session read.
The TopNav `getUser()` call belongs to the workspace selector interaction, not
the initial dashboard request graph. No fresh API, critical operation, or
middleware policy check should be removed or cached.

## RPC internals and index audit

The currently checked-in policy (`20260924002434_super_admin_fifteen_minute_inactivity.sql`)
reads `auth.sessions` by session ID and user ID, `auth.users` by ID,
`platform_staff` by user ID, `platform_roles` by ID, then
`docubox_session_activity` by session ID and user ID. A `false` call normally
reads activity without a row lock; an expiry path rechecks under lock and
records a security event once. A `true` call locks and updates activity.
The 15/30-minute inactivity and 4/8-hour absolute rules were not changed.
Relevant live indexes already exist: `auth.sessions_pkey`, `auth.users_pkey`,
`platform_staff_pkey`, `platform_roles_pkey`, and
`docubox_session_activity_pkey`. The additional activity `(user_id,
last_user_activity_at DESC)` index is not needed for the session-ID lookup.
No index was added. A read-only `EXPLAIN (ANALYZE, BUFFERS)` of the activity
lookup used `docubox_session_activity_pkey`, returned one row, and took 4.041 ms
total with 6 index-scan shared hits. This is **not** a full RPC timing or an
`EXPLAIN` of the security-definer function under a real JWT.

Prior browser middleware samples exposed session-policy durations of 263,
3,121, 918, and 2,789 ms on Inicio requests, with other Docs values in the
network trace. Local development variability and tiny sample size preclude
defensible p50/p95 or a stable PostgreSQL-vs-network breakdown. The callback
stabilization removes a code-proven rerender cause; a fresh POST measurement
is required to quantify navigational reduction. No cache of authorization or
change to expiry, revocation, retries, or fail-closed behavior was introduced.

## POST browser trace (authenticated local navigation)

A temporary development-only probe recorded the argument passed to each
browser RPC and Resource Timing entries; it was removed before typecheck and
build. A warm `/inicio` -> `/mis-documentos` click generated 3 protected app
requests and 2 direct browser RPCs (5 policy executions). A return click
generated 2 protected app requests and 2 direct browser RPCs (4 executions).
All observed requests returned HTTP 200. The initial browser mount generated
one `false` validation. Neither warm navigation generated a new `false` call.

| # | Navigation/request | Origin/type | Necessary reason | Observed session-policy ms |
| --- | --- | --- | --- | ---: |
| 1 | Docs RSC | middleware / `NAVIGATION_AUTH` | Protect page navigation | 717 |
| 2 | Docs `read-bootstrap` | middleware / `API_AUTHORIZATION` | API directly callable | 752 |
| 3 | Docs `list-metadata` | middleware / `API_AUTHORIZATION` | API directly callable | 717 |
| 4 | Docs browser RPC `true` | click / `USER_ACTIVITY` | Records pointer action | 569 total RPC duration |
| 5 | Docs browser RPC `true` | pathname / `USER_ACTIVITY` | Preserves existing route-activity rule | 374 total RPC duration |
| 6 | Inicio RSC | middleware / `NAVIGATION_AUTH` | Protect page navigation | 1349 |
| 7 | Inicio `mis-participaciones` | middleware / `API_AUTHORIZATION` | API directly callable | 822 |
| 8 | Inicio browser RPC `true` | click / `USER_ACTIVITY` | Records pointer action | 580 total RPC duration |
| 9 | Inicio browser RPC `true` | pathname / `USER_ACTIVITY` | Preserves existing route-activity rule | 3680 total RPC duration |

The Docs middleware totals were 749/783/734 ms and auth-claims times were
28/28/16 ms. Inicio middleware totals were 1373/843 ms and auth-claims times
were 19/19 ms. The two `true` calls on one navigation occur 2-3 seconds apart
because the click and completed route transition are distinct recorded events.
Collapsing them might change the established inactivity deadline, so it was
not done in this release-readiness pass. No polling, prefetch, or background
fetch was marked as user activity. The tiny, noisy localhost sample does not
support p50/p95 or a page-speed improvement claim. The rerender-only `false`
cause is removed, but navigational activity duplication remains a possible
future optimization; `SESSION_POLICY_REDUNDANCY=PARTIAL`.

## Fallback request bound

The Docs progressive bootstrap calls two independently authorized handlers
inside one request. If the stream fails, the client starts at most two legacy
fallback requests, one per unresolved part. `fetchDocumentData` can retry each
request twice on transient session/schema-cache failures. The maximum logical
app request count in this failure path is therefore higher than the normal
three-request Docs path, but bounded; each retry is still checked in
middleware. This was reviewed in code, not fault-injected in a browser.
