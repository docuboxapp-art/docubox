-- Idempotently incorporates an approved external upload into the canonical document repository.
ALTER TABLE public.collaboration_request_files
  ADD COLUMN IF NOT EXISTS canonical_document_id UUID
    REFERENCES public.documentos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS incorporated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS incorporated_by UUID
    REFERENCES public.user_profiles(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_collab_request_files_canonical_document
  ON public.collaboration_request_files(canonical_document_id)
  WHERE canonical_document_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.incorporate_collaboration_request_file(
  p_file_id UUID,
  p_workspace_id UUID,
  p_actor_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_file public.collaboration_request_files%ROWTYPE;
  v_item public.collaboration_request_items%ROWTYPE;
  v_request public.collaboration_document_requests%ROWTYPE;
  v_document_id UUID;
  v_folio TEXT;
BEGIN
  SELECT * INTO v_file
  FROM public.collaboration_request_files
  WHERE id = p_file_id AND workspace_id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_file_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_file.canonical_document_id IS NOT NULL THEN RETURN v_file.canonical_document_id; END IF;
  IF v_file.malware_scan_status <> 'clean' THEN
    RAISE EXCEPTION 'request_file_security_scan_required' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO STRICT v_item
  FROM public.collaboration_request_items
  WHERE id = v_file.request_item_id AND workspace_id = p_workspace_id;
  SELECT * INTO STRICT v_request
  FROM public.collaboration_document_requests
  WHERE id = v_item.request_id AND workspace_id = p_workspace_id;

  v_folio := 'DOC-' || to_char(CURRENT_DATE, 'YYYY') || '-' ||
    upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8));
  INSERT INTO public.documentos(
    documento_id, owner_id, workspace_id, file_name, file_size, file_type,
    file_hash_sha256, file_url, nombre, descripcion, ruta_guardado,
    estado, es_publico
  ) VALUES (
    v_folio,
    COALESCE(v_request.created_by, p_actor_id),
    p_workspace_id,
    v_file.original_name,
    v_file.byte_size,
    v_file.mime_type,
    v_file.sha256,
    v_file.storage_path,
    v_item.title,
    COALESCE(v_item.description, 'Documento recibido mediante Docubox Colabora.'),
    'raiz',
    'borrador',
    FALSE
  ) RETURNING id INTO v_document_id;

  UPDATE public.collaboration_request_files
  SET canonical_document_id = v_document_id,
      incorporated_at = CURRENT_TIMESTAMP,
      incorporated_by = p_actor_id,
      metadata = metadata || jsonb_build_object(
        'incorporation', jsonb_build_object(
          'document_id', v_document_id,
          'document_folio', v_folio,
          'incorporated_at', CURRENT_TIMESTAMP
        )
      )
  WHERE id = p_file_id;
  RETURN v_document_id;
END;
$$;

REVOKE ALL ON FUNCTION public.incorporate_collaboration_request_file(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.incorporate_collaboration_request_file(UUID, UUID, UUID)
  TO service_role;
