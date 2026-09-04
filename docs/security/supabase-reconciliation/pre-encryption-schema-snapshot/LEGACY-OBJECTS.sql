-- Exact legacy definitions captured from production before schema replacement.
-- Project: kbjejiclhgjmiasauxyr
-- Captured: 2026-08-30

-- Legacy table: owner postgres, RLS enabled, not forced.
CREATE TABLE public.document_encryption_metadata (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  storage_path text NOT NULL,
  encryption_algorithm text NOT NULL DEFAULT 'AES-256-GCM'::text,
  encrypted_dek text NOT NULL,
  key_version text NOT NULL,
  iv_or_nonce text NOT NULL,
  auth_tag text NOT NULL,
  sha256_original text NOT NULL,
  sha256_ciphertext text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  uses_per_participant_deks boolean NOT NULL DEFAULT false,
  participant_deks_count integer NOT NULL DEFAULT 0,
  CONSTRAINT document_encryption_metadata_pkey PRIMARY KEY (id),
  CONSTRAINT document_encryption_metadata_document_id_fkey
    FOREIGN KEY (document_id) REFERENCES public.documentos(id) ON DELETE CASCADE,
  CONSTRAINT document_encryption_metadata_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT chk_encryption_algorithm CHECK (
    encryption_algorithm = ANY (ARRAY[
      'AES-256-GCM'::text, 'AES-256-CBC'::text, 'ChaCha20-Poly1305'::text
    ])
  )
);

ALTER TABLE public.document_encryption_metadata OWNER TO postgres;
ALTER TABLE public.document_encryption_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_encryption_metadata NO FORCE ROW LEVEL SECURITY;

CREATE INDEX idx_doc_enc_meta_created_at
  ON public.document_encryption_metadata USING btree (created_at DESC);
CREATE INDEX idx_doc_enc_meta_document_id
  ON public.document_encryption_metadata USING btree (document_id);
CREATE INDEX idx_doc_enc_meta_storage_path
  ON public.document_encryption_metadata USING btree (storage_path);
CREATE INDEX idx_doc_enc_meta_tenant_document
  ON public.document_encryption_metadata USING btree (tenant_id, document_id);
CREATE INDEX idx_doc_enc_meta_tenant_id
  ON public.document_encryption_metadata USING btree (tenant_id);

CREATE POLICY enc_meta_delete_workspace_members
  ON public.document_encryption_metadata AS PERMISSIVE FOR DELETE
  TO authenticated
  USING (is_workspace_member_for_encryption(tenant_id));
CREATE POLICY enc_meta_insert_workspace_members
  ON public.document_encryption_metadata AS PERMISSIVE FOR INSERT
  TO authenticated
  WITH CHECK (is_workspace_member_for_encryption(tenant_id));
CREATE POLICY enc_meta_select_workspace_members
  ON public.document_encryption_metadata AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (is_workspace_member_for_encryption(tenant_id));
CREATE POLICY enc_meta_service_role_all
  ON public.document_encryption_metadata AS PERMISSIVE FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY enc_meta_update_workspace_members
  ON public.document_encryption_metadata AS PERMISSIVE FOR UPDATE
  TO authenticated
  USING (is_workspace_member_for_encryption(tenant_id))
  WITH CHECK (is_workspace_member_for_encryption(tenant_id));

GRANT ALL ON TABLE public.document_encryption_metadata TO anon;
GRANT ALL ON TABLE public.document_encryption_metadata TO authenticated;
GRANT ALL ON TABLE public.document_encryption_metadata TO service_role;

-- Legacy view that blocks DROP TABLE unless removed explicitly.
CREATE OR REPLACE VIEW public.v_documents_missing_participant_deks AS
 SELECT d.id AS document_id,
    d.workspace_id,
    d.owner_id,
    d.nombre,
    d.estado,
    d.participantes,
    dem.encrypted_dek,
    dem.iv_or_nonce,
    dem.auth_tag,
    dem.sha256_original,
    dem.sha256_ciphertext,
    dem.key_version,
    dem.uses_per_participant_deks,
    dem.participant_deks_count,
    ( SELECT count(*) AS count
           FROM jsonb_array_elements(COALESCE(d.participantes, '[]'::jsonb)) p(value)
          WHERE (((p.value ->> 'email'::text) IS NOT NULL) AND (NOT (EXISTS ( SELECT 1
                   FROM public.document_participant_deks dpd
                  WHERE ((dpd.document_id = d.id) AND (dpd.participant_email = (p.value ->> 'email'::text)) AND (dpd.access_status = 'active'::text))))))) AS participants_without_dek
   FROM (public.documentos d
     JOIN public.document_encryption_metadata dem ON ((dem.document_id = d.id)))
  WHERE ((dem.encrypted_dek IS NOT NULL) AND ((dem.uses_per_participant_deks = false) OR (dem.participant_deks_count = 0) OR (( SELECT count(*) AS count
           FROM jsonb_array_elements(COALESCE(d.participantes, '[]'::jsonb)) p(value)
          WHERE (((p.value ->> 'email'::text) IS NOT NULL) AND (NOT (EXISTS ( SELECT 1
                   FROM public.document_participant_deks dpd
                  WHERE ((dpd.document_id = d.id) AND (dpd.participant_email = (p.value ->> 'email'::text)) AND (dpd.access_status = 'active'::text))))))) > 0)));

ALTER VIEW public.v_documents_missing_participant_deks OWNER TO postgres;
COMMENT ON VIEW public.v_documents_missing_participant_deks IS
  'Backend-only diagnostic view for participant DEK coverage. Never exposed to client roles.';
REVOKE ALL ON TABLE public.v_documents_missing_participant_deks FROM PUBLIC;
REVOKE ALL ON TABLE public.v_documents_missing_participant_deks FROM anon;
REVOKE ALL ON TABLE public.v_documents_missing_participant_deks FROM authenticated;
GRANT SELECT ON TABLE public.v_documents_missing_participant_deks TO service_role;

-- Existing helper definitions and ACLs.
CREATE OR REPLACE FUNCTION public.is_workspace_member_for_encryption(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = auth.uid()
  )
$function$;

CREATE OR REPLACE FUNCTION public.sync_encryption_metadata_dek_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_document_id UUID;
  v_active_count INT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_document_id := OLD.document_id;
  ELSE
    v_document_id := NEW.document_id;
  END IF;
  SELECT COUNT(*) INTO v_active_count
  FROM public.document_participant_deks
  WHERE document_id = v_document_id AND access_status = 'active';
  UPDATE public.document_encryption_metadata
  SET uses_per_participant_deks = (v_active_count > 0),
      participant_deks_count = v_active_count
  WHERE document_id = v_document_id;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_participant_dek_wrap(
  p_document_id uuid, p_workspace_id uuid, p_participant_email text,
  p_participant_user_id uuid, p_participant_role text, p_wrapped_dek text,
  p_kek_version text DEFAULT 'docubox-kek-v1'::text,
  p_key_derivation_ctx jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_existing_id UUID;
  v_new_id UUID;
BEGIN
  SELECT id INTO v_existing_id
  FROM public.document_participant_deks
  WHERE document_id = p_document_id
    AND participant_email = p_participant_email
    AND access_status = 'active'
  LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;
  INSERT INTO public.document_participant_deks (
    document_id, workspace_id, participant_user_id, participant_email,
    participant_role, wrapped_dek, kek_version, wrap_algorithm,
    key_derivation_context, access_status, granted_at, created_at
  ) VALUES (
    p_document_id, p_workspace_id, p_participant_user_id, p_participant_email,
    p_participant_role, p_wrapped_dek, p_kek_version, 'AES-256-GCM',
    p_key_derivation_ctx, 'active', now(), now()
  ) RETURNING id INTO v_new_id;
  RETURN v_new_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.generate_participant_dek_wrap(
  uuid,uuid,text,uuid,text,text,text,jsonb) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_participant_dek_wrap(
  uuid,uuid,text,uuid,text,text,text,jsonb) TO anon, service_role;
GRANT EXECUTE ON FUNCTION public.sync_encryption_metadata_dek_counts()
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_workspace_member_for_encryption(uuid)
  TO anon, authenticated, service_role;

-- These two existing SECURITY DEFINER helpers were not redefined by the
-- migration, but their pre-intervention public ACLs are part of the rollback
-- state. kms_rewrap had anon/authenticated grants; notify also inherited PUBLIC.
GRANT EXECUTE ON FUNCTION public.kms_rewrap_deks_batch()
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_new_participant_dek_needed()
  TO PUBLIC, anon, authenticated, service_role;

-- Exact legacy trigger.
CREATE TRIGGER trg_sync_dek_counts
AFTER INSERT OR DELETE OR UPDATE ON public.document_participant_deks
FOR EACH ROW EXECUTE FUNCTION public.sync_encryption_metadata_dek_counts();

-- Exact pre-intervention document-version trigger function.
CREATE OR REPLACE FUNCTION public.prevent_frozen_document_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.frozen_at IS NOT NULL OR OLD.status IN ('sent','signed') THEN
    RAISE EXCEPTION 'frozen_document_version' USING ERRCODE = '55000';
  END IF;
  NEW.version_number := OLD.version_number;
  NEW.document_id := OLD.document_id;
  NEW.workspace_id := OLD.workspace_id;
  RETURN NEW;
END;
$function$;
