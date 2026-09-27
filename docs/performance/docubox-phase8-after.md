# Phase 8 local after snapshot

Date: 2026-09-24. Phase 8A audited the read path. A first incremental Phase 8C change now merges the initial folders and labels into one authenticated metadata route and streams owned documents plus participations through one protected bootstrap request. The old independent APIs remain callable with their existing checks and serve as transport-error fallbacks.

| Metric | Local after observation |
| --- | --- |
| `/mis-documentos` warm core app requests | at least 3 by static path: page, read-bootstrap, list-metadata |
| Session policy on those core requests | at least 3, down from at least 5 by path design; not HAR-counted |
| Reload to visible row and folder | 7,464 / 3,540 / 3,287 ms, three local samples after warm-up |
| `/inicio` | unchanged in this stage |
| TTFB, request bytes, p50/p95, DB subphase timings | N/D; browser inspection lacks HAR/Resource Timing |

The read-bootstrap invokes the original authenticated/RLS list handlers inside one server request and emits each result as it finishes. The client still paints owned documents before awaiting participation enrichment. Metadata authenticates the Bearer token with `getUser`, scopes folders by owner ID, and returns only the existing global label fields. Both new routes are `private, no-store` for successful responses. No session-policy cache or SQL migration was added.

The next gate is an actual authenticated HAR/`Server-Timing` trace plus representative owner/participant/other-tenant security checks. The read-only harness `node scripts/measure-phase8-read-path.mjs` remains available with `DOCUBOX_PHASE8_BEARER_TOKEN` supplied externally; never extract a token from the browser. It defaults to localhost and requires explicit opt-in for remote targets.

No SQL migration, cache, read model, privilege change, session timeout change, or production deployment was performed. Desktop and mobile DOM smoke checks rendered the document list; the mobile visual check has no pre-change screenshot for pixel comparison.

Later on 2026-09-24, an authenticated partial Resource Timing trace observed 4 core requests on the first Docs navigation because `list-metadata` ran twice. An in-flight-only, user-keyed deduplication reduced the next observed navigation to 3 core requests and removed one 8,425 B encoded response. This does not establish a latency percentage. The updated measurements and security limitations are in `docubox-phase8-har-analysis.md` and `docubox-phase8-security-validation.md`.
