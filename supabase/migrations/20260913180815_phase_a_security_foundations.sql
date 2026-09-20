-- DOCUBOX Phase A: additive security and infrastructure foundations.
-- This migration preserves documentos.participantes JSONB and does not enable
-- any future product capability.

-- Close the SECURITY DEFINER bypasses used immediately before participation
-- advancement. The authenticated actor may mutate only their own active entry.
CREATE OR REPLACE FUNCTION public.update_participante_sub_estado(
  p_documento_id UUID,
  p_email TEXT,
  p_sub_estado TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  document_row public.documentos%ROWTYPE;
  actor_id UUID := auth.uid();
  actor_email TEXT := lower(trim(COALESCE(auth.jwt() ->> 'email', '')));
  requested_state TEXT := lower(trim(COALESCE(p_sub_estado, '')));
BEGIN
  IF actor_id IS NULL OR actor_email = '' OR actor_email <> lower(trim(COALESCE(p_email, ''))) THEN
    RAISE EXCEPTION 'participant_update_forbidden' USING ERRCODE = '42501';
  END IF;
  IF requested_state <> ALL(ARRAY[
    'en_revision','firmo','firmado','aprobo','aprobado',
    'rechazo','rechazado','cancelo','cancelado'
  ]) THEN
    RAISE EXCEPTION 'participant_state_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT document.*
  INTO document_row
  FROM public.documentos document
  WHERE document.id = p_documento_id
  FOR UPDATE;
  IF NOT FOUND
     OR lower(COALESCE(document_row.estado, '')) = ANY(
       ARRAY['completado','cancelado','rechazado','vencido','expirado']
     )
     OR (
       document_row.tiene_vencimiento = true
       AND document_row.fecha_vencimiento IS NOT NULL
       AND document_row.fecha_vencimiento <= CURRENT_TIMESTAMP
     )
     OR NOT EXISTS (
       SELECT 1
       FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(document_row.participantes) = 'array'
           THEN document_row.participantes ELSE '[]'::JSONB END
       ) participant
       WHERE (
         lower(trim(COALESCE(participant ->> 'email', ''))) = actor_email
         OR participant ->> 'user_id' = actor_id::TEXT
         OR participant ->> 'id' = actor_id::TEXT
       )
         AND COALESCE((participant ->> 'visible')::BOOLEAN, true) = true
         AND lower(COALESCE(participant ->> 'current_access', 'active'))
           <> ALL(ARRAY['false','0','no','revoked','suspended','removed','hidden'])
         AND lower(COALESCE(participant ->> 'sub_estado', participant ->> 'estado', ''))
           <> ALL(ARRAY['firmo','firmado','aprobo','aprobado','rechazo','rechazado','cancelo','cancelado'])
     ) THEN
    RAISE EXCEPTION 'participant_update_forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.documentos document
  SET participantes = (
    SELECT jsonb_agg(
      CASE
        WHEN (
          lower(trim(COALESCE(participant ->> 'email', ''))) = actor_email
          OR participant ->> 'user_id' = actor_id::TEXT
          OR participant ->> 'id' = actor_id::TEXT
        ) THEN jsonb_set(participant, '{sub_estado}', to_jsonb(requested_state), true)
        ELSE participant
      END
      ORDER BY participant_order
    )
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(document.participantes) = 'array'
        THEN document.participantes ELSE '[]'::JSONB END
    )
      WITH ORDINALITY AS item(participant, participant_order)
  )
  WHERE document.id = p_documento_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_participante_sub_estado(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_participante_sub_estado(UUID, TEXT, TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.update_participante_estado(
  p_documento_id UUID,
  p_email TEXT,
  p_estado TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  document_row public.documentos%ROWTYPE;
  actor_id UUID := auth.uid();
  actor_email TEXT := lower(trim(COALESCE(auth.jwt() ->> 'email', '')));
  requested_state TEXT := lower(trim(COALESCE(p_estado, '')));
BEGIN
  IF actor_id IS NULL OR actor_email = '' OR actor_email <> lower(trim(COALESCE(p_email, ''))) THEN
    RAISE EXCEPTION 'participant_update_forbidden' USING ERRCODE = '42501';
  END IF;
  IF requested_state <> 'firmado' THEN
    RAISE EXCEPTION 'participant_state_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT document.*
  INTO document_row
  FROM public.documentos document
  WHERE document.id = p_documento_id
  FOR UPDATE;
  IF NOT FOUND
     OR lower(COALESCE(document_row.estado, '')) = ANY(
       ARRAY['completado','cancelado','rechazado','vencido','expirado']
     )
     OR (
       document_row.tiene_vencimiento = true
       AND document_row.fecha_vencimiento IS NOT NULL
       AND document_row.fecha_vencimiento <= CURRENT_TIMESTAMP
     )
     OR NOT EXISTS (
       SELECT 1
       FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(document_row.participantes) = 'array'
           THEN document_row.participantes ELSE '[]'::JSONB END
       ) participant
       WHERE (
         lower(trim(COALESCE(participant ->> 'email', ''))) = actor_email
         OR participant ->> 'user_id' = actor_id::TEXT
         OR participant ->> 'id' = actor_id::TEXT
       )
         AND COALESCE((participant ->> 'visible')::BOOLEAN, true) = true
         AND lower(COALESCE(participant ->> 'current_access', 'active'))
           <> ALL(ARRAY['false','0','no','revoked','suspended','removed','hidden'])
         AND lower(COALESCE(participant ->> 'sub_estado', ''))
           = ANY(ARRAY['firmo','firmado','aprobo','aprobado'])
     ) THEN
    RAISE EXCEPTION 'participant_update_forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.documentos document
  SET participantes = (
    SELECT jsonb_agg(
      CASE
        WHEN (
          lower(trim(COALESCE(participant ->> 'email', ''))) = actor_email
          OR participant ->> 'user_id' = actor_id::TEXT
          OR participant ->> 'id' = actor_id::TEXT
        ) THEN jsonb_set(participant, '{estado}', to_jsonb(requested_state), true)
        ELSE participant
      END
      ORDER BY participant_order
    )
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(document.participantes) = 'array'
        THEN document.participantes ELSE '[]'::JSONB END
    )
      WITH ORDINALITY AS item(participant, participant_order)
  )
  WHERE document.id = p_documento_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_participante_estado(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_participante_estado(UUID, TEXT, TEXT)
  TO authenticated;

CREATE TABLE IF NOT EXISTS public.document_participant_references (
  id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  participant_json_id TEXT,
  participant_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  participant_email_normalized TEXT,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_at TIMESTAMPTZ,
  UNIQUE(document_id, id)
);

CREATE INDEX IF NOT EXISTS document_participant_refs_document_active_idx
  ON public.document_participant_references(document_id, active, ordinal);
CREATE INDEX IF NOT EXISTS document_participant_refs_workspace_idx
  ON public.document_participant_references(workspace_id, document_id);
CREATE INDEX IF NOT EXISTS document_participant_refs_user_idx
  ON public.document_participant_references(participant_user_id, document_id)
  WHERE participant_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS document_participant_refs_email_idx
  ON public.document_participant_references(participant_email_normalized, document_id)
  WHERE participant_email_normalized IS NOT NULL;

COMMENT ON TABLE public.document_participant_references IS
  'Additive stable identity bridge for participantes JSONB. JSONB remains the canonical backwards-compatible document representation.';
COMMENT ON COLUMN public.document_participant_references.id IS
  'Stable UUID mirrored in each JSONB participant as participant_ref_id.';

CREATE OR REPLACE FUNCTION public.enforce_document_participant_reference_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  document_workspace UUID;
BEGIN
  SELECT document.workspace_id
  INTO document_workspace
  FROM public.documentos document
  WHERE document.id = NEW.document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_participant_reference_document_not_found' USING ERRCODE = '23503';
  END IF;
  NEW.workspace_id := document_workspace;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_document_participant_reference_scope()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_document_participant_reference_scope
  ON public.document_participant_references;
CREATE TRIGGER enforce_document_participant_reference_scope
  BEFORE INSERT OR UPDATE OF document_id, workspace_id
  ON public.document_participant_references
  FOR EACH ROW EXECUTE FUNCTION public.enforce_document_participant_reference_scope();

CREATE OR REPLACE FUNCTION public.ensure_document_participant_reference_ids()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  participant JSONB;
  prior JSONB;
  reference_text TEXT;
  result JSONB := '[]'::JSONB;
  used_references TEXT[] := ARRAY[]::TEXT[];
  position_index INTEGER := 0;
BEGIN
  IF NEW.participantes IS NULL OR jsonb_typeof(NEW.participantes) <> 'array' THEN
    RETURN NEW;
  END IF;

  FOR participant IN SELECT value FROM jsonb_array_elements(NEW.participantes)
  LOOP
    IF jsonb_typeof(participant) <> 'object' THEN
      result := result || jsonb_build_array(participant);
      position_index := position_index + 1;
      CONTINUE;
    END IF;

    reference_text := participant ->> 'participant_ref_id';
    IF reference_text IS NULL
       OR reference_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR reference_text = ANY(used_references)
       OR EXISTS (
         SELECT 1 FROM public.document_participant_references existing
         WHERE existing.id = reference_text::UUID AND existing.document_id <> NEW.id
       ) THEN
      reference_text := NULL;
    END IF;

    IF reference_text IS NULL AND TG_OP = 'UPDATE'
       AND OLD.participantes IS NOT NULL
       AND jsonb_typeof(OLD.participantes) = 'array' THEN
      SELECT candidate ->> 'participant_ref_id'
      INTO reference_text
      FROM jsonb_array_elements(OLD.participantes) candidate
      WHERE (candidate ->> 'participant_ref_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND NOT ((candidate ->> 'participant_ref_id') = ANY(used_references))
        AND (
          (NULLIF(participant ->> 'id', '') IS NOT NULL AND candidate ->> 'id' = participant ->> 'id')
          OR (NULLIF(participant ->> 'user_id', '') IS NOT NULL AND candidate ->> 'user_id' = participant ->> 'user_id')
          OR (
            NULLIF(lower(trim(participant ->> 'email')), '') IS NOT NULL
            AND lower(trim(candidate ->> 'email')) = lower(trim(participant ->> 'email'))
          )
        )
      LIMIT 1;
    END IF;

    -- Historical rows are seeded in the bridge without rewriting their JSONB.
    -- Reuse that stable identity on the next legitimate participant update.
    IF reference_text IS NULL THEN
      SELECT existing.id::TEXT
      INTO reference_text
      FROM public.document_participant_references existing
      WHERE existing.document_id = NEW.id
        AND existing.active = true
        AND NOT (existing.id::TEXT = ANY(used_references))
        AND (
          (NULLIF(participant ->> 'id', '') IS NOT NULL
            AND existing.participant_json_id = participant ->> 'id')
          OR (NULLIF(participant ->> 'user_id', '') IS NOT NULL
            AND existing.participant_user_id::TEXT = participant ->> 'user_id')
          OR (NULLIF(lower(trim(participant ->> 'email')), '') IS NOT NULL
            AND existing.participant_email_normalized = lower(trim(participant ->> 'email')))
          OR existing.ordinal = position_index
        )
      ORDER BY
        CASE WHEN existing.ordinal = position_index THEN 0 ELSE 1 END,
        existing.first_seen_at
      LIMIT 1;
    END IF;

    IF reference_text IS NULL THEN
      reference_text := gen_random_uuid()::TEXT;
    END IF;
    used_references := array_append(used_references, reference_text);
    result := result || jsonb_build_array(
      jsonb_set(participant, '{participant_ref_id}', to_jsonb(reference_text), true)
    );
    position_index := position_index + 1;
  END LOOP;

  NEW.participantes := result;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_document_participant_reference_ids() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_document_participant_references()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  participant JSONB;
  reference_id UUID;
  position_index INTEGER := 0;
  active_references UUID[] := ARRAY[]::UUID[];
  user_id UUID;
BEGIN
  IF NEW.participantes IS NOT NULL AND jsonb_typeof(NEW.participantes) = 'array' THEN
    FOR participant IN SELECT value FROM jsonb_array_elements(NEW.participantes)
    LOOP
      IF jsonb_typeof(participant) <> 'object'
         OR COALESCE(participant ->> 'participant_ref_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        position_index := position_index + 1;
        CONTINUE;
      END IF;
      reference_id := (participant ->> 'participant_ref_id')::UUID;
      active_references := array_append(active_references, reference_id);
      user_id := CASE
        WHEN COALESCE(participant ->> 'user_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN (participant ->> 'user_id')::UUID
        ELSE NULL
      END;

      INSERT INTO public.document_participant_references (
        id, document_id, workspace_id, participant_json_id, participant_user_id,
        participant_email_normalized, ordinal, active, snapshot, last_seen_at, removed_at
      ) VALUES (
        reference_id,
        NEW.id,
        NEW.workspace_id,
        NULLIF(participant ->> 'id', ''),
        user_id,
        NULLIF(lower(trim(participant ->> 'email')), ''),
        position_index,
        true,
        participant,
        CURRENT_TIMESTAMP,
        NULL
      )
      ON CONFLICT (id) DO UPDATE SET
        workspace_id = EXCLUDED.workspace_id,
        participant_json_id = EXCLUDED.participant_json_id,
        participant_user_id = EXCLUDED.participant_user_id,
        participant_email_normalized = EXCLUDED.participant_email_normalized,
        ordinal = EXCLUDED.ordinal,
        active = true,
        snapshot = EXCLUDED.snapshot,
        last_seen_at = CURRENT_TIMESTAMP,
        removed_at = NULL
      WHERE public.document_participant_references.document_id = EXCLUDED.document_id;
      position_index := position_index + 1;
    END LOOP;
  END IF;

  UPDATE public.document_participant_references reference
  SET active = false,
      last_seen_at = CURRENT_TIMESTAMP,
      removed_at = COALESCE(reference.removed_at, CURRENT_TIMESTAMP)
  WHERE reference.document_id = NEW.id
    AND reference.active = true
    AND NOT (reference.id = ANY(active_references));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_document_participant_references() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ensure_document_participant_reference_ids ON public.documentos;
CREATE TRIGGER ensure_document_participant_reference_ids
  BEFORE INSERT OR UPDATE OF participantes ON public.documentos
  FOR EACH ROW EXECUTE FUNCTION public.ensure_document_participant_reference_ids();

DROP TRIGGER IF EXISTS sync_document_participant_references ON public.documentos;
CREATE TRIGGER sync_document_participant_references
  AFTER INSERT OR UPDATE OF participantes, workspace_id ON public.documentos
  FOR EACH ROW EXECUTE FUNCTION public.sync_document_participant_references();

ALTER TABLE public.document_participant_references ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_participant_references_read ON public.document_participant_references;
CREATE POLICY document_participant_references_read
  ON public.document_participant_references FOR SELECT TO authenticated
  USING (public.can_access_documento(document_id));

REVOKE ALL ON public.document_participant_references FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.document_participant_references TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_participant_references TO service_role;

-- Seed historical identities in the additive bridge only. Existing document
-- JSONB, signed artefacts, hashes and evidence inputs remain byte-for-byte intact.
INSERT INTO public.document_participant_references (
  id, document_id, workspace_id, participant_json_id, participant_user_id,
  participant_email_normalized, ordinal, active, snapshot
)
SELECT
  CASE
    WHEN COALESCE(item.participant ->> 'participant_ref_id', '')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND NOT EXISTS (
        SELECT 1
        FROM public.document_participant_references collision
        WHERE collision.id = (item.participant ->> 'participant_ref_id')::UUID
          AND collision.document_id <> document.id
      )
      THEN (item.participant ->> 'participant_ref_id')::UUID
    ELSE gen_random_uuid()
  END,
  document.id,
  document.workspace_id,
  NULLIF(item.participant ->> 'id', ''),
  CASE
    WHEN COALESCE(item.participant ->> 'user_id', '')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (item.participant ->> 'user_id')::UUID
    ELSE NULL
  END,
  NULLIF(lower(trim(item.participant ->> 'email')), ''),
  item.ordinality::INTEGER - 1,
  true,
  item.participant
FROM public.documentos document
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(document.participantes) = 'array' THEN document.participantes
    ELSE '[]'::JSONB
  END
)
  WITH ORDINALITY AS item(participant, ordinality)
WHERE jsonb_typeof(document.participantes) = 'array'
  AND jsonb_typeof(item.participant) = 'object'
  AND NOT EXISTS (
    SELECT 1
    FROM public.document_participant_references existing
    WHERE existing.document_id = document.id
      AND (
        (COALESCE(item.participant ->> 'participant_ref_id', '')
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          AND existing.id = (item.participant ->> 'participant_ref_id')::UUID)
        OR (NULLIF(item.participant ->> 'id', '') IS NOT NULL
          AND existing.participant_json_id = item.participant ->> 'id')
        OR (NULLIF(item.participant ->> 'user_id', '') IS NOT NULL
          AND existing.participant_user_id::TEXT = item.participant ->> 'user_id')
        OR (NULLIF(lower(trim(item.participant ->> 'email')), '') IS NOT NULL
          AND existing.participant_email_normalized = lower(trim(item.participant ->> 'email')))
        OR existing.ordinal = item.ordinality::INTEGER - 1
      )
  )
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.document_operational_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  participant_reference_id UUID REFERENCES public.document_participant_references(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.-]{2,120}$'),
  event_key TEXT NOT NULL CHECK (length(event_key) BETWEEN 1 AND 240),
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  causation_id UUID REFERENCES public.document_operational_events(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'system' CHECK (source IN ('api','database','worker','system')),
  payload JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_id, event_key)
);

CREATE INDEX IF NOT EXISTS document_operational_events_workspace_idx
  ON public.document_operational_events(workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS document_operational_events_document_idx
  ON public.document_operational_events(document_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS document_operational_events_correlation_idx
  ON public.document_operational_events(correlation_id, occurred_at);
CREATE INDEX IF NOT EXISTS document_operational_events_pending_type_idx
  ON public.document_operational_events(event_type, occurred_at);

COMMENT ON TABLE public.document_operational_events IS
  'Canonical retry-safe operational events for future routing, notifications, webhooks and automation. This table does not replace legal or security audit logs.';

CREATE OR REPLACE FUNCTION public.enforce_document_operational_event_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  document_workspace UUID;
BEGIN
  SELECT document.workspace_id
  INTO document_workspace
  FROM public.documentos document
  WHERE document.id = NEW.document_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_operational_event_document_not_found' USING ERRCODE = '23503';
  END IF;
  NEW.workspace_id := document_workspace;

  IF NEW.participant_reference_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.document_participant_references participant
       WHERE participant.id = NEW.participant_reference_id
         AND participant.document_id = NEW.document_id
     ) THEN
    RAISE EXCEPTION 'document_operational_event_participant_scope_mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_document_operational_event_scope()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_document_operational_event_scope
  ON public.document_operational_events;
CREATE TRIGGER enforce_document_operational_event_scope
  BEFORE INSERT OR UPDATE OF document_id, workspace_id, participant_reference_id
  ON public.document_operational_events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_document_operational_event_scope();

ALTER TABLE public.document_operational_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_operational_events_read ON public.document_operational_events;
CREATE POLICY document_operational_events_read
  ON public.document_operational_events FOR SELECT TO authenticated
  USING (public.can_access_documento(document_id));

REVOKE ALL ON public.document_operational_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.document_operational_events TO authenticated;
GRANT SELECT, INSERT ON public.document_operational_events TO service_role;

CREATE OR REPLACE FUNCTION public.emit_document_transition_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  event_name TEXT;
  participant JSONB;
  previous_participant JSONB;
  participant_reference UUID;
  new_state TEXT;
  old_state TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.document_operational_events (
      workspace_id, document_id, event_type, event_key, source, payload
    ) VALUES (
      NEW.workspace_id, NEW.id, 'document.created', 'document:created', 'database',
      jsonb_build_object('status', NEW.estado)
    ) ON CONFLICT (document_id, event_key) DO NOTHING;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.estado IS DISTINCT FROM OLD.estado THEN
    event_name := CASE lower(COALESCE(NEW.estado, ''))
      WHEN 'en_proceso' THEN 'document.sent'
      WHEN 'completado' THEN 'document.completed'
      WHEN 'cancelado' THEN 'document.cancelled'
      WHEN 'vencido' THEN 'document.expired'
      WHEN 'expirado' THEN 'document.expired'
      ELSE NULL
    END;
    IF event_name IS NOT NULL THEN
      INSERT INTO public.document_operational_events (
        workspace_id, document_id, event_type, event_key, source, payload
      ) VALUES (
        NEW.workspace_id, NEW.id, event_name, 'status:' || lower(NEW.estado), 'database',
        jsonb_build_object('previous_status', OLD.estado, 'status', NEW.estado)
      ) ON CONFLICT (document_id, event_key) DO NOTHING;
    END IF;
  ELSIF TG_OP = 'INSERT' AND lower(COALESCE(NEW.estado, '')) = 'en_proceso' THEN
    INSERT INTO public.document_operational_events (
      workspace_id, document_id, event_type, event_key, source, payload
    ) VALUES (
      NEW.workspace_id, NEW.id, 'document.sent', 'status:en_proceso', 'database',
      jsonb_build_object('status', NEW.estado)
    ) ON CONFLICT (document_id, event_key) DO NOTHING;
  END IF;

  IF NEW.participantes IS NULL OR jsonb_typeof(NEW.participantes) <> 'array' THEN
    RETURN NEW;
  END IF;
  FOR participant IN SELECT value FROM jsonb_array_elements(NEW.participantes)
  LOOP
    IF COALESCE(participant ->> 'participant_ref_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      CONTINUE;
    END IF;
    participant_reference := (participant ->> 'participant_ref_id')::UUID;
    previous_participant := NULL;
    IF TG_OP = 'UPDATE' AND OLD.participantes IS NOT NULL AND jsonb_typeof(OLD.participantes) = 'array' THEN
      SELECT candidate INTO previous_participant
      FROM jsonb_array_elements(OLD.participantes) candidate
      WHERE candidate ->> 'participant_ref_id' = participant ->> 'participant_ref_id'
      LIMIT 1;
    END IF;

    IF lower(COALESCE(NEW.estado, '')) = 'en_proceso'
       AND (previous_participant IS NULL OR COALESCE((previous_participant ->> 'visible')::BOOLEAN, false) = false)
       AND COALESCE((participant ->> 'visible')::BOOLEAN, false) = true THEN
      INSERT INTO public.document_operational_events (
        workspace_id, document_id, participant_reference_id, event_type, event_key, source, payload
      ) VALUES (
        NEW.workspace_id, NEW.id, participant_reference, 'participant.invited',
        'participant:' || participant_reference::TEXT || ':invited', 'database',
        jsonb_build_object('participant_reference_id', participant_reference)
      ) ON CONFLICT (document_id, event_key) DO NOTHING;
    END IF;

    new_state := lower(COALESCE(participant ->> 'sub_estado', participant ->> 'estado', ''));
    old_state := lower(COALESCE(previous_participant ->> 'sub_estado', previous_participant ->> 'estado', ''));
    event_name := CASE
      WHEN new_state = ANY(ARRAY['firmo','firmado','aprobo','aprobado'])
        AND new_state IS DISTINCT FROM old_state THEN 'participant.signed'
      WHEN new_state = ANY(ARRAY['rechazo','rechazado'])
        AND new_state IS DISTINCT FROM old_state THEN 'participant.rejected'
      ELSE NULL
    END;
    IF event_name IS NOT NULL THEN
      INSERT INTO public.document_operational_events (
        workspace_id, document_id, participant_reference_id, event_type, event_key, source, payload
      ) VALUES (
        NEW.workspace_id, NEW.id, participant_reference, event_name,
        'participant:' || participant_reference::TEXT || ':' || event_name, 'database',
        jsonb_build_object('participant_reference_id', participant_reference, 'state', new_state)
      ) ON CONFLICT (document_id, event_key) DO NOTHING;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_document_transition_events() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS emit_document_transition_events ON public.documentos;
DROP TRIGGER IF EXISTS zz_emit_document_transition_events ON public.documentos;
CREATE TRIGGER zz_emit_document_transition_events
  AFTER INSERT OR UPDATE OF estado, participantes ON public.documentos
  FOR EACH ROW EXECUTE FUNCTION public.emit_document_transition_events();

-- Published template content is immutable. A narrow status-only archival
-- transition remains possible and versions are created as separate rows.
CREATE OR REPLACE FUNCTION public.protect_published_template_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF lower(COALESCE(OLD.estado, '')) <> 'published'
     AND lower(COALESCE(OLD.estado_plantilla, '')) <> lower('Publicada') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'published_template_is_immutable' USING ERRCODE = '55000';
  END IF;

  IF lower(COALESCE(NEW.estado, '')) = 'archived'
     AND (
       NEW.estado_plantilla IS NOT DISTINCT FROM OLD.estado_plantilla
       OR lower(COALESCE(NEW.estado_plantilla, '')) IN ('archivada', 'archived')
     )
     AND (
       NEW.publicacion_opcion IS NOT DISTINCT FROM OLD.publicacion_opcion
       OR lower(COALESCE(NEW.publicacion_opcion, '')) IN ('archivada', 'archived', 'archivar')
     )
     AND (to_jsonb(NEW) - ARRAY['estado','estado_plantilla','publicacion_opcion','updated_at'])
       = (to_jsonb(OLD) - ARRAY['estado','estado_plantilla','publicacion_opcion','updated_at']) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'published_template_is_immutable' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS protect_published_template_immutability ON public.plantillas;
CREATE TRIGGER protect_published_template_immutability
  BEFORE UPDATE OR DELETE ON public.plantillas
  FOR EACH ROW EXECUTE FUNCTION public.protect_published_template_immutability();

-- Reuse the existing platform feature-flag control plane. All additions remain
-- globally disabled with zero rollout until a later authorized phase.
INSERT INTO public.platform_feature_flags (
  flag_key, name, description, global_enabled, rollout_percentage, allowed_plans
) VALUES
  ('in_person_signing', 'Firma presencial', 'Habilita sesiones seguras de firma en el mismo dispositivo.', false, 0, '{}'),
  ('scheduled_sending', 'Envío programado', 'Habilita programación controlada del envío documental.', false, 0, '{}'),
  ('agreement_actions', 'Automatizaciones documentales', 'Habilita consumidores de eventos documentales canónicos.', false, 0, '{}'),
  ('signature_delegation', 'Firma delegada', 'Habilita delegación trazable conforme a políticas organizacionales.', false, 0, '{}'),
  ('advanced_signing_groups', 'Grupos de firma avanzados', 'Habilita reglas ANY_ONE, ALL y N_OF_M sobre grupos existentes.', false, 0, '{}')
ON CONFLICT (flag_key) DO NOTHING;
