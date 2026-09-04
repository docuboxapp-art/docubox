-- Permanent document deletion is a controlled destruction workflow. Evidence
-- is part of the bundle to destroy; only Legal Hold, retention and recovery
-- policy can block it. A minimal tombstone remains after the bundle is gone.

CREATE TABLE IF NOT EXISTS public.document_deletion_tombstones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  workspace_id uuid,
  owner_id uuid,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('USER_REQUEST', 'AUTO_RECOVERY_EXPIRY', 'ADMINISTRATIVE')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'STORAGE_REMOVED', 'COMPLETED', 'FAILED')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  storage_removed_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_document_deletion_tombstones_owner_requested
  ON public.document_deletion_tombstones (owner_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_deletion_tombstones_workspace_requested
  ON public.document_deletion_tombstones (workspace_id, requested_at DESC);

ALTER TABLE public.document_deletion_tombstones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.document_deletion_tombstones FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.document_deletion_tombstones TO service_role;

COMMENT ON TABLE public.document_deletion_tombstones IS
  'Minimal permanent-deletion history. It intentionally has no foreign key to documentos so the tombstone survives the destroyed bundle.';

CREATE OR REPLACE FUNCTION public.document_purge_context_active()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT current_setting('docubox.document_purge_context', true) = 'active';
$$;

CREATE OR REPLACE FUNCTION public.reject_certification_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND public.document_purge_context_active() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Los registros de certificacion son inmutables';
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_certifica_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND public.document_purge_context_active() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'certification_evidence_is_immutable';
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_legal_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND public.document_purge_context_active() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'legal_evidence_events_are_immutable';
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_audit_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND public.document_purge_context_active() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'No se puede modificar ni eliminar un registro de auditoría.';
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_document_bundle(
  p_document_id uuid,
  p_tombstone_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_document public.documentos%ROWTYPE;
  v_tombstone public.document_deletion_tombstones%ROWTYPE;
  v_case_ids uuid[];
  v_deleted integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'document_purge_backend_only';
  END IF;

  SELECT * INTO v_tombstone
  FROM public.document_deletion_tombstones
  WHERE id = p_tombstone_id
  FOR UPDATE;

  IF NOT FOUND OR v_tombstone.document_id IS DISTINCT FROM p_document_id THEN
    RAISE EXCEPTION 'document_purge_tombstone_invalid';
  END IF;
  IF v_tombstone.status = 'COMPLETED' THEN
    RETURN p_tombstone_id;
  END IF;
  IF v_tombstone.status <> 'STORAGE_REMOVED' THEN
    RAISE EXCEPTION 'document_purge_storage_not_confirmed';
  END IF;

  SELECT * INTO v_document
  FROM public.documentos
  WHERE id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_purge_document_not_found';
  END IF;
  IF v_document.deleted_at IS NULL THEN
    RAISE EXCEPTION 'document_purge_requires_trash';
  END IF;
  IF v_document.legal_hold IS TRUE OR coalesce(v_document.legal_hold_status, 'NONE') = 'ACTIVE' THEN
    RAISE EXCEPTION 'document_purge_legal_hold';
  END IF;
  IF coalesce(v_document.retention_status, 'NONE') = 'ACTIVE'
    OR (v_document.retention_until IS NOT NULL AND v_document.retention_until > now()) THEN
    RAISE EXCEPTION 'document_purge_retention_active';
  END IF;
  IF v_document.restore_until IS NULL OR v_document.restore_until > now() THEN
    RAISE EXCEPTION 'document_purge_recovery_period';
  END IF;

  PERFORM set_config('docubox.document_purge_context', 'active', true);

  SELECT coalesce(array_agg(id), ARRAY[]::uuid[])
  INTO v_case_ids
  FROM public.certification_cases
  WHERE source_document_id = p_document_id;

  -- Remove records which reference the document directly before deleting it.
  DELETE FROM public.document_email_deliveries WHERE document_id = p_document_id;
  DELETE FROM public.document_pdf_signatures WHERE document_id = p_document_id;
  DELETE FROM public.nom151_constancias_doc WHERE documento_id = p_document_id;
  DELETE FROM public.document_legal_evidence WHERE document_id = p_document_id;
  DELETE FROM public.legal_evidence_events WHERE document_id = p_document_id;
  DELETE FROM public.signature_evidence WHERE document_id = p_document_id;
  DELETE FROM public.form_responses WHERE document_id = p_document_id;
  DELETE FROM public.polygon_notarizations WHERE document_id = p_document_id;
  DELETE FROM public.document_relations WHERE source_document_id = p_document_id;
  DELETE FROM public.document_audit_trail WHERE document_id = p_document_id;

  -- Certification execution history is immutable outside this tightly scoped purge.
  DELETE FROM public.timestamp_records
  WHERE document_certification_id IN (
    SELECT id FROM public.document_certifications WHERE document_id = p_document_id
  );
  DELETE FROM public.certification_execution_checkpoints
  WHERE certification_id IN (
    SELECT id FROM public.document_certifications WHERE document_id = p_document_id
  );
  DELETE FROM public.certification_state_transitions
  WHERE certification_id IN (
    SELECT id FROM public.document_certifications WHERE document_id = p_document_id
  );
  DELETE FROM public.certification_access_logs
  WHERE certification_id IN (
    SELECT id FROM public.document_certifications WHERE document_id = p_document_id
  );
  DELETE FROM public.document_certifications WHERE document_id = p_document_id;
  DELETE FROM public.evidence_manifest_items
  WHERE evidence_manifest_id IN (
    SELECT id FROM public.evidence_manifests WHERE document_id = p_document_id
  );
  DELETE FROM public.evidence_manifests WHERE document_id = p_document_id;

  -- Docubox Certifica stores an additional evidence bundle for source documents.
  IF cardinality(v_case_ids) > 0 THEN
    DELETE FROM public.certification_ledger_entries WHERE certification_id = ANY(v_case_ids);
    DELETE FROM public.certification_credit_reservations WHERE certification_id = ANY(v_case_ids);
    DELETE FROM public.certification_provider_transactions WHERE certification_id = ANY(v_case_ids);
    DELETE FROM public.certification_evidences WHERE certification_id = ANY(v_case_ids);
    DELETE FROM public.certification_manifests WHERE certification_id = ANY(v_case_ids);
    DELETE FROM public.certification_custody_policies WHERE certification_id = ANY(v_case_ids);
    DELETE FROM public.certification_integrity_checks WHERE certification_id = ANY(v_case_ids);
    DELETE FROM public.certification_public_links WHERE certification_id = ANY(v_case_ids);
    DELETE FROM public.certification_webhooks WHERE certification_id = ANY(v_case_ids);
    DELETE FROM public.certification_case_events WHERE certification_id = ANY(v_case_ids);
    DELETE FROM public.certification_files WHERE certification_id = ANY(v_case_ids);
    DELETE FROM public.certification_declarations WHERE certification_id = ANY(v_case_ids);
    DELETE FROM public.certification_cases WHERE id = ANY(v_case_ids);
  END IF;

  DELETE FROM public.documentos WHERE id = p_document_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'document_purge_delete_failed';
  END IF;

  UPDATE public.document_deletion_tombstones
  SET status = 'COMPLETED', completed_at = now(), failure_code = NULL
  WHERE id = p_tombstone_id;

  RETURN p_tombstone_id;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_document_bundle(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_document_bundle(uuid, uuid) TO service_role;
