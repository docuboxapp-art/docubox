-- Phase D: additive organization governance for signing groups, delegation,
-- document custody, electronic witness routing and configurable retention.
-- Existing document JSONB, AUTH-003 completion, evidence and crypto remain canonical.

INSERT INTO public.platform_feature_flags (flag_key, name, description, global_enabled, rollout_percentage, allowed_plans)
VALUES
  ('document_custody_transfer', 'Transferencia de custodia', 'Transferencia interna de custodia documental.', false, 0, '{}'),
  ('organization_retention_policies', 'Retencion organizacional', 'Politicas configurables de retencion organizacional.', false, 0, '{}'),
  ('electronic_witness_routing', 'Testigo electronico', 'Participacion de Testigo en routing documental.', false, 0, '{}')
ON CONFLICT (flag_key) DO NOTHING;

INSERT INTO public.organization_permissions (permission_key, name, description, category)
VALUES
  ('signing_groups.manage', 'Administrar grupos de firma', 'Configurar reglas de finalizacion para grupos.', 'Gobernanza'),
  ('delegation.manage', 'Administrar delegaciones', 'Crear y revocar delegaciones documentales internas.', 'Gobernanza'),
  ('documents.custody.transfer', 'Transferir custodia', 'Transferir custodia administrativa dentro de la organizacion.', 'Documentos'),
  ('retention.read', 'Ver retencion', 'Consultar politicas y asignaciones de retencion.', 'Gobernanza'),
  ('retention.manage', 'Administrar retencion', 'Crear politicas y aplicarlas a documentos.', 'Gobernanza')
ON CONFLICT (permission_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category;

CREATE TABLE IF NOT EXISTS public.document_signing_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  client_group_id TEXT NOT NULL,
  organization_unit_id UUID REFERENCES public.organization_units(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  step_order INTEGER NOT NULL CHECK (step_order >= 0),
  routing_mode TEXT NOT NULL DEFAULT 'parallel' CHECK (routing_mode IN ('parallel','sequential')),
  completion_policy TEXT NOT NULL DEFAULT 'ALL' CHECK (completion_policy IN ('ALL','ANY_ONE')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','satisfied','cancelled')),
  winner_participant_reference_id UUID REFERENCES public.document_participant_references(id) ON DELETE RESTRICT,
  winner_completion_attempt_id UUID REFERENCES public.participant_completion_attempts(id) ON DELETE RESTRICT,
  satisfied_at TIMESTAMPTZ,
  snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_id, client_group_id),
  UNIQUE(document_id, step_order)
);

CREATE TABLE IF NOT EXISTS public.document_signing_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.document_signing_groups(id) ON DELETE CASCADE,
  participant_reference_id UUID NOT NULL REFERENCES public.document_participant_references(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  status TEXT NOT NULL DEFAULT 'eligible' CHECK (status IN ('eligible','completed','superseded','cancelled')),
  completion_attempt_id UUID REFERENCES public.participant_completion_attempts(id) ON DELETE RESTRICT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, participant_reference_id),
  UNIQUE(group_id, ordinal)
);

CREATE TABLE IF NOT EXISTS public.document_participant_delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  original_participant_reference_id UUID NOT NULL REFERENCES public.document_participant_references(id) ON DELETE RESTRICT,
  delegate_member_id UUID NOT NULL REFERENCES public.workspace_members(id) ON DELETE RESTRICT,
  delegate_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  policy_mode TEXT NOT NULL CHECK (policy_mode IN ('ORGANIZATION_ONLY','AUTHORIZED_MEMBERS')),
  policy_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  completed_at TIMESTAMPTZ,
  completion_attempt_id UUID REFERENCES public.participant_completion_attempts(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS document_participant_delegations_one_active_idx
  ON public.document_participant_delegations(document_id, original_participant_reference_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.document_custody_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  previous_custodian_member_id UUID REFERENCES public.workspace_members(id) ON DELETE RESTRICT,
  custodian_member_id UUID NOT NULL REFERENCES public.workspace_members(id) ON DELETE RESTRICT,
  transferred_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 240),
  transferred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMPTZ,
  UNIQUE(document_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS document_custody_one_current_idx
  ON public.document_custody_history(document_id) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS public.organization_retention_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  duration_value INTEGER NOT NULL CHECK (duration_value BETWEEN 1 AND 1200),
  duration_unit TEXT NOT NULL CHECK (duration_unit IN ('days','months','years')),
  applies_to JSONB NOT NULL DEFAULT '{}'::JSONB,
  completion_action TEXT NOT NULL DEFAULT 'review' CHECK (completion_action IN ('review','eligible_for_purge')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','archived')),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id, name, version)
);

CREATE TABLE IF NOT EXISTS public.document_retention_policy_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  policy_id UUID NOT NULL REFERENCES public.organization_retention_policies(id) ON DELETE RESTRICT,
  policy_version INTEGER NOT NULL,
  retention_until TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','released')),
  applied_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TIMESTAMPTZ,
  reason TEXT,
  snapshot JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS document_retention_one_active_idx
  ON public.document_retention_policy_assignments(document_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS document_signing_groups_scope_idx
  ON public.document_signing_groups(workspace_id, document_id, step_order);
CREATE INDEX IF NOT EXISTS document_signing_group_members_scope_idx
  ON public.document_signing_group_members(document_id, participant_reference_id);
CREATE INDEX IF NOT EXISTS participant_delegations_delegate_idx
  ON public.document_participant_delegations(workspace_id, delegate_user_id, status);
CREATE INDEX IF NOT EXISTS document_custody_history_scope_idx
  ON public.document_custody_history(workspace_id, document_id, transferred_at DESC);
CREATE INDEX IF NOT EXISTS retention_policies_scope_idx
  ON public.organization_retention_policies(workspace_id, status, name, version DESC);
CREATE INDEX IF NOT EXISTS retention_assignments_scope_idx
  ON public.document_retention_policy_assignments(workspace_id, document_id, applied_at DESC);

ALTER TABLE public.participant_completion_attempts
  ADD COLUMN IF NOT EXISTS effective_actor_user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS delegation_id UUID REFERENCES public.document_participant_delegations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS requested_action_type TEXT;

ALTER TABLE public.participation_responses
  ADD COLUMN IF NOT EXISTS effective_actor_user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS delegation_id UUID REFERENCES public.document_participant_delegations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS witness_completed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS witness_completed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'participant_completion_requested_action_check'
  ) THEN
    ALTER TABLE public.participant_completion_attempts
      ADD CONSTRAINT participant_completion_requested_action_check
      CHECK (requested_action_type IS NULL OR requested_action_type IN ('signature','approval','witness'));
  END IF;
END $$;

ALTER TABLE public.document_signing_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_signing_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_participant_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_custody_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_retention_policy_assignments ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.document_signing_groups, public.document_signing_group_members,
  public.document_participant_delegations, public.document_custody_history,
  public.organization_retention_policies, public.document_retention_policy_assignments
  TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.document_signing_groups, public.document_signing_group_members,
  public.document_participant_delegations, public.document_custody_history,
  public.organization_retention_policies, public.document_retention_policy_assignments
  FROM anon, authenticated;

CREATE POLICY "organization_members_read_signing_groups"
  ON public.document_signing_groups FOR SELECT TO authenticated
  USING ((SELECT public.can_access_documento(document_id)));
CREATE POLICY "organization_members_read_signing_group_members"
  ON public.document_signing_group_members FOR SELECT TO authenticated
  USING ((SELECT public.can_access_documento(document_id)));
CREATE POLICY "organization_members_read_delegations"
  ON public.document_participant_delegations FOR SELECT TO authenticated
  USING ((SELECT public.can_access_documento(document_id)) OR delegate_user_id = (SELECT auth.uid()));
CREATE POLICY "organization_members_read_custody"
  ON public.document_custody_history FOR SELECT TO authenticated
  USING ((SELECT public.can_access_documento(document_id)));
CREATE POLICY "organization_members_read_retention_policies"
  ON public.organization_retention_policies FOR SELECT TO authenticated
  USING ((SELECT public.has_organization_permission(workspace_id, 'retention.read')));
CREATE POLICY "organization_members_read_retention_assignments"
  ON public.document_retention_policy_assignments FOR SELECT TO authenticated
  USING ((SELECT public.can_access_documento(document_id)));

CREATE OR REPLACE FUNCTION public.snapshot_document_signing_groups(p_document_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_document public.documentos%ROWTYPE;
  v_group JSONB;
  v_group_id UUID;
  v_group_order INTEGER := 0;
  v_member_id TEXT;
  v_member_order INTEGER;
  v_inserted INTEGER := 0;
BEGIN
  SELECT * INTO v_document FROM public.documentos WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND OR v_document.workspace_id IS NULL THEN
    RAISE EXCEPTION 'PHASE_D_ORGANIZATION_DOCUMENT_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.document_signing_groups WHERE document_id = p_document_id) THEN
    RETURN jsonb_build_object('documentId', p_document_id, 'idempotent', true);
  END IF;

  FOR v_group IN SELECT value FROM jsonb_array_elements(COALESCE(v_document.grupos_firma, '[]'::JSONB))
  LOOP
    INSERT INTO public.document_signing_groups (
      workspace_id, document_id, client_group_id, organization_unit_id, name,
      step_order, routing_mode, completion_policy, snapshot
    ) VALUES (
      v_document.workspace_id,
      p_document_id,
      COALESCE(NULLIF(v_group ->> 'id', ''), 'group-' || v_group_order::TEXT),
      NULLIF(v_group ->> 'organizationUnitId', '')::UUID,
      COALESCE(NULLIF(v_group ->> 'nombre', ''), 'Grupo ' || (v_group_order + 1)::TEXT),
      v_group_order,
      CASE WHEN lower(COALESCE(v_group ->> 'tipo', 'paralelo')) = 'secuencial' THEN 'sequential' ELSE 'parallel' END,
      CASE WHEN upper(COALESCE(v_group ->> 'completionPolicy', 'ALL')) = 'ANY_ONE' THEN 'ANY_ONE' ELSE 'ALL' END,
      v_group
    ) RETURNING id INTO v_group_id;

    v_member_order := 0;
    FOR v_member_id IN SELECT jsonb_array_elements_text(COALESCE(v_group -> 'participantIds', '[]'::JSONB))
    LOOP
      INSERT INTO public.document_signing_group_members (
        workspace_id, document_id, group_id, participant_reference_id, ordinal
      )
      SELECT v_document.workspace_id, p_document_id, v_group_id, reference.id, v_member_order
      FROM public.document_participant_references reference
      WHERE reference.document_id = p_document_id
        AND reference.active = true
        AND (reference.participant_json_id = v_member_id OR reference.id::TEXT = v_member_id)
      ON CONFLICT (group_id, participant_reference_id) DO NOTHING;
      v_member_order := v_member_order + 1;
    END LOOP;
    v_group_order := v_group_order + 1;
    v_inserted := v_inserted + 1;
  END LOOP;
  RETURN jsonb_build_object('documentId', p_document_id, 'groupsCreated', v_inserted, 'idempotent', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_document_custody(
  p_document_id UUID,
  p_workspace_id UUID,
  p_actor_user_id UUID,
  p_custodian_member_id UUID,
  p_reason TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_document public.documentos%ROWTYPE;
  v_current public.document_custody_history%ROWTYPE;
  v_result public.document_custody_history%ROWTYPE;
BEGIN
  SELECT * INTO v_document FROM public.documentos WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND OR v_document.workspace_id IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'CUSTODY_DOCUMENT_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE id = p_custodian_member_id AND workspace_id = p_workspace_id
      AND status = 'active' AND (access_expires_at IS NULL OR access_expires_at > CURRENT_TIMESTAMP)
  ) THEN
    RAISE EXCEPTION 'CUSTODY_MEMBER_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_result FROM public.document_custody_history
  WHERE document_id = p_document_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN to_jsonb(v_result) || jsonb_build_object('idempotent', true); END IF;
  SELECT * INTO v_current FROM public.document_custody_history
  WHERE document_id = p_document_id AND ended_at IS NULL FOR UPDATE;
  IF FOUND AND v_current.custodian_member_id = p_custodian_member_id THEN
    RAISE EXCEPTION 'CUSTODY_ALREADY_ASSIGNED' USING ERRCODE = '55000';
  END IF;
  UPDATE public.document_custody_history SET ended_at = CURRENT_TIMESTAMP
  WHERE document_id = p_document_id AND ended_at IS NULL;
  INSERT INTO public.document_custody_history (
    workspace_id, document_id, previous_custodian_member_id, custodian_member_id,
    transferred_by, reason, idempotency_key
  ) VALUES (
    p_workspace_id, p_document_id, v_current.custodian_member_id, p_custodian_member_id,
    p_actor_user_id, trim(p_reason), trim(p_idempotency_key)
  ) RETURNING * INTO v_result;
  INSERT INTO public.document_operational_events (
    workspace_id, document_id, actor_user_id, event_type, event_key, correlation_id, source, payload
  ) VALUES (
    p_workspace_id, p_document_id, p_actor_user_id, 'document.custody_transferred',
    'custody:' || v_result.id::TEXT, gen_random_uuid(), 'database',
    jsonb_build_object('custody_id', v_result.id, 'previous_member_id', v_current.custodian_member_id,
      'custodian_member_id', p_custodian_member_id)
  ) ON CONFLICT (document_id, event_key) DO NOTHING;
  RETURN to_jsonb(v_result) || jsonb_build_object('idempotent', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_document_retention_policy(
  p_document_id UUID,
  p_workspace_id UUID,
  p_policy_id UUID,
  p_actor_user_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_document public.documentos%ROWTYPE;
  v_policy public.organization_retention_policies%ROWTYPE;
  v_until TIMESTAMPTZ;
  v_assignment public.document_retention_policy_assignments%ROWTYPE;
BEGIN
  SELECT * INTO v_document FROM public.documentos WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND OR v_document.workspace_id IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'RETENTION_DOCUMENT_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_policy FROM public.organization_retention_policies
  WHERE id = p_policy_id AND workspace_id = p_workspace_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'RETENTION_POLICY_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_until := COALESCE(v_document.fecha_completado, v_document.created_at, CURRENT_TIMESTAMP)
    + CASE v_policy.duration_unit
        WHEN 'days' THEN make_interval(days => v_policy.duration_value)
        WHEN 'months' THEN make_interval(months => v_policy.duration_value)
        ELSE make_interval(years => v_policy.duration_value)
      END;
  UPDATE public.document_retention_policy_assignments
  SET status = 'superseded', superseded_at = CURRENT_TIMESTAMP
  WHERE document_id = p_document_id AND status = 'active';
  INSERT INTO public.document_retention_policy_assignments (
    workspace_id, document_id, policy_id, policy_version, retention_until,
    applied_by, reason, snapshot
  ) VALUES (
    p_workspace_id, p_document_id, v_policy.id, v_policy.version, v_until,
    p_actor_user_id, NULLIF(trim(COALESCE(p_reason, '')), ''),
    jsonb_build_object('name', v_policy.name, 'duration_value', v_policy.duration_value,
      'duration_unit', v_policy.duration_unit, 'completion_action', v_policy.completion_action)
  ) RETURNING * INTO v_assignment;
  UPDATE public.documentos SET retention_status = 'ACTIVE', retention_until = v_until
  WHERE id = p_document_id;
  INSERT INTO public.document_operational_events (
    workspace_id, document_id, actor_user_id, event_type, event_key, correlation_id, source, payload
  ) VALUES (
    p_workspace_id, p_document_id, p_actor_user_id, 'document.retention_applied',
    'retention:' || v_assignment.id::TEXT, gen_random_uuid(), 'database',
    jsonb_build_object('assignment_id', v_assignment.id, 'policy_id', v_policy.id,
      'policy_version', v_policy.version, 'retention_until', v_until)
  ) ON CONFLICT (document_id, event_key) DO NOTHING;
  RETURN to_jsonb(v_assignment);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_organization_delegation_policy(
  p_workspace_id UUID,
  p_actor_user_id UUID,
  p_mode TEXT,
  p_allowed_member_ids UUID[] DEFAULT '{}'::UUID[],
  p_allowed_roles TEXT[] DEFAULT '{}'::TEXT[]
)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_workspace public.workspaces%ROWTYPE;
  v_policy JSONB;
BEGIN
  IF p_mode <> ALL(ARRAY['DISABLED','ORGANIZATION_ONLY','AUTHORIZED_MEMBERS']) THEN
    RAISE EXCEPTION 'DELEGATION_POLICY_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_mode = 'AUTHORIZED_MEMBERS'
     AND cardinality(COALESCE(p_allowed_member_ids, '{}'::UUID[])) = 0
     AND cardinality(COALESCE(p_allowed_roles, '{}'::TEXT[])) = 0 THEN
    RAISE EXCEPTION 'DELEGATION_POLICY_EMPTY' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_workspace FROM public.workspaces
  WHERE id = p_workspace_id AND workspace_type = 'business' AND organization_enabled = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORGANIZATION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_allowed_member_ids, '{}'::UUID[])) AS requested(member_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.workspace_members member
      WHERE member.id = requested.member_id AND member.workspace_id = p_workspace_id
        AND member.status = 'active'
        AND (member.access_expires_at IS NULL OR member.access_expires_at > CURRENT_TIMESTAMP)
    )
  ) THEN
    RAISE EXCEPTION 'DELEGATION_POLICY_MEMBER_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;
  v_policy := jsonb_build_object(
    'mode', p_mode,
    'allowed_member_ids', to_jsonb(COALESCE(p_allowed_member_ids, '{}'::UUID[])),
    'allowed_roles', to_jsonb(COALESCE(p_allowed_roles, '{}'::TEXT[])),
    'updated_at', CURRENT_TIMESTAMP,
    'updated_by', p_actor_user_id
  );
  UPDATE public.workspaces
  SET organization_settings = jsonb_set(
    COALESCE(organization_settings, '{}'::JSONB),
    '{signature_delegation_policy}',
    v_policy,
    true
  )
  WHERE id = p_workspace_id;
  INSERT INTO public.organization_audit_events (
    workspace_id, actor_user_id, event_type, resource_type, resource_id,
    summary, payload, outcome, severity, module, origin
  ) VALUES (
    p_workspace_id, p_actor_user_id, 'delegation.policy.updated', 'workspace', p_workspace_id::TEXT,
    'Política de delegación actualizada', v_policy - 'updated_by', 'success', 'high',
    'delegation', 'api'
  );
  RETURN v_policy;
END;
$$;

REVOKE ALL ON FUNCTION public.snapshot_document_signing_groups(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transfer_document_custody(UUID, UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_document_retention_policy(UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_organization_delegation_policy(UUID, UUID, TEXT, UUID[], TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_document_signing_groups(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.transfer_document_custody(UUID, UUID, UUID, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_document_retention_policy(UUID, UUID, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_organization_delegation_policy(UUID, UUID, TEXT, UUID[], TEXT[]) TO service_role;

COMMENT ON TABLE public.document_signing_groups IS
  'Immutable execution snapshot of the existing grupos_firma JSONB configuration.';
COMMENT ON TABLE public.document_participant_delegations IS
  'Organization-only internal delegation. The original participant identity is never replaced.';
COMMENT ON TABLE public.document_custody_history IS
  'Append-oriented administrative custody history; it does not alter signatures or evidence.';
COMMENT ON TABLE public.organization_retention_policies IS
  'Configurable business retention; no statutory duration is inferred by Docubox.';

-- Keep AUTH-003 intact as the inner transaction boundary. The public names are
-- replaced by compatible wrappers that add Phase D governance in the same DB transaction.
DO $$
BEGIN
  IF to_regprocedure('public.claim_participant_completion_auth003(uuid,uuid,uuid,text,text,text,text,uuid,uuid)') IS NULL THEN
    ALTER FUNCTION public.claim_participant_completion(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID)
      RENAME TO claim_participant_completion_auth003;
  END IF;
  IF to_regprocedure('public.commit_participant_completion_auth003(uuid,uuid,text,text,uuid,jsonb)') IS NULL THEN
    ALTER FUNCTION public.commit_participant_completion(UUID, UUID, TEXT, TEXT, UUID, JSONB)
      RENAME TO commit_participant_completion_auth003;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.claim_participant_completion(
  p_document_id UUID,
  p_participant_reference_id UUID,
  p_actor_user_id UUID,
  p_actor_email TEXT,
  p_action_type TEXT,
  p_signature_method TEXT,
  p_idempotency_key TEXT,
  p_in_person_session_id UUID DEFAULT NULL,
  p_correlation_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_result JSONB;
  v_attempt_id UUID;
  v_reference public.document_participant_references%ROWTYPE;
  v_delegation public.document_participant_delegations%ROWTYPE;
  v_original_user_id UUID;
  v_original_email TEXT;
  v_group public.document_signing_groups%ROWTYPE;
  v_existing_attempt public.participant_completion_attempts%ROWTYPE;
  v_inner_action TEXT;
BEGIN
  v_inner_action := CASE WHEN lower(trim(COALESCE(p_action_type, ''))) = 'witness' THEN 'approval' ELSE lower(trim(COALESCE(p_action_type, ''))) END;
  IF lower(trim(COALESCE(p_action_type, ''))) <> ALL(ARRAY['signature','approval','witness']) THEN
    RAISE EXCEPTION 'COMPLETION_CLAIM_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_reference FROM public.document_participant_references
  WHERE id = p_participant_reference_id AND document_id = p_document_id AND active = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COMPLETION_PARTICIPANT_SCOPE_DENIED' USING ERRCODE = '42501'; END IF;

  IF v_reference.participant_user_id = p_actor_user_id
     OR v_reference.participant_email_normalized = lower(trim(COALESCE(p_actor_email, ''))) THEN
    v_original_user_id := p_actor_user_id;
    v_original_email := p_actor_email;
  ELSE
    SELECT * INTO v_delegation FROM public.document_participant_delegations
    WHERE document_id = p_document_id
      AND original_participant_reference_id = p_participant_reference_id
      AND delegate_user_id = p_actor_user_id
      AND status = 'active'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'COMPLETION_PARTICIPANT_SCOPE_DENIED' USING ERRCODE = '42501';
    END IF;
    v_original_user_id := v_reference.participant_user_id;
    IF v_original_user_id IS NULL THEN
      SELECT profile.id INTO v_original_user_id FROM public.user_profiles profile
      WHERE lower(trim(profile.email)) = v_reference.participant_email_normalized LIMIT 1;
    END IF;
    IF v_original_user_id IS NULL THEN
      RAISE EXCEPTION 'DELEGATION_ORIGINAL_ACCOUNT_REQUIRED' USING ERRCODE = '55000';
    END IF;
    v_original_email := v_reference.participant_email_normalized;
  END IF;

  v_result := public.claim_participant_completion_auth003(
    p_document_id, p_participant_reference_id, v_original_user_id, v_original_email,
    v_inner_action, CASE WHEN v_inner_action = 'signature' THEN p_signature_method ELSE '' END,
    p_idempotency_key, p_in_person_session_id, p_correlation_id
  );
  v_attempt_id := (v_result ->> 'attemptId')::UUID;
  UPDATE public.participant_completion_attempts
  SET effective_actor_user_id = p_actor_user_id,
      delegation_id = v_delegation.id,
      requested_action_type = lower(trim(p_action_type))
  WHERE id = v_attempt_id;

  SELECT signing_group.* INTO v_group
  FROM public.document_signing_groups signing_group
  JOIN public.document_signing_group_members member ON member.group_id = signing_group.id
  WHERE member.participant_reference_id = p_participant_reference_id
    AND signing_group.document_id = p_document_id
    AND signing_group.completion_policy = 'ANY_ONE'
  FOR UPDATE OF signing_group;
  IF FOUND THEN
    IF v_group.winner_completion_attempt_id IS NOT NULL
       AND v_group.winner_completion_attempt_id <> v_attempt_id THEN
      SELECT * INTO v_existing_attempt FROM public.participant_completion_attempts
      WHERE id = v_group.winner_completion_attempt_id FOR UPDATE;
      IF v_existing_attempt.status = 'claimed' AND v_existing_attempt.claim_expires_at <= CURRENT_TIMESTAMP THEN
        UPDATE public.participant_completion_attempts SET status = 'expired', updated_at = CURRENT_TIMESTAMP
        WHERE id = v_existing_attempt.id;
        UPDATE public.document_signing_groups
        SET winner_participant_reference_id = NULL, winner_completion_attempt_id = NULL,
            status = 'pending', updated_at = CURRENT_TIMESTAMP
        WHERE id = v_group.id;
      ELSIF v_existing_attempt.status IN ('claimed','committed') THEN
        RAISE EXCEPTION 'SIGNING_GROUP_WINNER_ALREADY_CLAIMED' USING ERRCODE = '55000';
      END IF;
    END IF;
    UPDATE public.document_signing_groups
    SET winner_participant_reference_id = p_participant_reference_id,
        winner_completion_attempt_id = v_attempt_id,
        status = 'active', updated_at = CURRENT_TIMESTAMP
    WHERE id = v_group.id
      AND (winner_completion_attempt_id IS NULL OR winner_completion_attempt_id = v_attempt_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'SIGNING_GROUP_WINNER_ALREADY_CLAIMED' USING ERRCODE = '55000'; END IF;
  END IF;

  RETURN v_result || jsonb_build_object(
    'effectiveActorUserId', p_actor_user_id,
    'delegationId', v_delegation.id,
    'requestedActionType', lower(trim(p_action_type)),
    'groupId', v_group.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_participant_completion(
  p_attempt_id UUID,
  p_actor_user_id UUID,
  p_actor_email TEXT,
  p_idempotency_key TEXT,
  p_signature_evidence_id UUID,
  p_response JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_attempt public.participant_completion_attempts%ROWTYPE;
  v_reference public.document_participant_references%ROWTYPE;
  v_delegation public.document_participant_delegations%ROWTYPE;
  v_original_user_id UUID;
  v_original_email TEXT;
  v_evidence_actor UUID;
  v_result JSONB;
  v_group public.document_signing_groups%ROWTYPE;
  v_participants JSONB;
  v_all_completed BOOLEAN := false;
  v_document_state TEXT;
BEGIN
  SELECT * INTO v_attempt FROM public.participant_completion_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_attempt.effective_actor_user_id, v_attempt.actor_user_id) <> p_actor_user_id THEN
    RAISE EXCEPTION 'COMPLETION_ATTEMPT_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_reference FROM public.document_participant_references
  WHERE id = v_attempt.participant_reference_id AND document_id = v_attempt.document_id FOR UPDATE;
  v_original_user_id := v_attempt.actor_user_id;
  v_original_email := v_reference.participant_email_normalized;

  IF v_attempt.delegation_id IS NOT NULL THEN
    SELECT * INTO v_delegation FROM public.document_participant_delegations
    WHERE id = v_attempt.delegation_id
      AND original_participant_reference_id = v_attempt.participant_reference_id
      AND delegate_user_id = p_actor_user_id
      AND status = 'active'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'DELEGATION_NOT_ACTIVE' USING ERRCODE = '42501'; END IF;
    IF p_signature_evidence_id IS NOT NULL THEN
      SELECT captured_by INTO v_evidence_actor FROM public.signature_evidence
      WHERE id = p_signature_evidence_id AND document_id = v_attempt.document_id FOR UPDATE;
      IF v_evidence_actor IS DISTINCT FROM p_actor_user_id THEN
        RAISE EXCEPTION 'COMPLETION_EVIDENCE_SCOPE_INVALID' USING ERRCODE = '23514';
      END IF;
      -- AUTH-003 validates the original participant identity. The attribution is
      -- restored to the effective signer before this transaction can commit.
      UPDATE public.signature_evidence SET captured_by = v_original_user_id
      WHERE id = p_signature_evidence_id;
    END IF;
  ELSE
    v_original_email := p_actor_email;
  END IF;

  v_result := public.commit_participant_completion_auth003(
    p_attempt_id, v_original_user_id, v_original_email, p_idempotency_key,
    p_signature_evidence_id, p_response
  );

  IF v_attempt.delegation_id IS NOT NULL AND p_signature_evidence_id IS NOT NULL THEN
    UPDATE public.signature_evidence SET captured_by = p_actor_user_id
    WHERE id = p_signature_evidence_id;
  END IF;
  UPDATE public.participant_completion_attempts
  SET effective_actor_user_id = p_actor_user_id WHERE id = p_attempt_id;
  UPDATE public.participation_responses
  SET effective_actor_user_id = p_actor_user_id,
      delegation_id = v_attempt.delegation_id,
      witness_completed = v_attempt.requested_action_type = 'witness',
      witness_completed_at = CASE WHEN v_attempt.requested_action_type = 'witness' THEN CURRENT_TIMESTAMP ELSE witness_completed_at END,
      tipo_participacion = CASE WHEN v_attempt.requested_action_type = 'witness' THEN 'testigo' ELSE tipo_participacion END
  WHERE completion_attempt_id = p_attempt_id;

  IF v_attempt.delegation_id IS NOT NULL THEN
    UPDATE public.document_participant_delegations
    SET status = 'completed', completed_at = CURRENT_TIMESTAMP, completion_attempt_id = p_attempt_id
    WHERE id = v_attempt.delegation_id;
  END IF;

  SELECT signing_group.* INTO v_group
  FROM public.document_signing_groups signing_group
  JOIN public.document_signing_group_members member ON member.group_id = signing_group.id
  WHERE member.participant_reference_id = v_attempt.participant_reference_id
    AND signing_group.document_id = v_attempt.document_id
  FOR UPDATE OF signing_group;
  IF FOUND THEN
    UPDATE public.document_signing_group_members
    SET status = 'completed', completion_attempt_id = p_attempt_id, completed_at = CURRENT_TIMESTAMP
    WHERE group_id = v_group.id AND participant_reference_id = v_attempt.participant_reference_id;
    IF v_group.completion_policy = 'ANY_ONE' THEN
      UPDATE public.document_signing_group_members
      SET status = 'superseded'
      WHERE group_id = v_group.id AND participant_reference_id <> v_attempt.participant_reference_id
        AND status = 'eligible';
      SELECT jsonb_agg(
        CASE
          WHEN participant ->> 'participant_ref_id' = v_attempt.participant_reference_id::TEXT
               AND v_attempt.requested_action_type = 'witness'
            THEN jsonb_set(jsonb_set(participant, '{sub_estado}', '"atestiguo"'::JSONB, true), '{estado}', '"firmado"'::JSONB, true)
          WHEN participant ->> 'participant_ref_id' IN (
            SELECT participant_reference_id::TEXT FROM public.document_signing_group_members
            WHERE group_id = v_group.id AND status = 'superseded'
          )
            THEN jsonb_set(jsonb_set(jsonb_set(participant, '{sub_estado}', '"superseded"'::JSONB, true), '{estado}', '"sin_accion"'::JSONB, true), '{current_access}', 'false'::JSONB, true)
          ELSE participant
        END ORDER BY ordinal
      ) INTO v_participants
      FROM public.documentos document,
        jsonb_array_elements(document.participantes) WITH ORDINALITY AS item(participant, ordinal)
      WHERE document.id = v_attempt.document_id;
      UPDATE public.document_signing_groups
      SET status = 'satisfied', satisfied_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = v_group.id;
      UPDATE public.documentos SET participantes = v_participants WHERE id = v_attempt.document_id;
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.document_signing_group_members WHERE group_id = v_group.id AND status = 'eligible'
    ) THEN
      UPDATE public.document_signing_groups
      SET status = 'satisfied', satisfied_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = v_group.id;
    ELSIF v_attempt.requested_action_type = 'witness' THEN
      SELECT jsonb_agg(
        CASE WHEN participant ->> 'participant_ref_id' = v_attempt.participant_reference_id::TEXT
          THEN jsonb_set(jsonb_set(participant, '{sub_estado}', '"atestiguo"'::JSONB, true), '{estado}', '"firmado"'::JSONB, true)
          ELSE participant END ORDER BY ordinal
      ) INTO v_participants
      FROM public.documentos document,
        jsonb_array_elements(document.participantes) WITH ORDINALITY AS item(participant, ordinal)
      WHERE document.id = v_attempt.document_id;
      UPDATE public.documentos SET participantes = v_participants WHERE id = v_attempt.document_id;
    END IF;
  ELSIF v_attempt.requested_action_type = 'witness' THEN
    SELECT jsonb_agg(
      CASE WHEN participant ->> 'participant_ref_id' = v_attempt.participant_reference_id::TEXT
        THEN jsonb_set(jsonb_set(participant, '{sub_estado}', '"atestiguo"'::JSONB, true), '{estado}', '"firmado"'::JSONB, true)
        ELSE participant END ORDER BY ordinal
    ) INTO v_participants
    FROM public.documentos document,
      jsonb_array_elements(document.participantes) WITH ORDINALITY AS item(participant, ordinal)
    WHERE document.id = v_attempt.document_id;
    UPDATE public.documentos SET participantes = v_participants WHERE id = v_attempt.document_id;
  END IF;

  SELECT COALESCE(bool_and(
    lower(COALESCE(participant ->> 'sub_estado', participant ->> 'estado', '')) = ANY(
      ARRAY['firmo','firmado','aprobo','aprobado','atestiguo','testigo_completado','superseded','rechazo','rechazado','cancelo','cancelado']
    )
  ), false) INTO v_all_completed
  FROM public.documentos document,
    jsonb_array_elements(document.participantes) AS item(participant)
  WHERE document.id = v_attempt.document_id;
  IF v_all_completed THEN
    UPDATE public.documentos SET estado = 'completado', fecha_completado = COALESCE(fecha_completado, CURRENT_TIMESTAMP)
    WHERE id = v_attempt.document_id;
    v_document_state := 'completado';
  ELSE
    SELECT estado INTO v_document_state FROM public.documentos WHERE id = v_attempt.document_id;
  END IF;

  UPDATE public.document_operational_events
  SET actor_user_id = p_actor_user_id,
      payload = payload || jsonb_strip_nulls(jsonb_build_object(
        'effective_actor_user_id', p_actor_user_id,
        'delegation_id', v_attempt.delegation_id,
        'requested_action_type', v_attempt.requested_action_type,
        'signing_group_id', v_group.id,
        'completion_policy', v_group.completion_policy
      ))
  WHERE document_id = v_attempt.document_id
    AND event_key = 'completion:' || p_attempt_id::TEXT || ':committed';

  IF v_attempt.requested_action_type = 'witness' OR v_attempt.delegation_id IS NOT NULL OR v_group.id IS NOT NULL THEN
    INSERT INTO public.document_operational_events (
      workspace_id, document_id, participant_reference_id, actor_user_id,
      event_type, event_key, correlation_id, source, payload
    ) VALUES (
      v_attempt.workspace_id, v_attempt.document_id, v_attempt.participant_reference_id, p_actor_user_id,
      CASE WHEN v_attempt.requested_action_type = 'witness' THEN 'witness.completed'
           WHEN v_attempt.delegation_id IS NOT NULL THEN 'participant.delegation.completed'
           ELSE 'signing_group.completed' END,
      'phase-d:' || p_attempt_id::TEXT,
      v_attempt.correlation_id, 'database',
      jsonb_strip_nulls(jsonb_build_object('attempt_id', p_attempt_id, 'delegation_id', v_attempt.delegation_id,
        'signing_group_id', v_group.id, 'completion_policy', v_group.completion_policy))
    ) ON CONFLICT (document_id, event_key) DO NOTHING;
  END IF;

  RETURN v_result || jsonb_build_object(
    'effectiveActorUserId', p_actor_user_id,
    'delegationId', v_attempt.delegation_id,
    'requestedActionType', v_attempt.requested_action_type,
    'groupId', v_group.id,
    'documentState', v_document_state,
    'routingRequired', NOT v_all_completed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_participant_completion_auth003(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_participant_completion_auth003(UUID, UUID, TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_participant_completion(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_participant_completion(UUID, UUID, TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_participant_completion(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_participant_completion(UUID, UUID, TEXT, TEXT, UUID, JSONB) TO service_role;
