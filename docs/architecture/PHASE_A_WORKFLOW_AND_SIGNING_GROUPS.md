# Phase A workflow boundaries and signing groups

## Scope

This document records the existing architecture only. Phase A does not activate Agreement Actions, Workflow Builder, delegation, delayed routing or advanced signing-group policies.

## Workflow boundaries

### Definition layer

- `workflow_flows` is the legacy document-level definition used by `StepFlujoTrabajo.tsx`. It stores a creator-owned graph (`nodes`, `edges`) associated with a document.
- `organization_approval_workflows` and their published versions are the governed organization definition layer. They carry workspace permissions, status and versioning.
- Colabora automations have their own scoped definition/version tables because they operate inside the existing Colabora product boundary. They must not become a second general document workflow engine.

### Runtime layer

- `organization_workflow_instances` is the organization runtime. It executes a published workflow definition against a resource and provides idempotency, current step and status.
- `workflow_flows` is not a runtime ledger and must not be migrated or executed as one during Phase A.
- JSONB `documentos.participantes`, `participation_order` and `grupos_firma` remain the current participant-routing runtime for document signing.

### Event layer

- `document_operational_events` is the canonical document event envelope introduced by Phase A. It is tenant/document scoped, correlation-aware and deduplicated by `(document_id,event_key)`.
- Operational events do not replace `audit_trail`, `document_activity_log`, `document_lifecycle_audit_events`, organization audit chains or Evidence Package events.
- A future dispatcher may consume these events and invoke the existing organization runtime, Colabora queue, notifications or webhooks. No consumer is enabled in Phase A.

## Existing signing groups analysis

### What exists and is active

- `StepParticipantes.tsx` exposes `mixto` as a participation order.
- `StepAgrupamiento.tsx` is reachable from Crear documento when mixed routing is selected. It creates, reorders and removes groups, assigns each participant once, and configures each group as `paralelo` or `secuencial`.
- `crear-documento/page.tsx` requires every participant to belong to a group before continuing.
- `StepEnviar.tsx` sends `grupos` and `participationOrder`; `/api/documentos/enviar` persists them as `documentos.grupos_firma` and `documentos.participation_order`.
- `/api/documentos/enviar` exposes only the first group initially. `/api/documentos/advance-participation` moves to the next hidden participant/group after the active group completes.
- Migration `20260519120000_participation_order_schema.sql` contains the JSONB columns and a legacy next-participant helper.

### What is partial or inactive

- There is no dedicated feature flag around the current mixed UI. The new `advanced_signing_groups` flag remains disabled and is reserved for future policies; it does not disable or alter current mixed routing.
- Group IDs are client-generated strings and membership refers to mutable participant `id` values. Phase A adds stable participant references but does not rewrite existing group JSON.
- There is no explicit group completion policy, quorum, claim/locking model, delegated member substitution or group-specific evidence contract.
- The current parallel group behaves as `ALL`: routing advances only when every member is terminal. Sequential groups also require every member in order.

### Reuse path

- `ALL`: reuse current group ordering and terminal-state evaluation, then bind membership to stable participant references in a later compatible version.
- `ANY_ONE`: add an explicit policy and atomic winner claim; close or skip remaining group actions without deleting their history. This requires participant/evidence semantics authorization.
- `N_OF_M`: add validated quorum metadata, an atomic completion counter/claim, deterministic treatment of remaining members and evidence of the threshold decision.
- Every future policy should emit canonical events, preserve the original participant, remain tenant-scoped and extend the existing routing runtime rather than create a parallel engine.

## Phase A invariants

- `documentos.participantes` remains present and canonical for existing consumers.
- PAdES, TSA, NOM-151, Evidence Package v2, hashes, KMS/HSM, Storage, Legal Hold and signed PDFs are unchanged.
- No feature flag added by Phase A is enabled.
- No workflow table is removed, converged or migrated.
