# Phase 8 network trace analysis

Captured 2026-09-24 from one signed-in owner on `localhost:4028`. A temporary development-only `PerformanceResourceTiming` probe sampled completed browser resources and was removed after capture. It recorded origin class, path, query-key names, status, duration, waiting time, encoded/transfer bytes, and exposed `Server-Timing`; it recorded no query values or response bodies. This is an equivalent partial Network trace, **not** a HAR: cross-origin Supabase encoded bytes and phase timings are unavailable (`0`/not exposed), and DOM paint milestones were not instrumented. One login-to-Inicio sample includes a separate login interaction; counts below start at the Inicio RSC request, not the login page.

| Flow | Core app requests | Supabase requests | Total data/resource entries | App payload (encoded) | App request durations | Middleware session-policy RPCs + direct RPCs |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| Login -> Inicio | 2 | 11 | 15 | 4,823 B | RSC 576 ms; participations 25,105 ms | 2 + 1 |
| Inicio -> Mis Documentos (before metadata fix) | 4 | 9 | 14 | 46,091 B | RSC 2,144 ms; progressive 28,284 ms; metadata 27,337 and 27,671 ms | 4 + 2 |
| Mis Documentos -> Inicio | 2 | 12 | 14 | 4,824 B | RSC 1,080 ms; participations 8,540 ms | 2 + 2 |
| Inicio -> Mis Documentos (after metadata fix) | 3 | 8 | 11 | 37,666 B | RSC 645 ms; progressive 9,675 ms; metadata 8,654 ms | 3 + 1 |

`Total` excludes static assets only when the phase range did not contain them; the last phase had intervening Next.js hot reload assets, excluded from the row. It is **not** a comparable all-resource metric. App payload excludes cross-origin Supabase bodies. The 8,425 B difference between Docs runs is exactly the removed duplicate metadata response. Each transition also made 2 shell notification reads. Docs made 3 `user_view_preferences` reads and 2 `audit_trail` reads; both `audit_trail` calls returned 404 in this local environment (pre-existing code path, not introduced by Phase 8).

## Timing detail

| Request | Client total | Client waiting | Exposed `session_policy` | Exposed `auth_claims` | Encoded bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Inicio RSC, first | 576 ms | 542 ms | 263 ms | 9 ms | 1,550 |
| Inicio participations, first | 25,105 ms | 25,073 ms | 3,121 ms | 4 ms | 3,273 |
| Inicio RSC, return | 1,080 ms | 1,073 ms | 918 ms | 4 ms | 1,551 |
| Inicio participations, return | 8,540 ms | 8,536 ms | 2,789 ms | 11 ms | 3,273 |
| Docs progressive, first | 28,284 ms | 28,227 ms | 205 ms | 9 ms | 27,698 |
| Docs progressive, return | 9,675 ms | not recorded in summary | 447 ms | not recorded in summary | 27,698 |

The page-shell and participation requests start near each other; dashboard layout/subscription, owner documents, and activity queries run in parallel after mount. Docs progressive and metadata started about 63 ms apart in the first Docs transition. The owned stream is written before the participant stream by implementation, but the trace cannot timestamp first owned paint or combined-list completion separately.

## Interpretation and limits

- The two Inicio participation samples differ by 16.6 seconds, and Docs API samples differ by about 18.6 seconds. Local development compilation, browser reconnects, and backend variability contaminate the comparison. With n=2 per page, p50/p95, stable error rates, and performance improvement percentages are **not determined**.
- `Server-Timing` exposed middleware, claims, and session policy. It did not expose SQL/auth subphases of the participation handler in the browser sample, so the remaining wait cannot be assigned reliably to database execution, route authentication, serialization, transport, or dev compilation.
- A read-only RLS-role `EXPLAIN (ANALYZE, BUFFERS)` on the owner participation projection used an index scan, returned 14 rows, and completed in 4.37 ms (534 shared hits). It is a plan sample, not an end-to-end substitute.
- The first Docs transition had **two** `list-metadata` requests. Changing the effect dependency to user ID and sharing only an in-flight promise produced **one** in the next observed transition. The second run also had much shorter total time, but this cannot be attributed to deduplication alone.
- An anonymous direct request to each new Docs API returned HTTP 401. The local server took about 20-26 seconds even for these requests, further evidence of nonrepresentative local latency.
- First useful content, shell paint, first owned paint, combined-list paint, folder/tag paint, and mobile visual timings remain `N/D`; the observer did not capture these milestones.

`PERFORMANCE_IMPROVEMENT=UNPROVEN`. The removed duplicate metadata request is proven; a statistically stable page-speed gain is not.
