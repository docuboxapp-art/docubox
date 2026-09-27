# Phase 8 request budget

| Path | Before: core app requests | Before: policy executions | Target | After (measured) |
| --- | ---: | ---: | --- | --- |
| `/inicio` | >=2 | >=2 | Page + minimal shared data | 2 core app requests observed; 2 middleware and 1-2 direct browser policy RPCs |
| `/mis-documentos` | >=5 originally | >=5 originally | Page + progressive stream + metadata | 3 core app requests observed after the metadata deduplication; 3 middleware and 1 direct browser policy RPC in that run |

The page request itself remains protected. The Docs path uses two distinct data requests because the progressive document stream and supporting metadata resolve independently. Independent APIs retain their validation. Direct browser-to-Supabase requests use JWT/RLS and are tracked separately. Counts exclude on-demand sections, realtime, retries, and browser/static assets. The partial browser trace proves request counts and the removed duplicate payload, not a stable latency reduction; see `docubox-phase8-har-analysis.md`.
