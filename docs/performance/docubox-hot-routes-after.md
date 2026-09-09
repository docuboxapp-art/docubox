# Docubox Hot Routes: Phase 6 Result

Date: 2026-09-09

## Implemented, evidence-backed changes

### 6A: Middleware and session policy

- `20260909100000_restore_read_only_session_policy.sql` restores the Fase 5 rule that a normal
  `enforce_docubox_session_policy(false)` read does not lock the session-activity row.
- The policy still locks when user activity is recorded and when a read-only check has observed an
  expiry and must re-check it atomically. Timeout values remain 20 minutes ordinary, 10 minutes
  privileged, 8 hours ordinary absolute, and 4 hours privileged absolute.
- Middleware now emits `Server-Timing` phases for `auth_claims` and `session_policy`, plus the
  existing total. Slow middleware logs contain phase durations and status only; no token, user,
  document, email, or workspace identifier is logged.

### 6D: Viewer bootstrap

- Owner profile, folder, personal workspace label, and PDF metadata now run concurrently rather
  than as four dependent requests before publishing the same protected `viewer-file` URL.
- The original loading state, layout, values, authorization, PDF decryption, hash verification,
  field placement, signature stamps, PAdES, NOM-151, and audit paths remain unchanged.

## Deliberately not changed

- `viewer-file` fresh user retrieval, authorization, encrypted storage read, plaintext hash check,
  private response headers, and PAdES verification remain intact.
- No cache was added for users, sessions, permissions, documents, Legal Hold, evidence, or PDF
  bytes.
- `/inicio` and `/mis-documentos` receive no speculative data-flow rewrite: their existing parallel
  and in-flight request sharing was verified, while no new measurable regression was demonstrated.

## Post-change numerical measurements

No deployment or authenticated test run has occurred in this task. All runtime metrics are `N/D`
until the migration is applied to a controlled environment and captured using the new phase timing.
