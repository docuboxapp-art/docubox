-- DOCUBOX Phase B: additive document package, participant requirements,
-- granular resource visibility and isolated in-person signing sessions.
-- Existing documentos rows remain valid without a package.

CREATE TABLE IF NOT EXISTS public.document_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_id),
  UNIQUE(id, document_id),
  UNIQUE(id, workspace_id)
);

CREATE TABLE IF NOT EXISTS public.document_package_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.document_packages(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  document_version_id UUID REFERENCES public.document_versions(id) ON DELETE SET NULL,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('supplemental','participant_attachment')),
  interaction_mode TEXT NOT NULL DEFAULT 'informative'
    CHECK (interaction_mode IN ('informative','read_required','acceptance_required','downloadable')),
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 180),
  description TEXT,
  storage_bucket TEXT NOT NULL DEFAULT 'documents' CHECK (storage_bucket = 'documents'),
  storage_path TEXT NOT NULL CHECK (length(storage_path) BETWEEN 1 AND 900),
  original_name TEXT NOT NULL CHECK (length(original_name) BETWEEN 1 AND 255),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')),
  byte_size BIGINT NOT NULL CHECK (byte_size > 0 AND byte_size <= 26214400),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  malware_scan_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (malware_scan_status IN ('pending','clean','quarantined','failed')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  UNIQUE(package_id, id),
  UNIQUE(document_id, id),
  UNIQUE(storage_bucket, storage_path)
);

CREATE TABLE IF NOT EXISTS public.participant_document_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.document_packages(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  document_version_id UUID REFERENCES public.document_versions(id) ON DELETE SET NULL,
  participant_reference_id UUID NOT NULL
    REFERENCES public.document_participant_references(id) ON DELETE RESTRICT,
  requirement_type TEXT NOT NULL DEFAULT 'document'
    CHECK (requirement_type IN ('document','identity','supporting_evidence')),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 180),
  description TEXT,
  required BOOLEAN NOT NULL DEFAULT true,
  allowed_mime_types TEXT[] NOT NULL DEFAULT ARRAY['application/pdf','image/jpeg','image/png']::TEXT[],
  max_size_bytes BIGINT NOT NULL DEFAULT 26214400
    CHECK (max_size_bytes > 0 AND max_size_bytes <= 26214400),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','provided','accepted','rejected','waived')),
  provided_resource_id UUID REFERENCES public.document_package_resources(id) ON DELETE SET NULL,
  provided_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (cardinality(allowed_mime_types) BETWEEN 1 AND 8),
  CHECK (allowed_mime_types <@ ARRAY['application/pdf','image/jpeg','image/png']::TEXT[]),
  CHECK (
    (status = 'provided' AND provided_resource_id IS NOT NULL AND provided_at IS NOT NULL)
    OR status <> 'provided'
  ),
  UNIQUE(document_id, participant_reference_id, id)
);

CREATE TABLE IF NOT EXISTS public.document_resource_visibility (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES public.document_package_resources(id) ON DELETE CASCADE,
  participant_reference_id UUID NOT NULL
    REFERENCES public.document_participant_references(id) ON DELETE CASCADE,
  visibility_mode TEXT NOT NULL DEFAULT 'allow' CHECK (visibility_mode IN ('allow','deny')),
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from),
  UNIQUE(resource_id, participant_reference_id)
);

CREATE TABLE IF NOT EXISTS public.document_resource_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES public.document_package_resources(id) ON DELETE CASCADE,
  participant_reference_id UUID NOT NULL
    REFERENCES public.document_participant_references(id) ON DELETE RESTRICT,
  interaction_type TEXT NOT NULL CHECK (interaction_type IN ('viewed','accepted','downloaded')),
  event_key TEXT NOT NULL CHECK (length(event_key) BETWEEN 1 AND 240),
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_id, event_key)
);

CREATE TABLE IF NOT EXISTS public.in_person_signing_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  participant_reference_id UUID NOT NULL
    REFERENCES public.document_participant_references(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','started','completed','cancelled','expired')),
  allowed_actions TEXT[] NOT NULL DEFAULT ARRAY['view','requirements','sign']::TEXT[],
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  expires_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  start_claim_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (expires_at > created_at),
  CHECK (allowed_actions <@ ARRAY['view','requirements','sign']::TEXT[]),
  CHECK ((status <> 'started') OR started_at IS NOT NULL),
  CHECK ((status <> 'completed') OR (completed_at IS NOT NULL AND revoked_at IS NOT NULL)),
  CHECK ((status <> 'cancelled') OR (cancelled_at IS NOT NULL AND revoked_at IS NOT NULL)),
  CHECK ((status <> 'expired') OR revoked_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS in_person_sessions_one_active_participant_idx
  ON public.in_person_signing_sessions(document_id, participant_reference_id)
  WHERE status IN ('created','started') AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS document_package_resources_document_idx
  ON public.document_package_resources(document_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS participant_requirements_owner_idx
  ON public.participant_document_requirements(document_id, participant_reference_id, status);
CREATE INDEX IF NOT EXISTS document_resource_visibility_participant_idx
  ON public.document_resource_visibility(participant_reference_id, document_id, resource_id);
CREATE INDEX IF NOT EXISTS document_resource_interactions_lookup_idx
  ON public.document_resource_interactions(resource_id, participant_reference_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS in_person_sessions_expiration_idx
  ON public.in_person_signing_sessions(expires_at) WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.is_current_document_participant_reference(p_reference_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.document_participant_references participant
    WHERE participant.id = p_reference_id
      AND participant.active = true
      AND (
        participant.participant_user_id = auth.uid()
        OR participant.participant_email_normalized = lower(COALESCE(auth.jwt() ->> 'email', ''))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_document_package(p_document_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.documentos document
    WHERE document.id = p_document_id
      AND (
        document.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.workspace_members membership
          WHERE membership.workspace_id = document.workspace_id
            AND membership.user_id = auth.uid()
            AND membership.status = 'active'
            AND lower(membership.role::TEXT) IN ('owner','admin','workspace_admin')
            AND (membership.access_expires_at IS NULL OR membership.access_expires_at > CURRENT_TIMESTAMP)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_document_package_resource(p_resource_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.document_package_resources resource
    WHERE resource.id = p_resource_id
      AND resource.deleted_at IS NULL
      AND public.can_access_documento(resource.document_id)
      AND (
        public.can_manage_document_package(resource.document_id)
        OR EXISTS (
          SELECT 1
          FROM public.document_participant_references participant
          WHERE participant.document_id = resource.document_id
            AND public.is_current_document_participant_reference(participant.id)
            AND (
              NOT EXISTS (
                SELECT 1 FROM public.document_resource_visibility configured
                WHERE configured.resource_id = resource.id
              )
              OR EXISTS (
                SELECT 1 FROM public.document_resource_visibility visible
                WHERE visible.resource_id = resource.id
                  AND visible.participant_reference_id = participant.id
                  AND visible.visibility_mode = 'allow'
                  AND (visible.valid_from IS NULL OR visible.valid_from <= CURRENT_TIMESTAMP)
                  AND (visible.valid_until IS NULL OR visible.valid_until > CURRENT_TIMESTAMP)
              )
            )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_current_document_participant_reference(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_document_package(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_document_package_resource(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_current_document_participant_reference(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_document_package(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_document_package_resource(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_document_package_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_document public.documentos%ROWTYPE;
  v_package public.document_packages%ROWTYPE;
  v_resource public.document_package_resources%ROWTYPE;
BEGIN
  SELECT * INTO v_document FROM public.documentos WHERE id = NEW.document_id;
  IF NOT FOUND OR v_document.workspace_id IS NULL THEN
    RAISE EXCEPTION 'document_package_document_scope_invalid' USING ERRCODE = '23514';
  END IF;
  NEW.workspace_id := v_document.workspace_id;

  IF TG_TABLE_NAME <> 'document_packages' THEN
    SELECT * INTO v_package FROM public.document_packages WHERE id = NEW.package_id;
    IF NOT FOUND OR v_package.document_id <> NEW.document_id OR v_package.workspace_id <> NEW.workspace_id THEN
      RAISE EXCEPTION 'document_package_scope_mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'participant_document_requirements' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.document_participant_references participant
      WHERE participant.id = NEW.participant_reference_id
        AND participant.document_id = NEW.document_id
        AND participant.workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION 'participant_requirement_scope_mismatch' USING ERRCODE = '23514';
    END IF;
    IF NEW.provided_resource_id IS NOT NULL THEN
      SELECT * INTO v_resource FROM public.document_package_resources
      WHERE id = NEW.provided_resource_id;
      IF NOT FOUND OR v_resource.document_id <> NEW.document_id
         OR v_resource.resource_kind <> 'participant_attachment' THEN
        RAISE EXCEPTION 'participant_requirement_resource_scope_mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_document_resource_relation_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_resource public.document_package_resources%ROWTYPE;
BEGIN
  SELECT * INTO v_resource FROM public.document_package_resources WHERE id = NEW.resource_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'package_resource_not_found' USING ERRCODE = '23503'; END IF;
  NEW.document_id := v_resource.document_id;
  NEW.workspace_id := v_resource.workspace_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.document_participant_references participant
    WHERE participant.id = NEW.participant_reference_id
      AND participant.document_id = NEW.document_id
      AND participant.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'package_resource_participant_scope_mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_in_person_session_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_document public.documentos%ROWTYPE;
BEGIN
  SELECT * INTO v_document FROM public.documentos WHERE id = NEW.document_id;
  IF NOT FOUND OR v_document.workspace_id IS NULL THEN
    RAISE EXCEPTION 'in_person_document_scope_invalid' USING ERRCODE = '23514';
  END IF;
  IF lower(COALESCE(v_document.estado, '')) <> 'en_proceso'
     OR (v_document.tiene_vencimiento = true AND v_document.fecha_vencimiento <= CURRENT_TIMESTAMP) THEN
    RAISE EXCEPTION 'in_person_document_not_eligible' USING ERRCODE = '55000';
  END IF;
  NEW.workspace_id := v_document.workspace_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.document_participant_references participant
    WHERE participant.id = NEW.participant_reference_id
      AND participant.document_id = NEW.document_id
      AND participant.workspace_id = NEW.workspace_id
      AND participant.active = true
      AND lower(COALESCE(participant.snapshot ->> 'acto', '')) = 'firmante'
  ) THEN
    RAISE EXCEPTION 'in_person_participant_scope_mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_legal_hold_package_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_document_id UUID := OLD.document_id;
BEGIN
  IF public.has_active_document_legal_hold(v_document_id) THEN
    RAISE EXCEPTION 'LEGAL_HOLD_PACKAGE_RESOURCE_PRESERVED' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS enforce_document_package_scope ON public.document_packages;
CREATE TRIGGER enforce_document_package_scope
  BEFORE INSERT OR UPDATE OF document_id, workspace_id ON public.document_packages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_document_package_scope();
DROP TRIGGER IF EXISTS enforce_document_package_resource_scope ON public.document_package_resources;
CREATE TRIGGER enforce_document_package_resource_scope
  BEFORE INSERT OR UPDATE OF package_id, document_id, workspace_id ON public.document_package_resources
  FOR EACH ROW EXECUTE FUNCTION public.enforce_document_package_scope();
DROP TRIGGER IF EXISTS enforce_participant_requirement_scope ON public.participant_document_requirements;
CREATE TRIGGER enforce_participant_requirement_scope
  BEFORE INSERT OR UPDATE OF package_id, document_id, workspace_id, participant_reference_id, provided_resource_id
  ON public.participant_document_requirements
  FOR EACH ROW EXECUTE FUNCTION public.enforce_document_package_scope();
DROP TRIGGER IF EXISTS enforce_document_resource_visibility_scope ON public.document_resource_visibility;
CREATE TRIGGER enforce_document_resource_visibility_scope
  BEFORE INSERT OR UPDATE OF resource_id, document_id, workspace_id, participant_reference_id
  ON public.document_resource_visibility
  FOR EACH ROW EXECUTE FUNCTION public.enforce_document_resource_relation_scope();
DROP TRIGGER IF EXISTS enforce_document_resource_interaction_scope ON public.document_resource_interactions;
CREATE TRIGGER enforce_document_resource_interaction_scope
  BEFORE INSERT OR UPDATE OF resource_id, document_id, workspace_id, participant_reference_id
  ON public.document_resource_interactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_document_resource_relation_scope();
DROP TRIGGER IF EXISTS enforce_in_person_session_scope ON public.in_person_signing_sessions;
CREATE TRIGGER enforce_in_person_session_scope
  BEFORE INSERT OR UPDATE OF document_id, workspace_id, participant_reference_id
  ON public.in_person_signing_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_in_person_session_scope();

DROP TRIGGER IF EXISTS protect_package_resource_legal_hold ON public.document_package_resources;
CREATE TRIGGER protect_package_resource_legal_hold
  BEFORE DELETE ON public.document_package_resources
  FOR EACH ROW EXECUTE FUNCTION public.prevent_legal_hold_package_deletion();
DROP TRIGGER IF EXISTS protect_requirement_legal_hold ON public.participant_document_requirements;
CREATE TRIGGER protect_requirement_legal_hold
  BEFORE DELETE ON public.participant_document_requirements
  FOR EACH ROW EXECUTE FUNCTION public.prevent_legal_hold_package_deletion();

CREATE OR REPLACE FUNCTION public.complete_in_person_session_from_participant_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  participant JSONB;
  v_reference UUID;
  v_state TEXT;
BEGIN
  IF NEW.participantes IS NULL OR jsonb_typeof(NEW.participantes) <> 'array' THEN RETURN NEW; END IF;
  FOR participant IN SELECT value FROM jsonb_array_elements(NEW.participantes)
  LOOP
    IF COALESCE(participant ->> 'participant_ref_id', '')
       !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      CONTINUE;
    END IF;
    v_reference := (participant ->> 'participant_ref_id')::UUID;
    v_state := lower(COALESCE(participant ->> 'sub_estado', participant ->> 'estado', ''));
    IF COALESCE(participant ->> 'delivery_mode', 'remote') <> 'in_person' THEN
      CONTINUE;
    END IF;
    IF v_state = ANY(ARRAY['firmo','firmado','aprobo','aprobado']) THEN
      UPDATE public.in_person_signing_sessions session
      SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
          revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE session.document_id = NEW.id
        AND session.participant_reference_id = v_reference
        AND session.status = 'started'
        AND session.revoked_at IS NULL;

      INSERT INTO public.document_operational_events (
        workspace_id, document_id, participant_reference_id, event_type,
        event_key, correlation_id, source, payload
      )
      SELECT session.workspace_id, session.document_id, session.participant_reference_id,
        'in_person_session.completed', 'in-person:' || session.id::TEXT || ':completed',
        session.correlation_id, 'database',
        jsonb_build_object('session_id', session.id, 'participant_state', v_state)
      FROM public.in_person_signing_sessions session
      WHERE session.document_id = NEW.id
        AND session.participant_reference_id = v_reference
        AND session.status = 'completed'
      ON CONFLICT (document_id, event_key) DO NOTHING;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS complete_in_person_session_from_participant_state ON public.documentos;
CREATE TRIGGER complete_in_person_session_from_participant_state
  AFTER UPDATE OF participantes ON public.documentos
  FOR EACH ROW EXECUTE FUNCTION public.complete_in_person_session_from_participant_state();

ALTER TABLE public.document_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_package_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participant_document_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_resource_visibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_resource_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.in_person_signing_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_packages_read ON public.document_packages;
CREATE POLICY document_packages_read ON public.document_packages FOR SELECT TO authenticated
  USING (public.can_access_documento(document_id));
DROP POLICY IF EXISTS document_package_resources_read ON public.document_package_resources;
CREATE POLICY document_package_resources_read ON public.document_package_resources FOR SELECT TO authenticated
  USING (public.can_view_document_package_resource(id));
DROP POLICY IF EXISTS participant_requirements_read ON public.participant_document_requirements;
CREATE POLICY participant_requirements_read ON public.participant_document_requirements FOR SELECT TO authenticated
  USING (
    public.can_manage_document_package(document_id)
    OR public.is_current_document_participant_reference(participant_reference_id)
  );
DROP POLICY IF EXISTS document_resource_visibility_read ON public.document_resource_visibility;
CREATE POLICY document_resource_visibility_read ON public.document_resource_visibility FOR SELECT TO authenticated
  USING (
    public.can_manage_document_package(document_id)
    OR public.is_current_document_participant_reference(participant_reference_id)
  );
DROP POLICY IF EXISTS document_resource_interactions_read ON public.document_resource_interactions;
CREATE POLICY document_resource_interactions_read ON public.document_resource_interactions FOR SELECT TO authenticated
  USING (
    public.can_manage_document_package(document_id)
    OR public.is_current_document_participant_reference(participant_reference_id)
  );

REVOKE ALL ON public.document_packages, public.document_package_resources,
  public.participant_document_requirements, public.document_resource_visibility,
  public.document_resource_interactions, public.in_person_signing_sessions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.document_packages, public.document_package_resources,
  public.participant_document_requirements, public.document_resource_visibility,
  public.document_resource_interactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_packages,
  public.document_package_resources, public.participant_document_requirements,
  public.document_resource_visibility, public.document_resource_interactions,
  public.in_person_signing_sessions TO service_role;

INSERT INTO public.platform_feature_flags (
  flag_key, name, description, global_enabled, rollout_percentage, allowed_plans
) VALUES
  ('document_package_resources', 'Recursos de paquete documental', 'Habilita recursos complementarios vinculados a documentos.', false, 0, '{}'),
  ('participant_document_requirements', 'Requisitos del participante', 'Habilita anexos solicitados por participante estable.', false, 0, '{}'),
  ('granular_participant_visibility', 'Visibilidad granular', 'Habilita reglas de visibilidad por recurso y participante.', false, 0, '{}')
ON CONFLICT (flag_key) DO NOTHING;

COMMENT ON TABLE public.document_packages IS
  'Optional additive package around a canonical document; historical documents need no row.';
COMMENT ON TABLE public.in_person_signing_sessions IS
  'Hashed, expiring, revocable, single-purpose handoff sessions. Raw tokens are never persisted.';
