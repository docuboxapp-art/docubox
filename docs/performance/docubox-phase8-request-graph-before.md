# Phase 8A request graph (before)

Date: 2026-09-24. Source: pre-change code audit, user-provided production timings, and a read-only `pg_stat_statements` snapshot. An authenticated browser session became available later in the day, but its inspection API did not expose HAR or Resource Timing. Counts below are *expected cold-load paths*, not measured network counts. Optional widgets, retries, realtime updates, and route changes add requests.

## `/inicio`

| Request / lookup | Origin | Session policy | Auth | DB / payload | Dependency |
| --- | --- | --- | --- | --- | --- |
| `GET /inicio` | navigation | once in middleware | `getClaims` | HTML/RSC, unknown bytes | first |
| `GET /api/documentos/mis-participaciones?view=dashboard` | `fetchDashboardParticipations` | once in middleware | `getUser` in handler | RLS document query; summary JSON, unknown bytes | auth context |
| `documentos` owned | `fetchDashboardOwnedDocuments` | no app middleware (Supabase direct) | browser JWT/RLS | 8 selected fields plus participant JSON; unbounded rows | auth context |
| `user_profiles.dashboard_layout`, `subscriptions` | dashboard page | no app middleware | browser JWT/RLS | 2 parallel lookups | auth context |
| `user_profiles.phone`, `user_verification_status`, possible `enrollment_results` | `VerificationProgressBar` | no app middleware | browser JWT/RLS | verification state; may trigger existing reconciliation writes | auth context |
| `notifications` | sidebar | no app middleware | browser JWT/RLS | unread summary | auth context |
| `audit_trail` | activity widget, if mounted | no app middleware | browser JWT/RLS | activity | widget mount |
| `workspace_members`, `organization_entitlements` | workspace context | no app middleware | browser JWT/RLS | workspace state | auth context |

Core cold navigation: **at least 2** app requests, `getClaims` x2 and `session_policy` x2. The dashboard participation handler adds `getUser` x1. Browser AuthContext calls `getSession` on initialization; `getUser` may run on refresh/sign-in. Direct Supabase lookups have their own RLS evaluation but do not run the app middleware. Middleware times and payload bytes for this navigation are **N/D**.

## `/mis-documentos`

| Request / lookup | Origin | Session policy | Auth | DB / payload | Dependency |
| --- | --- | --- | --- | --- | --- |
| `GET /mis-documentos` | navigation | once | `getClaims` | HTML/RSC, unknown bytes | first |
| `GET /api/documentos/listar?tipo=todos` | `loadDocuments` | once | `getUser` | owned documents and legal-hold summaries; unbounded rows | auth context |
| `GET /api/documentos/mis-participaciones?exclude_owned=true&view=list` | `loadDocuments` | once | `getUser` | RLS documents plus owner profiles; unbounded rows | auth context; parallel with list |
| `GET /api/documentos/carpetas` | folders effect | once | `getUser` | owner folder list; unbounded rows | auth context |
| `GET /api/documentos/etiquetas` | tag effect | once | handler uses service role; middleware only | all labels, unbounded rows | initial list filters |
| `user_view_preferences` | preferences effect | no app middleware | browser JWT/RLS | view configuration | auth context |
| `audit_trail` | activity effect | no app middleware | browser JWT/RLS | last 5 events | auth context |
| `notifications`, workspace lookups | sidebar / workspace context | no app middleware | browser JWT/RLS | workspace state | auth context |

Core cold navigation: **at least 5** app requests, `getClaims` x5 and `session_policy` x5. Handlers add `getUser` x3; `loadDocuments` and folders each call browser `getSession` before fetching. Favorites, expiring documents, trash, catalogs, and filter people are loaded on entry/control, not always on first view. Payload bytes, query times, and per-navigation p50/p95 are **N/D**.

## Known observed timings

User-reported production examples: `session_policy` 1.4–5.8 s on list, 1.4–7.6 s on folders, and 1.5–2.7 s on participations, with one 503 after roughly 16 s. These are individual observations, not a percentile sample.

Read-only `pg_stat_statements` snapshot on linked project: `enforce_docubox_session_policy` **21,401 calls**, **179.2 ms mean**, **0.2 ms min**, **7,378.3 ms max**, **3,834,596.4 ms cumulative execution**. This is a pooled query statistic, not per-navigation timing and not a p95.

## Authorization classification

| Validation | Inicio | Mis documentos | Classification |
| --- | ---: | ---: | --- |
| middleware `getClaims` | at least 2 | at least 5 | `CLAIMS_SUFFICIENT` for signed JWT identity; policy still mandatory |
| handler `getUser` | at least 1 | at least 3 | `FRESH_AUTH_REQUIRED` in existing endpoint contract; retain during consolidation |
| middleware `session_policy` | at least 2 | at least 5 | mandatory on every externally callable protected request |
| workspace/membership | context-dependent | context-dependent | browser RLS lookups; exact count needs trace |
| RLS queries | multiple | multiple | mandatory; query count needs authenticated trace |
| profile lookup | dashboard + context | context + participation owner profiles | values derive from separate consumers |

## Limits and next measurement

Capture authenticated HAR and `Server-Timing` on a controlled account before declaring a latency improvement. The signed-in browser supported DOM and wall-clock navigation timing, not HAR or browser Resource Timing. This audit does not infer that direct Supabase requests execute middleware, nor that an in-flight deduplication map eliminates sequential policy calls. Do not remove independent endpoint checks.
