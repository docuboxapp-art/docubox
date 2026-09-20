-- Post-Phase E: additive delegation support for an existing signing-group slot.
-- The original group snapshot, Phase D winner claim and AUTH-003 completion
-- boundary remain canonical.

ALTER TABLE public.document_participant_delegations
  ADD COLUMN IF NOT EXISTS signing_group_id UUID
    REFERENCES public.document_signing_groups(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS group_member_slot_id UUID
    REFERENCES public.document_signing_group_members(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS delegate_participant_reference_id UUID
    REFERENCES public.document_participant_references(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS revocation_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by_completion_attempt_id UUID
    REFERENCES public.participant_completion_attempts(id) ON DELETE RESTRICT;

ALTER TABLE public.document_participant_delegations
  DROP CONSTRAINT IF EXISTS document_participant_delegations_status_check;

ALTER TABLE public.document_participant_delegations
  ADD CONSTRAINT document_participant_delegations_status_check
    CHECK (status IN ('active','revoked','completed','superseded')),
  ADD CONSTRAINT document_participant_delegations_group_scope_check
    CHECK (
      (signing_group_id IS NULL AND group_member_slot_id IS NULL
        AND delegate_participant_reference_id IS NULL)
      OR
      (signing_group_id IS NOT NULL AND group_member_slot_id IS NOT NULL
        AND delegate_participant_reference_id IS NOT NULL)
    ),
  ADD CONSTRAINT document_participant_delegations_idempotency_key_check
    CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 16 AND 240),
  ADD CONSTRAINT document_participant_delegations_revocation_key_check
    CHECK (
      revocation_idempotency_key IS NULL
      OR length(revocation_idempotency_key) BETWEEN 16 AND 240
    );

CREATE UNIQUE INDEX IF NOT EXISTS document_group_member_delegations_one_active_slot_idx
  ON public.document_participant_delegations(group_member_slot_id)
  WHERE status = 'active' AND group_member_slot_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS document_group_member_delegations_create_idempotency_idx
  ON public.document_participant_delegations(workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS document_group_member_delegations_revoke_idempotency_idx
  ON public.document_participant_delegations(workspace_id, revocation_idempotency_key)
  WHERE revocation_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS document_group_member_delegations_delegate_scope_idx
  ON public.document_participant_delegations(
    signing_group_id, delegate_participant_reference_id, status
  )
  WHERE signing_group_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS organization_audit_group_member_delegation_once_idx
  ON public.organization_audit_events(
    workspace_id, event_type, resource_type, resource_id
  )
  WHERE event_type IN (
    'group_member.delegation_created',
    'group_member.delegation_revoked'
  );

COMMENT ON COLUMN public.document_participant_delegations.group_member_slot_id IS
  'Stable logical signing-group slot. Delegation never adds or rewrites a group member.';
COMMENT ON COLUMN public.document_participant_delegations.delegate_participant_reference_id IS
  'Existing same-group participant reference used by the effective actor.';

CREATE OR REPLACE FUNCTION public.create_group_member_delegation(
  p_document_id UUID,
  p_workspace_id UUID,
  p_original_participant_reference_id UUID,
  p_delegate_member_id UUID,
  p_actor_user_id UUID,
  p_reason TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_document public.documentos%ROWTYPE;
  v_workspace public.workspaces%ROWTYPE;
  v_original public.document_participant_references%ROWTYPE;
  v_slot public.document_signing_group_members%ROWTYPE;
  v_group public.document_signing_groups%ROWTYPE;
  v_delegate_member public.workspace_members%ROWTYPE;
  v_delegate_reference public.document_participant_references%ROWTYPE;
  v_existing public.document_participant_delegations%ROWTYPE;
  v_result public.document_participant_delegations%ROWTYPE;
  v_original_user_id UUID;
  v_actor_is_self BOOLEAN := false;
  v_actor_can_manage BOOLEAN := false;
  v_policy JSONB := '{}'::JSONB;
  v_policy_mode TEXT;
BEGIN
  IF length(trim(COALESCE(p_reason, ''))) NOT BETWEEN 3 AND 500
     OR length(trim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 16 AND 240 THEN
    RAISE EXCEPTION 'GROUP_MEMBER_DELEGATION_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_document
  FROM public.documentos
  WHERE id = p_document_id AND workspace_id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GROUP_MEMBER_DELEGATION_DOCUMENT_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;
  IF lower(COALESCE(v_document.estado, '')) = ANY(
    ARRAY['completado','cancelado','rechazado','vencido','expirado']
  ) THEN
    RAISE EXCEPTION 'GROUP_MEMBER_DELEGATION_DOCUMENT_TERMINAL' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_workspace FROM public.workspaces WHERE id = p_workspace_id;
  v_policy := COALESCE(v_workspace.organization_settings -> 'signature_delegation_policy', '{}'::JSONB);
  v_policy_mode := upper(COALESCE(v_policy ->> 'mode', 'DISABLED'));
  IF v_policy_mode NOT IN ('ORGANIZATION_ONLY','AUTHORIZED_MEMBERS') THEN
    RAISE EXCEPTION 'GROUP_MEMBER_DELEGATION_POLICY_DISABLED' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_original
  FROM public.document_participant_references
  WHERE id = p_original_participant_reference_id
    AND document_id = p_document_id
    AND workspace_id = p_workspace_id
    AND active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GROUP_MEMBER_DELEGATION_PARTICIPANT_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;

  SELECT member.* INTO v_slot
  FROM public.document_signing_group_members member
  WHERE member.document_id = p_document_id
    AND member.workspace_id = p_workspace_id
    AND member.participant_reference_id = p_original_participant_reference_id
  FOR UPDATE;
  IF NOT FOUND OR v_slot.status <> 'eligible' THEN
    RAISE EXCEPTION 'GROUP_MEMBER_DELEGATION_SLOT_NOT_ELIGIBLE' USING ERRCODE = '55000';
  END IF;

  SELECT signing_group.* INTO v_group
  FROM public.document_signing_groups signing_group
  WHERE signing_group.id = v_slot.group_id
    AND signing_group.document_id = p_document_id
    AND signing_group.workspace_id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND OR v_group.status NOT IN ('pending','active') THEN
    RAISE EXCEPTION 'GROUP_MEMBER_DELEGATION_SLOT_NOT_ELIGIBLE' USING ERRCODE = '55000';
  END IF;

  v_original_user_id := v_original.participant_user_id;
  IF v_original_user_id IS NULL THEN
    SELECT profile.id INTO v_original_user_id
    FROM public.user_profiles profile
    WHERE lower(trim(profile.email)) = v_original.participant_email_normalized
    LIMIT 1;
  END IF;
  v_actor_is_self := v_original_user_id = p_actor_user_id;
  v_actor_can_manage := EXISTS (
    SELECT 1
    FROM public.workspace_members actor_member
    WHERE actor_member.workspace_id = p_workspace_id
      AND actor_member.user_id = p_actor_user_id
      AND actor_member.status = 'active'
      AND (actor_member.access_expires_at IS NULL OR actor_member.access_expires_at > CURRENT_TIMESTAMP)
      AND (
        actor_member.role IN ('owner','admin')
        OR EXISTS (
          SELECT 1
          FROM public.organization_member_roles member_role
          JOIN public.organization_role_permissions role_permission
            ON role_permission.role_id = member_role.role_id
          JOIN public.organization_permissions permission
            ON permission.id = role_permission.permission_id
          WHERE member_role.member_id = actor_member.id
            AND member_role.workspace_id = p_workspace_id
            AND permission.permission_key = 'delegation.manage'
        )
      )
  );
  IF NOT v_actor_is_self AND NOT v_actor_can_manage THEN
    RAISE EXCEPTION 'GROUP_MEMBER_DELEGATION_ACTOR_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;
  IF v_actor_is_self AND NOT EXISTS (
    SELECT 1 FROM public.workspace_members actor_member
    WHERE actor_member.workspace_id = p_workspace_id
      AND actor_member.user_id = p_actor_user_id
      AND actor_member.status = 'active'
      AND (actor_member.access_expires_at IS NULL OR actor_member.access_expires_at > CURRENT_TIMESTAMP)
  ) THEN
    RAISE EXCEPTION 'GROUP_MEMBER_DELEGATION_ACTOR_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing
  FROM public.document_participant_delegations
  WHERE workspace_id = p_workspace_id AND idempotency_key = trim(p_idempotency_key);
  IF FOUND THEN
    IF v_existing.document_id = p_document_id
       AND v_existing.group_member_slot_id = v_slot.id
       AND v_existing.delegate_member_id = p_delegate_member_id THEN
      RETURN to_jsonb(v_existing) || jsonb_build_object('idempotent', true);
    END IF;
    RAISE EXCEPTION 'GROUP_MEMBER_DELEGATION_IDEMPOTENCY_CONFLICT' USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_delegate_member
  FROM public.workspace_members
  WHERE id = p_delegate_member_id
    AND workspace_id = p_workspace_id
    AND status = 'active'
    AND (access_expires_at IS NULL OR access_expires_at > CURRENT_TIMESTAMP)
  FOR UPDATE;
  IF NOT FOUND OR v_delegate_member.user_id IS NULL THEN
    RAISE EXCEPTION 'GROUP_MEMBER_DELEGATION_DELEGATE_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;

  IF v_policy_mode = 'AUTHORIZED_MEMBERS'
     AND NOT (
       COALESCE(v_policy -> 'allowed_member_ids', '[]'::JSONB) ? v_delegate_member.id::TEXT
       OR COALESCE(v_policy -> 'allowed_roles', '[]'::JSONB) ? COALESCE(v_delegate_member.role::TEXT, '')
     ) THEN
    RAISE EXCEPTION 'GROUP_MEMBER_DELEGATION_DELEGATE_POLICY_DENIED' USING ERRCODE = '42501';
  END IF;

  SELECT reference.* INTO v_delegate_reference
  FROM public.document_signing_group_members delegate_slot
  JOIN public.document_participant_references reference
    ON reference.id = delegate_slot.participant_reference_id
  LEFT JOIN public.user_profiles profile
    ON lower(trim(profile.email)) = reference.participant_email_normalized
  WHERE delegate_slot.group_id = v_group.id
    AND delegate_slot.status = 'eligible'
    AND reference.active = true
    AND (
      reference.participant_user_id = v_delegate_member.user_id
      OR profile.id = v_delegate_member.user_id
    )
  ORDER BY delegate_slot.ordinal
  LIMIT 1
  FOR UPDATE OF delegate_slot, reference;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GROUP_MEMBER_DELEGATION_SAME_GROUP_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF v_delegate_reference.id = v_original.id
     OR v_delegate_member.user_id = v_original_user_id THEN
    RAISE EXCEPTION 'GROUP_MEMBER_DELEGATION_SELF_DENIED' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.document_participant_delegations
  WHERE group_member_slot_id = v_slot.id AND status = 'active'
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.delegate_member_id = p_delegate_member_id THEN
      RETURN to_jsonb(v_existing) || jsonb_build_object('idempotent', true);
    END IF;
    RAISE EXCEPTION 'GROUP_MEMBER_DELEGATION_ALREADY_ACTIVE' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.document_participant_delegations chain
    WHERE chain.signing_group_id = v_group.id
      AND chain.status = 'active'
      AND (
        chain.delegate_participant_reference_id = v_original.id
        OR chain.original_participant_reference_id = v_delegate_reference.id
      )
  ) THEN
    RAISE EXCEPTION 'GROUP_MEMBER_DELEGATION_CHAIN_DENIED' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.document_participant_delegations (
    workspace_id, document_id, original_participant_reference_id,
    delegate_member_id, delegate_user_id, created_by, reason,
    policy_mode, policy_snapshot, signing_group_id, group_member_slot_id,
    delegate_participant_reference_id, idempotency_key
  ) VALUES (
    p_workspace_id, p_document_id, v_original.id,
    v_delegate_member.id, v_delegate_member.user_id, p_actor_user_id, trim(p_reason),
    v_policy_mode, v_policy, v_group.id, v_slot.id,
    v_delegate_reference.id, trim(p_idempotency_key)
  ) RETURNING * INTO v_result;

  RETURN to_jsonb(v_result) || jsonb_build_object(
    'idempotent', false,
    'completion_policy', v_group.completion_policy,
    'original_group_member_slot_id', v_slot.id,
    'delegate_participant_reference_id', v_delegate_reference.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_group_member_delegation(
  p_document_id UUID,
  p_workspace_id UUID,
  p_delegation_id UUID,
  p_actor_user_id UUID,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_delegation public.document_participant_delegations%ROWTYPE;
  v_original public.document_participant_references%ROWTYPE;
  v_original_user_id UUID;
  v_actor_is_self BOOLEAN := false;
  v_actor_can_manage BOOLEAN := false;
BEGIN
  IF length(trim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 16 AND 240 THEN
    RAISE EXCEPTION 'GROUP_MEMBER_DELEGATION_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_delegation
  FROM public.document_participant_delegations
  WHERE id = p_delegation_id
    AND document_id = p_document_id
    AND workspace_id = p_workspace_id
    AND group_member_slot_id IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GROUP_MEMBER_DELEGATION_NOT_FOUND' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_original
  FROM public.document_participant_references
  WHERE id = v_delegation.original_participant_reference_id
    AND document_id = p_document_id;
  v_original_user_id := v_original.participant_user_id;
  IF v_original_user_id IS NULL THEN
    SELECT profile.id INTO v_original_user_id
    FROM public.user_profiles profile
    WHERE lower(trim(profile.email)) = v_original.participant_email_normalized
    LIMIT 1;
  END IF;
  v_actor_is_self := v_original_user_id = p_actor_user_id;
  v_actor_can_manage := EXISTS (
    SELECT 1
    FROM public.workspace_members actor_member
    WHERE actor_member.workspace_id = p_workspace_id
      AND actor_member.user_id = p_actor_user_id
      AND actor_member.status = 'active'
      AND (actor_member.access_expires_at IS NULL OR actor_member.access_expires_at > CURRENT_TIMESTAMP)
      AND (
        actor_member.role IN ('owner','admin')
        OR EXISTS (
          SELECT 1
          FROM public.organization_member_roles member_role
          JOIN public.organization_role_permissions role_permission
            ON role_permission.role_id = member_role.role_id
          JOIN public.organization_permissions permission
            ON permission.id = role_permission.permission_id
          WHERE member_role.member_id = actor_member.id
            AND member_role.workspace_id = p_workspace_id
            AND permission.permission_key = 'delegation.manage'
        )
      )
  );
  IF NOT v_actor_is_self AND NOT v_actor_can_manage THEN
    RAISE EXCEPTION 'GROUP_MEMBER_DELEGATION_ACTOR_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;

  IF v_delegation.status = 'revoked' THEN
    RETURN to_jsonb(v_delegation) || jsonb_build_object('idempotent', true);
  END IF;
  IF v_delegation.status <> 'active' THEN
    RAISE EXCEPTION 'GROUP_MEMBER_DELEGATION_NOT_ACTIVE' USING ERRCODE = '55000';
  END IF;

  UPDATE public.document_participant_delegations
  SET status = 'revoked',
      revoked_at = CURRENT_TIMESTAMP,
      revoked_by = p_actor_user_id,
      revocation_idempotency_key = trim(p_idempotency_key)
  WHERE id = v_delegation.id AND status = 'active'
  RETURNING * INTO v_delegation;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GROUP_MEMBER_DELEGATION_NOT_ACTIVE' USING ERRCODE = '55000';
  END IF;
  RETURN to_jsonb(v_delegation) || jsonb_build_object('idempotent', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.emit_group_member_delegation_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_event_type TEXT;
  v_actor_user_id UUID;
  v_attempt public.participant_completion_attempts%ROWTYPE;
BEGIN
  IF NEW.group_member_slot_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    v_event_type := 'group_member.delegation_created';
    v_actor_user_id := NEW.created_by;
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'revoked' THEN
      v_event_type := 'group_member.delegation_revoked';
      v_actor_user_id := NEW.revoked_by;
    ELSIF NEW.status = 'completed' THEN
      v_event_type := 'group_member.delegation_completed';
      SELECT * INTO v_attempt FROM public.participant_completion_attempts
      WHERE id = NEW.completion_attempt_id;
      v_actor_user_id := COALESCE(v_attempt.effective_actor_user_id, NEW.delegate_user_id);
    ELSIF NEW.status = 'superseded' THEN
      v_event_type := 'group_member.delegation_superseded';
      SELECT * INTO v_attempt FROM public.participant_completion_attempts
      WHERE id = NEW.superseded_by_completion_attempt_id;
      v_actor_user_id := COALESCE(v_attempt.effective_actor_user_id, NEW.created_by);
    END IF;
  END IF;
  IF v_event_type IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.document_operational_events (
    workspace_id, document_id, participant_reference_id, actor_user_id,
    event_type, event_key, correlation_id, source, payload
  ) VALUES (
    NEW.workspace_id, NEW.document_id, NEW.original_participant_reference_id, v_actor_user_id,
    v_event_type, 'group-member-delegation:' || NEW.id::TEXT || ':' || NEW.status,
    COALESCE(v_attempt.correlation_id, gen_random_uuid()), 'database',
    jsonb_strip_nulls(jsonb_build_object(
      'delegation_id', NEW.id,
      'signing_group_id', NEW.signing_group_id,
      'group_member_slot_id', NEW.group_member_slot_id,
      'original_participant_reference_id', NEW.original_participant_reference_id,
      'delegate_participant_reference_id', NEW.delegate_participant_reference_id,
      'delegate_user_id', NEW.delegate_user_id,
      'policy_mode', NEW.policy_mode,
      'status', NEW.status,
      'completion_attempt_id', NEW.completion_attempt_id,
      'superseded_by_completion_attempt_id', NEW.superseded_by_completion_attempt_id
    ))
  ) ON CONFLICT (document_id, event_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS emit_group_member_delegation_event
  ON public.document_participant_delegations;
CREATE TRIGGER emit_group_member_delegation_event
  AFTER INSERT OR UPDATE OF status ON public.document_participant_delegations
  FOR EACH ROW EXECUTE FUNCTION public.emit_group_member_delegation_event();

CREATE OR REPLACE FUNCTION public.close_superseded_group_member_delegation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_winner_attempt_id UUID;
BEGIN
  IF OLD.status = 'eligible' AND NEW.status = 'superseded' THEN
    SELECT winner_completion_attempt_id INTO v_winner_attempt_id
    FROM public.document_signing_groups WHERE id = NEW.group_id;
    UPDATE public.document_participant_delegations
    SET status = 'superseded',
        superseded_at = CURRENT_TIMESTAMP,
        superseded_by_completion_attempt_id = v_winner_attempt_id
    WHERE group_member_slot_id = NEW.id AND status = 'active';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS close_superseded_group_member_delegation
  ON public.document_signing_group_members;
CREATE TRIGGER close_superseded_group_member_delegation
  AFTER UPDATE OF status ON public.document_signing_group_members
  FOR EACH ROW EXECUTE FUNCTION public.close_superseded_group_member_delegation();

DO $$
BEGIN
  IF to_regprocedure(
    'public.claim_participant_completion_phase_d(uuid,uuid,uuid,text,text,text,text,uuid,uuid)'
  ) IS NULL THEN
    ALTER FUNCTION public.claim_participant_completion(
      UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID
    ) RENAME TO claim_participant_completion_phase_d;
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
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_delegation public.document_participant_delegations%ROWTYPE;
  v_slot public.document_signing_group_members%ROWTYPE;
  v_group public.document_signing_groups%ROWTYPE;
BEGIN
  SELECT * INTO v_delegation
  FROM public.document_participant_delegations
  WHERE document_id = p_document_id
    AND original_participant_reference_id = p_participant_reference_id
    AND group_member_slot_id IS NOT NULL
    AND status = 'active'
  FOR UPDATE;
  IF FOUND THEN
    IF v_delegation.delegate_user_id <> p_actor_user_id THEN
      RAISE EXCEPTION 'DELEGATION_ORIGINAL_SUSPENDED' USING ERRCODE = '42501';
    END IF;
    IF v_delegation.group_member_slot_id IS NOT NULL THEN
      SELECT * INTO v_slot FROM public.document_signing_group_members
      WHERE id = v_delegation.group_member_slot_id FOR UPDATE;
      SELECT * INTO v_group FROM public.document_signing_groups
      WHERE id = v_delegation.signing_group_id FOR UPDATE;
      IF v_slot.status <> 'eligible' OR v_group.status NOT IN ('pending','active') THEN
        RAISE EXCEPTION 'GROUP_MEMBER_DELEGATION_SLOT_NOT_ELIGIBLE' USING ERRCODE = '55000';
      END IF;
    END IF;
  END IF;

  RETURN public.claim_participant_completion_phase_d(
    p_document_id, p_participant_reference_id, p_actor_user_id, p_actor_email,
    p_action_type, p_signature_method, p_idempotency_key,
    p_in_person_session_id, p_correlation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_group_member_delegation(
  UUID, UUID, UUID, UUID, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_group_member_delegation(
  UUID, UUID, UUID, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_participant_completion_phase_d(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_participant_completion(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_group_member_delegation(
  UUID, UUID, UUID, UUID, UUID, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_group_member_delegation(
  UUID, UUID, UUID, UUID, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_participant_completion(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID
) TO service_role;

COMMENT ON FUNCTION public.create_group_member_delegation(
  UUID, UUID, UUID, UUID, UUID, TEXT, TEXT
) IS 'Atomically delegates one existing signing-group slot to an eligible same-group organization member.';
