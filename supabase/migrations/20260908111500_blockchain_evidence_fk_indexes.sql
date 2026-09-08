-- Cover evidence foreign keys used by retention, audit, and worker queries.
CREATE INDEX IF NOT EXISTS document_blockchain_evidence_workspace_idx
  ON public.document_blockchain_evidence(workspace_id);

CREATE INDEX IF NOT EXISTS document_blockchain_evidence_version_idx
  ON public.document_blockchain_evidence(document_version_id);

CREATE INDEX IF NOT EXISTS document_blockchain_evidence_certification_idx
  ON public.document_blockchain_evidence(document_certification_id);

CREATE INDEX IF NOT EXISTS document_blockchain_evidence_created_by_idx
  ON public.document_blockchain_evidence(created_by);

CREATE INDEX IF NOT EXISTS document_blockchain_calendar_attempts_evidence_idx
  ON public.document_blockchain_calendar_attempts(evidence_id);
