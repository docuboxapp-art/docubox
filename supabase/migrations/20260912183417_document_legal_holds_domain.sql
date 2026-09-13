-- Legal Hold is a preservation domain. This table is the source of truth;
-- documentos.legal_hold* remains a transactionally maintained compatibility cache.

CREATE TABLE public.document_legal_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RELEASED')),
  reason_code text NOT NULL CHECK (reason_code IN (
    'litigio', 'requerimiento_autoridad', 'auditoria', 'investigacion_interna',
    'controversia_contractual', 'cumplimiento_regulatorio_fiscal',
    'solicitud_cliente', 'preservacion_preventiva', 'otro'
  )),
  reason_label text NOT NULL,
  case_reference text,
  notes text,
  review_at timestamptz,
  expected_end_at timestamptz,
  activated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  activated_at timestamptz NOT NULL DEFAULT now(),
  released_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  released_at timestamptz,
  release_reason text,
  release_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_legal_holds_release_shape CHECK (
    (status = 'ACTIVE' AND released_by IS NULL AND released_at IS NULL
      AND release_reason IS NULL AND release_notes IS NULL)
    OR
    (status = 'RELEASED' AND released_by IS NOT NULL AND released_at IS NOT NULL
      AND nullif(btrim(release_reason), '') IS NOT NULL)
  )
);

CREATE INDEX document_legal_holds_document_status_idx
  ON public.document_legal_holds (document_id, status, activated_at DESC);
CREATE INDEX document_legal_holds_tenant_document_idx
  ON public.document_legal_holds (tenant_id, document_id, activated_at DESC);
CREATE INDEX document_legal_holds_active_idx
  ON public.document_legal_holds (tenant_id, document_id)
  WHERE status = 'ACTIVE';
CREATE INDEX document_legal_holds_review_idx
  ON public.document_legal_holds (review_at)
  WHERE status = 'ACTIVE' AND review_at IS NOT NULL;

ALTER TABLE public.evidence_supplements
  DROP CONSTRAINT IF EXISTS evidence_supplements_supplement_type_check,
  ADD CONSTRAINT evidence_supplements_supplement_type_check
    CHECK (supplement_type IN ('NOM151','OPENTIMESTAMPS','CERTIFICATION','VERIFICATION','LEGAL_HOLD'));

ALTER TABLE public.document_legal_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.document_legal_holds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.document_legal_holds TO authenticated;
GRANT ALL ON TABLE public.document_legal_holds TO service_role;

CREATE POLICY document_legal_holds_authorized_read
  ON public.document_legal_holds FOR SELECT TO authenticated
  USING (public.can_access_documento(document_id));

COMMENT ON TABLE public.document_legal_holds IS
  'Source of truth for document preservation holds. review_at and expected_end_at are informational and never release a hold.';

CREATE OR REPLACE FUNCTION public.has_active_document_legal_hold(p_document_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.document_legal_holds
    WHERE document_id = p_document_id AND status = 'ACTIVE'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_document_legal_hold_history(p_document_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.document_legal_holds WHERE document_id = p_document_id
  );
$$;

REVOKE ALL ON FUNCTION public.has_active_document_legal_hold(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_document_legal_hold_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_document_legal_hold(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_document_legal_hold_history(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.storage_document_has_active_legal_hold(file_path text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM generate_series(1, 6) AS position
    JOIN public.documentos document
      ON document.id::text = split_part(file_path, '/', position)
    JOIN public.document_legal_holds hold
      ON hold.document_id = document.id AND hold.status = 'ACTIVE'
  );
$$;
REVOKE ALL ON FUNCTION public.storage_document_has_active_legal_hold(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_document_has_active_legal_hold(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "owner_only_delete_documents" ON storage.objects;
CREATE POLICY "owner_only_delete_documents"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'documents'
  AND public.is_storage_document_owner(name)
  AND NOT public.storage_document_has_active_legal_hold(name)
);

CREATE OR REPLACE FUNCTION public.sync_document_legal_hold_cache(p_document_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_active public.document_legal_holds%ROWTYPE;
  v_latest public.document_legal_holds%ROWTYPE;
BEGIN
  SELECT * INTO v_active FROM public.document_legal_holds
  WHERE document_id = p_document_id AND status = 'ACTIVE'
  ORDER BY activated_at DESC, id DESC LIMIT 1;
  SELECT * INTO v_latest FROM public.document_legal_holds
  WHERE document_id = p_document_id
  ORDER BY activated_at DESC, id DESC LIMIT 1;

  UPDATE public.documentos SET
    legal_hold = v_active.id IS NOT NULL,
    legal_hold_status = CASE
      WHEN v_active.id IS NOT NULL THEN 'ACTIVE'
      WHEN v_latest.id IS NOT NULL THEN 'RELEASED'
      ELSE 'NONE'
    END,
    legal_hold_reason = COALESCE(v_active.reason_code, v_latest.reason_code),
    legal_hold_created_at = COALESCE(v_active.activated_at, v_latest.activated_at),
    legal_hold_created_by = COALESCE(v_active.activated_by, v_latest.activated_by),
    legal_hold_released_at = CASE WHEN v_active.id IS NULL THEN v_latest.released_at ELSE NULL END,
    legal_hold_released_by = CASE WHEN v_active.id IS NULL THEN v_latest.released_by ELSE NULL END,
    legal_hold_release_reason = CASE WHEN v_active.id IS NULL THEN v_latest.release_reason ELSE NULL END
  WHERE id = p_document_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_document_legal_hold_cache(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_document_legal_hold_cache(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.reject_direct_legal_hold_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.document_purge_context_active() AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF current_setting('docubox.legal_hold_context', true) = 'active' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'LEGAL_HOLD_DOMAIN_FUNCTION_REQUIRED';
END;
$$;

CREATE TRIGGER document_legal_holds_controlled_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.document_legal_holds
  FOR EACH ROW EXECUTE FUNCTION public.reject_direct_legal_hold_mutation();

CREATE OR REPLACE FUNCTION public.activate_document_legal_hold(
  p_document_id uuid,
  p_reason_code text,
  p_reason_label text,
  p_actor_id uuid,
  p_actor_email text DEFAULT NULL,
  p_case_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_review_at timestamptz DEFAULT NULL,
  p_expected_end_at timestamptz DEFAULT NULL,
  p_request_id text DEFAULT NULL,
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS public.document_legal_holds
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_document public.documentos%ROWTYPE;
  v_hold public.document_legal_holds%ROWTYPE;
  v_version_id uuid;
  v_sha256 text;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'LEGAL_HOLD_SERVICE_ROLE_REQUIRED';
  END IF;
  SELECT * INTO v_document FROM public.documentos WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEGAL_HOLD_DOCUMENT_NOT_FOUND'; END IF;
  IF v_document.lifecycle_status IN ('PURGING', 'PURGED') THEN
    RAISE EXCEPTION 'LEGAL_HOLD_DOCUMENT_DESTRUCTION_STARTED';
  END IF;
  PERFORM set_config('docubox.legal_hold_context', 'active', true);
  INSERT INTO public.document_legal_holds (
    tenant_id, workspace_id, document_id, reason_code, reason_label,
    case_reference, notes, review_at, expected_end_at, activated_by
  ) VALUES (
    COALESCE(v_document.workspace_id, v_document.owner_id), v_document.workspace_id,
    p_document_id, p_reason_code, p_reason_label, nullif(btrim(p_case_reference), ''),
    nullif(btrim(p_notes), ''), p_review_at, p_expected_end_at, p_actor_id
  ) RETURNING * INTO v_hold;
  PERFORM public.sync_document_legal_hold_cache(p_document_id);

  SELECT id, sha256 INTO v_version_id, v_sha256
  FROM public.document_versions WHERE document_id = p_document_id
  ORDER BY version_number DESC LIMIT 1;

  INSERT INTO public.document_lifecycle_audit_events (
    workspace_id, document_id, actor_id, actor_email, action, previous_state,
    new_state, reason, request_id, ip_address, user_agent, metadata
  ) VALUES (
    v_document.workspace_id, p_document_id, p_actor_id, p_actor_email,
    'LEGAL_HOLD_ACTIVATED', jsonb_build_object('active_count', (
      SELECT count(*) - 1 FROM public.document_legal_holds
      WHERE document_id = p_document_id AND status = 'ACTIVE'
    )), jsonb_build_object('active_count', (
      SELECT count(*) FROM public.document_legal_holds
      WHERE document_id = p_document_id AND status = 'ACTIVE'
    )), p_reason_code, p_request_id, p_ip_address, p_user_agent,
    jsonb_build_object('legal_hold_id', v_hold.id, 'reason_label', p_reason_label,
      'case_reference', v_hold.case_reference, 'review_at', v_hold.review_at,
      'document_version_id', v_version_id, 'document_sha256', v_sha256)
  );

  PERFORM public.append_legal_evidence_event(
    p_document_id, 'LEGAL_HOLD_ACTIVATED', 'COMPLIANCE', 'SUCCESS', p_actor_id,
    'USER', jsonb_build_object('legal_hold_id', v_hold.id, 'reason_code', p_reason_code,
      'reason_label', p_reason_label, 'case_reference', v_hold.case_reference,
      'review_at', v_hold.review_at, 'document_version_id', v_version_id),
    v_sha256, p_actor_email, NULL, 'legal-hold:activate:' || v_hold.id::text,
    'DOCUBOX', v_hold.id, v_hold.activated_at
  );
  RETURN v_hold;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_document_legal_hold(
  p_hold_id uuid,
  p_actor_id uuid,
  p_actor_email text DEFAULT NULL,
  p_reason_code text DEFAULT NULL,
  p_reason_label text DEFAULT NULL,
  p_case_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_review_at timestamptz DEFAULT NULL,
  p_expected_end_at timestamptz DEFAULT NULL,
  p_request_id text DEFAULT NULL,
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS public.document_legal_holds
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_old public.document_legal_holds%ROWTYPE; v_new public.document_legal_holds%ROWTYPE;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'LEGAL_HOLD_SERVICE_ROLE_REQUIRED'; END IF;
  SELECT * INTO v_old FROM public.document_legal_holds WHERE id = p_hold_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEGAL_HOLD_NOT_FOUND'; END IF;
  IF v_old.status <> 'ACTIVE' THEN RAISE EXCEPTION 'LEGAL_HOLD_RELEASED_IMMUTABLE'; END IF;
  PERFORM 1 FROM public.documentos WHERE id = v_old.document_id FOR UPDATE;
  PERFORM set_config('docubox.legal_hold_context', 'active', true);
  UPDATE public.document_legal_holds SET
    reason_code = COALESCE(p_reason_code, reason_code),
    reason_label = COALESCE(p_reason_label, reason_label),
    case_reference = nullif(btrim(p_case_reference), ''), notes = nullif(btrim(p_notes), ''),
    review_at = p_review_at, expected_end_at = p_expected_end_at, updated_at = now()
  WHERE id = p_hold_id RETURNING * INTO v_new;
  PERFORM public.sync_document_legal_hold_cache(v_old.document_id);
  INSERT INTO public.document_lifecycle_audit_events (
    workspace_id, document_id, actor_id, actor_email, action, previous_state,
    new_state, reason, request_id, ip_address, user_agent, metadata
  ) VALUES (v_old.workspace_id, v_old.document_id, p_actor_id, p_actor_email,
    'LEGAL_HOLD_UPDATED', to_jsonb(v_old), to_jsonb(v_new), v_new.reason_code,
    p_request_id, p_ip_address, p_user_agent, jsonb_build_object('legal_hold_id', p_hold_id));
  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_document_legal_hold(
  p_hold_id uuid,
  p_actor_id uuid,
  p_release_reason text,
  p_actor_email text DEFAULT NULL,
  p_release_notes text DEFAULT NULL,
  p_request_id text DEFAULT NULL,
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS public.document_legal_holds
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old public.document_legal_holds%ROWTYPE;
  v_new public.document_legal_holds%ROWTYPE;
  v_version_id uuid; v_sha256 text; v_active_count integer;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'LEGAL_HOLD_SERVICE_ROLE_REQUIRED'; END IF;
  IF nullif(btrim(p_release_reason), '') IS NULL THEN
    RAISE EXCEPTION 'LEGAL_HOLD_RELEASE_REASON_REQUIRED'; END IF;
  SELECT * INTO v_old FROM public.document_legal_holds WHERE id = p_hold_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEGAL_HOLD_NOT_FOUND'; END IF;
  IF v_old.status = 'RELEASED' THEN RETURN v_old; END IF;
  PERFORM 1 FROM public.documentos WHERE id = v_old.document_id FOR UPDATE;
  PERFORM set_config('docubox.legal_hold_context', 'active', true);
  UPDATE public.document_legal_holds SET status = 'RELEASED', released_by = p_actor_id,
    released_at = now(), release_reason = btrim(p_release_reason),
    release_notes = nullif(btrim(p_release_notes), ''), updated_at = now()
  WHERE id = p_hold_id RETURNING * INTO v_new;
  PERFORM public.sync_document_legal_hold_cache(v_old.document_id);
  SELECT count(*) INTO v_active_count FROM public.document_legal_holds
    WHERE document_id = v_old.document_id AND status = 'ACTIVE';
  SELECT id, sha256 INTO v_version_id, v_sha256 FROM public.document_versions
    WHERE document_id = v_old.document_id ORDER BY version_number DESC LIMIT 1;
  INSERT INTO public.document_lifecycle_audit_events (
    workspace_id, document_id, actor_id, actor_email, action, previous_state,
    new_state, reason, request_id, ip_address, user_agent, metadata
  ) VALUES (v_old.workspace_id, v_old.document_id, p_actor_id, p_actor_email,
    'LEGAL_HOLD_RELEASED', jsonb_build_object('status', 'ACTIVE'),
    jsonb_build_object('status', 'RELEASED', 'remaining_active_count', v_active_count),
    p_release_reason, p_request_id, p_ip_address, p_user_agent,
    jsonb_build_object('legal_hold_id', p_hold_id, 'release_notes', v_new.release_notes,
      'document_version_id', v_version_id, 'document_sha256', v_sha256));
  PERFORM public.append_legal_evidence_event(
    v_old.document_id, 'LEGAL_HOLD_RELEASED', 'COMPLIANCE', 'SUCCESS', p_actor_id,
    'USER', jsonb_build_object('legal_hold_id', p_hold_id,
      'release_reason', p_release_reason, 'remaining_active_count', v_active_count,
      'document_version_id', v_version_id), v_sha256, p_actor_email, NULL,
    'legal-hold:release:' || p_hold_id::text, 'DOCUBOX', p_hold_id, v_new.released_at
  );
  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_document_legal_hold(uuid,text,text,uuid,text,text,text,timestamptz,timestamptz,text,inet,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_document_legal_hold(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,text,inet,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_document_legal_hold(uuid,uuid,text,text,text,text,inet,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_document_legal_hold(uuid,text,text,uuid,text,text,text,timestamptz,timestamptz,text,inet,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_document_legal_hold(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,text,inet,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_document_legal_hold(uuid,uuid,text,text,text,text,inet,text) TO service_role;

-- Backfill the legacy single-state implementation without losing its known history.
SELECT set_config('docubox.legal_hold_context', 'active', true);
INSERT INTO public.document_legal_holds (
  tenant_id, workspace_id, document_id, status, reason_code, reason_label,
  activated_by, activated_at, released_by, released_at, release_reason
)
SELECT COALESCE(d.workspace_id, d.owner_id), d.workspace_id, d.id,
  CASE WHEN d.legal_hold IS TRUE OR d.legal_hold_status = 'ACTIVE' THEN 'ACTIVE' ELSE 'RELEASED' END,
  CASE d.legal_hold_reason
    WHEN 'litigio' THEN 'litigio'
    WHEN 'requerimiento_autoridad' THEN 'requerimiento_autoridad'
    WHEN 'auditoria_investigacion' THEN 'auditoria'
    WHEN 'prevencion_eliminacion' THEN 'preservacion_preventiva'
    ELSE 'otro' END,
  COALESCE(NULLIF(d.legal_hold_reason, ''), 'Legal Hold migrado'),
  COALESCE(d.legal_hold_created_by, d.owner_id), COALESCE(d.legal_hold_created_at, d.created_at),
  CASE WHEN d.legal_hold IS TRUE OR d.legal_hold_status = 'ACTIVE' THEN NULL
    ELSE COALESCE(d.legal_hold_released_by, d.owner_id) END,
  CASE WHEN d.legal_hold IS TRUE OR d.legal_hold_status = 'ACTIVE' THEN NULL
    ELSE COALESCE(d.legal_hold_released_at, d.updated_at, now()) END,
  CASE WHEN d.legal_hold IS TRUE OR d.legal_hold_status = 'ACTIVE' THEN NULL
    ELSE COALESCE(NULLIF(d.legal_hold_release_reason, ''), 'Migración de historial existente') END
FROM public.documentos d
WHERE d.legal_hold IS TRUE OR d.legal_hold_status IN ('ACTIVE', 'RELEASED');

-- Direct document/version destruction is rejected from every caller while a hold is active.
CREATE OR REPLACE FUNCTION public.reject_destruction_under_legal_hold()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_document_id uuid;
BEGIN
  v_document_id := CASE WHEN TG_TABLE_NAME = 'documentos' THEN OLD.id ELSE OLD.document_id END;
  IF public.has_active_document_legal_hold(v_document_id) THEN
    RAISE EXCEPTION 'LEGAL_HOLD_ACTIVE' USING ERRCODE = '55006';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER documentos_reject_legal_hold_destruction
  BEFORE DELETE ON public.documentos FOR EACH ROW
  EXECUTE FUNCTION public.reject_destruction_under_legal_hold();
CREATE TRIGGER document_versions_reject_legal_hold_destruction
  BEFORE DELETE ON public.document_versions FOR EACH ROW
  EXECUTE FUNCTION public.reject_destruction_under_legal_hold();

-- Reserve destruction before deleting blobs. Document locking serializes this with hold activation.
CREATE OR REPLACE FUNCTION public.begin_document_purge(
  p_document_id uuid, p_tombstone_id uuid, p_direct_delete boolean DEFAULT false
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_document public.documentos%ROWTYPE;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'document_purge_backend_only'; END IF;
  PERFORM 1 FROM public.document_deletion_tombstones
    WHERE id = p_tombstone_id AND document_id = p_document_id AND status = 'PENDING' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_purge_tombstone_invalid'; END IF;
  SELECT * INTO v_document FROM public.documentos WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_purge_document_not_found'; END IF;
  IF public.has_active_document_legal_hold(p_document_id) THEN
    RAISE EXCEPTION 'document_purge_legal_hold' USING ERRCODE = '55006'; END IF;
  IF v_document.deleted_at IS NULL AND NOT p_direct_delete THEN
    RAISE EXCEPTION 'document_purge_requires_trash'; END IF;
  IF COALESCE(v_document.retention_status, 'NONE') = 'ACTIVE'
    OR (v_document.retention_until IS NOT NULL AND v_document.retention_until > now()) THEN
    RAISE EXCEPTION 'document_purge_retention_active'; END IF;
  IF NOT p_direct_delete AND (v_document.restore_until IS NULL OR v_document.restore_until > now()) THEN
    RAISE EXCEPTION 'document_purge_recovery_period'; END IF;
  UPDATE public.documentos SET lifecycle_status = 'PURGING', purge_requested_at = now(),
    deleted_at = CASE WHEN p_direct_delete THEN COALESCE(deleted_at, now()) ELSE deleted_at END,
    trashed_at = CASE WHEN p_direct_delete THEN COALESCE(trashed_at, now()) ELSE trashed_at END,
    restore_until = CASE WHEN p_direct_delete THEN LEAST(COALESCE(restore_until, now()), now()) ELSE restore_until END
    WHERE id = p_document_id;
  RETURN p_tombstone_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.abort_document_purge(p_document_id uuid, p_tombstone_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'document_purge_backend_only'; END IF;
  UPDATE public.documentos SET lifecycle_status = 'PURGE_FAILED', purge_failure_reason = 'PURGE_FAILED'
  WHERE id = p_document_id AND lifecycle_status = 'PURGING';
  UPDATE public.document_deletion_tombstones SET status = 'FAILED', failure_code = 'PURGE_FAILED'
  WHERE id = p_tombstone_id AND document_id = p_document_id AND status <> 'COMPLETED';
END;
$$;

REVOKE ALL ON FUNCTION public.begin_document_purge(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.abort_document_purge(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_document_purge(uuid,uuid,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.abort_document_purge(uuid,uuid) TO service_role;
