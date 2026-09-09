# Docubox Hot Routes: Baseline Before Phase 6

Date: 2026-09-09

Commit under audit: `0a5c856` plus uncommitted Phase 6 work.

## Method and limits

This baseline combines the prior reproducible production snapshot from 2026-09-08 with a fresh
static audit of the current source and migrations. No authenticated synthetic account or current
production trace was available in this task, so authenticated TTFB, payload, LCP, first-page PDF,
and percentile values are intentionally recorded as `N/D`.

## Confirmed middleware regression

The active migration `20260909075009_session_inactivity_timeout_twenty_minutes.sql` restored an
unconditional `FOR UPDATE` on `docubox_session_activity`. The middleware invokes
`enforce_docubox_session_policy(false)` for every authenticated protected request. Concurrent tabs
for the same session can therefore serialize before the page, API, or PDF route begins.

The prior production snapshot recorded the session-policy statement at 23 calls, 470.74 ms mean,
2,338.08 ms max. User-reported middleware logs for the current period range from about 1.6 s to
19.4 s. Those reports identify the symptom; a new deployment trace is required to establish fresh
p50/p95 values.

## Route inventory

| Route | Confirmed critical work | Confirmed non-critical work on initial path | Baseline metric |
| --- | --- | --- | --- |
| `/inicio` | Auth context; dashboard profile and subscription | Widgets share in-flight document/participation requests; verification status | authenticated timing `N/D` |
| `/mis-documentos` | Auth context; owned-document and participation list requests in parallel | Folders, filters, favorites, trash and activity are loaded on demand by section/control | authenticated timing/payload `N/D` |
| `/visor-documento/[id]` | Document authorization and protected `viewer-file` request | Owner profile, folder, workspace and PDF metadata were sequential before `file_url` state | first-page timing `N/D` |

## Viewer-file constraints

`viewer-file` preserves private access, verifies authorization, decrypts the protected storage
object, and validates its plaintext hash before returning bytes. It advertises HTTP ranges, but the
current encrypted-object format requires a complete authenticated decryption before a range can be
cut from plaintext. Replacing that with storage-level partial reads would require an encryption
format and integrity design review, so it is not a Phase 6 optimization.

## Pre-change measurements available from the prior reproducible baseline

| Metric | Value | Source |
| --- | ---: | --- |
| `/inicio` unauthenticated redirect p50 | 423 ms | 2026-09-08 Vercel sample |
| `/mis-documentos` unauthenticated redirect p50 | 285 ms | 2026-09-08 Vercel sample |
| `/mis-documentos` initial JS | 1,071.1 KiB uncompressed | 2026-09-08 build manifest |
| `/visor-documento/[id]` initial JS | 1,076.7 KiB uncompressed | 2026-09-08 build manifest |
| Authenticated middleware p50/p95 | N/D | no current representative trace |
| Authenticated viewer first page | N/D | no test account trace |
