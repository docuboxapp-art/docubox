# Docubox Hot Routes: Comparison

Date: 2026-09-09

| Area | Before | After | Evidence |
| --- | --- | --- | --- |
| Normal session-policy read | Unconditional row lock | Read-only except expiry race | latest SQL migration and regression test |
| Middleware diagnosis | Total duration only | Total, claims, and session-policy duration | `Server-Timing` / structured slow log |
| Viewer time to request PDF | Waited on 4 sequential metadata queries | Waits on the same 4 queries concurrently | viewer bootstrap source and regression test |
| `/inicio` duplicate document requests | Existing widgets share in-flight requests | Unchanged | existing `login-dashboard-bootstrap` test |
| `/mis-documentos` list waterfall | Existing lists start in parallel | Unchanged | existing performance regression test |

| Metric | Before | After | Improvement |
| --- | ---: | ---: | --- |
| Middleware p50 | N/D | N/D | pending controlled trace |
| Middleware p95 | N/D | N/D | pending controlled trace |
| `/inicio` authenticated TTFB | N/D | N/D | pending controlled trace |
| `/mis-documentos` authenticated TTFB | N/D | N/D | pending controlled trace |
| Viewer shell | N/D | N/D | pending controlled trace |
| First PDF page | N/D | N/D | pending controlled trace |
| Redundant complete PDF fetches | N/D | N/D | pending browser trace |

`PERFORMANCE_CHANGE_REQUIRES_PRODUCT_DECISION`: storage-level partial PDF streaming would require
changing the encrypted-document framing/integrity contract. It was intentionally not implemented.
