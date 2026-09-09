# Docubox Phase 7 Performance Hardening

Date: 2026-09-09

## Guardrails added

- Regression tests assert that the current session policy keeps the 20-minute ordinary timeout while
  avoiding a normal-navigation row lock.
- Regression tests assert that middleware retains fail-closed policy validation and exposes phase
  timing without PII.
- Regression tests assert that the viewer resolves profile, folder, workspace, and metadata lookups
  concurrently before publishing the unchanged protected PDF source.

## Route telemetry contract

Middleware emits `Server-Timing`:

- `middleware`: complete middleware duration;
- `auth_claims`: JWT claim validation phase;
- `session_policy`: server-side session policy phase.

The slow-request threshold remains 1,000 ms. Follow-up operational thresholds are:

| Event | Threshold | Action |
| --- | ---: | --- |
| `SLOW_MIDDLEWARE` | 500 ms | inspect phase durations and Supabase RPC plan/locks |
| `SLOW_VIEWER_FILE` | 1,000 ms | inspect authorization, storage, decryption and hash stages |
| slow hot-route DB query | 500 ms | capture a safe `EXPLAIN (ANALYZE, BUFFERS)` with production-equivalent access |

## Required controlled verification before release

1. Apply the migration in a non-production Supabase environment.
2. Capture authenticated navigation samples for owner, participant, denied user, and another tenant.
3. Capture a viewer browser trace: document click, `viewer-file`, first PDF page, request count and
   response range headers.
4. Compare screenshots of `/inicio`, `/mis-documentos`, and `/visor-documento/[id]` at desktop and
   mobile viewports.
5. Run the focused security, document, viewer, performance, type-check, and production build tests.

## Invariants

`SECURITY_REGRESSION=NONE` pending controlled verification.

`VISUAL_REGRESSION=NONE` pending screenshot comparison.

`BUSINESS_PROCESS_REGRESSION=NONE` pending controlled functional verification.

`CRYPTOGRAPHIC_SEMANTICS_UNCHANGED=true` by code-path preservation.

`PHASE_5_REGRESSION=NONE` after the session-lock regression is removed.

`STATELESS_APP_LAYER=true`.
