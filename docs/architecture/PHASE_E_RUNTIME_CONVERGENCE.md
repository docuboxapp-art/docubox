# Phase E runtime convergence decision

## Decision

`STATUS: AUTH_E_001_IMPLEMENTED_FOR_DEVELOPMENT`

Phase E does not create a workflow runtime or a document-instantiation pipeline. The repository currently contains two different workflow concepts:

- `workflow_flows` stores the graph edited from the document-creation experience. It is configuration, not a durable execution ledger.
- `organization_workflow_instances` is the governed organization runtime. It pins a published definition and records current execution state, but its node and transition semantics do not yet cover every document, signature and automation operation proposed for the visual builder.

AUTH-E-001 resolves that boundary without adding another engine. Builder schema v2 is compiled into the ordered `steps` contract already consumed by `organization_workflow_instances`; each instance continues to pin the exact workflow row, version and immutable definition snapshot.

## Required authorization

### AUTH-E-001: Canonical workflow runtime

`STATUS: IMPLEMENTED_UNDER_FEATURE_FLAG`

Existing elements affected:

- `workflow_flows` and its editor contract.
- Organization workflow definitions, versions and instances.
- Document routing and canonical operational event consumers.

Implemented change:

The existing organization workflow editor now offers an acyclic graph for nodes backed by real runtime behavior. Server-side validation rejects missing terminals, disconnected nodes, invalid edges and cycles. Publishing compiles the graph to the existing runtime contract; published rows remain immutable and new versions clone into drafts.

`workflow_flows` remains the legacy document-creation configuration adapter. It is neither removed nor rewritten. Older organization definitions can be adapted when edited, while active and historical instances keep their original snapshots.

Signature steps advance from `document_operational_events`; delay steps run through the existing Phase C orchestration scheduler. Manual approvals use a tenant-scoped, RBAC-protected transition on the same step-instance table. The internal transition is not browser-callable.

Workflow Builder V2 closes the previously deferred nodes without changing the runtime boundary:

- Notification invokes the existing Notification Service and delivery ledger.
- Action invokes the existing Agreement Actions implementation.
- Webhook queues the existing HMAC dispatcher using an active tenant-scoped endpoint reference.
- Condition evaluates the Phase C controlled condition catalog and persists a single true/false decision on the canonical step instance.

Definition schema v3 stores an acyclic graph and explicit transition identifiers. Runtime storage remains `organization_workflow_instances` plus `organization_workflow_step_instances`; the existing Phase C processor claims executable steps with bounded retries. Published versions contain only non-secret configuration snapshots. Inactive or cross-tenant webhook references fail validation and runtime execution instead of succeeding silently.

Residual risk:

Database/RLS/pgTAP validation against a real non-production PostgreSQL environment remains a gate before activation. The production feature flag remains disabled.

Runtime decision: `ONE_CANONICAL_RUNTIME: YES — organization_workflow_instances`.

### AUTH-E-002: Bulk document materialization

`STATUS: IMPLEMENTED_UNDER_FEATURE_FLAG`

The existing campaign, recipient, job, incident and event tables remain the canonical Bulk Signatures model. `src/lib/bulk-signatures/runtime.ts` materializes exactly one normal Docubox document per claimed campaign row, reusing document encryption/versioning, participant identity triggers, invitation delivery, canonical events and the existing Phase C orchestration processor.

The selected source hash and document configuration are frozen on campaign creation. A stable reserved document UUID survives worker interruption, so retries reconcile the same instance instead of creating another. Materialization and delivery use separate bounded claims and retry state; provider delivery never rematerializes the document.

The existing `/firmas-masivas` UI reads campaign progress from authenticated server APIs. Operational `localStorage` fallback remains removed. Production activation remains disabled by the existing `bulk_signature_runtime` feature flag until the non-production database gate is completed.

### AUTH-E-003: Organization-wide SSO enforcement

Existing elements affected:

- Supabase Auth session admission.
- Organization membership authorization and organization RLS policies.
- Emergency access and session revocation controls.

Required change:

After an SSO provider passes the existing test gate, enforce the provider requirement at every organization authorization boundary without affecting Personal workspaces or emergency access. A client-only redirect is not sufficient.

Risk:

Incomplete enforcement permits password sessions to retain organization access; overly broad enforcement can lock out owners. The change needs a shared server guard plus database policy coverage and real non-production SSO tests.

Safe alternative used in Phase E:

Configuration, one-time test state, provider correlation and active-membership validation are implemented. Enforcement and JIT provisioning remain disabled.

## Preserved components

PAdES, TSA, NOM-151, KMS/HSM, signed PDFs, Evidence Package v2, Legal Hold, participant JSONB, existing routing and existing organization workflow instances are not modified by this decision.
