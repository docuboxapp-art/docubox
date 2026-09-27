# Phase 8 baseline

Date: 2026-09-24. See [request graph](docubox-phase8-request-graph-before.md).

| Metric | Before | Source / limitation |
| --- | ---: | --- |
| `/inicio` app requests on cold load | at least 2 | static core graph; not HAR |
| `/mis-documentos` app requests on cold load | at least 5 | static core graph; not HAR |
| `session_policy` executions per cold navigation | at least 2 / 5 respectively | middleware path count, excluding retries |
| `session_policy` calls project-wide | 21,401 | `pg_stat_statements` snapshot |
| `session_policy` mean / max DB execution | 179.2 / 7,378.3 ms | pooled SQL statistic, not network latency |
| authenticated TTFB, p50, p95, p99 | N/D | browser inspection did not expose request timings |
| `/inicio` wall-clock reload to visible dashboard | 2,525 / 3,356 / 3,155 ms | signed-in local browser, 3 sequential samples |
| `/mis-documentos` wall-clock reload to visible row | 11,604 / 4,558 / 3,522 ms | signed-in local browser, 3 sequential samples; first includes warm-up |
| JSON bytes, errors, DB connections | N/D | no authenticated trace available |

User-reported slow requests are retained in the request-graph document, not treated as a controlled benchmark. Browser timing is end-to-end wall-clock, not TTFB; it includes development-server and DOM-inspection overhead. No credentials were extracted, private HAR captured, or production load test run.
