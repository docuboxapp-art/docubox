-- Organization continuity and ownership hardening.
-- Extends the existing tenant, member, asset, MFA and audit models without
-- deleting historical memberships, authorship or signature evidence.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.organization_audit_events
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER,
  ADD COLUMN IF NOT EXISTS request_id TEXT;

CREATE TABLE IF NOT EXISTS public.organization_member_offboarding_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  member_id UUID NOT NULL REFERENCES public.workspace_members(id) ON DELETE RESTRICT,
  successor_member_id UUID REFERENCES public.workspace_members(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'scheduled', 'processing', 'completed', 'failed', 'cancelled')),
  effective_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT,
  transfer_plan JSONB NOT NULL DEFAULT '{}'::JSONB,
  asset_inventory JSONB NOT NULL DEFAULT '{}'::JSONB,
  completion_report JSONB,
  idempotency_key TEXT NOT NULL,
  failure_code TEXT,
  failure_detail TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (successor_member_id IS NULL OR successor_member_id <> member_id),
  UNIQUE (workspace_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_offboarding_open_member
  ON public.organization_member_offboarding_jobs(workspace_id, member_id)
  WHERE status IN ('pending', 'scheduled', 'processing');
CREATE INDEX IF NOT EXISTS idx_org_offboarding_workspace
  ON public.organization_member_offboarding_jobs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_offboarding_due
  ON public.organization_member_offboarding_jobs(status, effective_at)
  WHERE status IN ('pending', 'scheduled');

CREATE TABLE IF NOT EXISTS public.organization_ownership_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  current_owner_member_id UUID NOT NULL REFERENCES public.workspace_members(id) ON DELETE RESTRICT,
  target_member_id UUID NOT NULL REFERENCES public.workspace_members(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'cancelled', 'expired')),
  token_hash TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  email_sent_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (current_owner_member_id <> target_member_id),
  CHECK (char_length(token_hash) = 64),
  UNIQUE (workspace_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_ownership_pending_workspace
  ON public.organization_ownership_transfers(workspace_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_org_ownership_target
  ON public.organization_ownership_transfers(target_member_id, status, expires_at);

DROP TRIGGER IF EXISTS trg_org_offboarding_updated_at ON public.organization_member_offboarding_jobs;
CREATE TRIGGER trg_org_offboarding_updated_at
  BEFORE UPDATE ON public.organization_member_offboarding_jobs
  FOR EACH ROW EXECUTE FUNCTION public.organization_touch_updated_at();

DROP TRIGGER IF EXISTS trg_org_ownership_updated_at ON public.organization_ownership_transfers;
CREATE TRIGGER trg_org_ownership_updated_at
  BEFORE UPDATE ON public.organization_ownership_transfers
  FOR EACH ROW EXECUTE FUNCTION public.organization_touch_updated_at();

CREATE OR REPLACE FUNCTION public.get_organization_member_offboarding_preview(
  ws_id UUID,
  target_member_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_member public.workspace_members%ROWTYPE;
  target_profile public.user_profiles%ROWTYPE;
  result JSONB;
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'members.offboard') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO target_member
  FROM public.workspace_members
  WHERE id = target_member_id AND workspace_id = ws_id;

  IF target_member.id IS NULL THEN
    RAISE EXCEPTION 'organization_member_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO target_profile FROM public.user_profiles WHERE id = target_member.user_id;

  SELECT jsonb_build_object(
    'member', jsonb_build_object(
      'id', target_member.id,
      'user_id', target_member.user_id,
      'role', target_member.role,
      'status', target_member.status,
      'full_name', COALESCE(target_profile.full_name, target_profile.email, 'Usuario'),
      'email', target_profile.email
    ),
    'assets', jsonb_build_object(
      'documents', (SELECT count(*) FROM public.documentos d WHERE d.workspace_id = ws_id AND d.owner_id = target_member.user_id),
      'case_files', (SELECT count(*) FROM public.case_files cf WHERE cf.workspace_id = ws_id AND cf.owner_user_id = target_member.user_id),
      'tasks', (SELECT count(*) FROM public.tareas t WHERE t.workspace_id = ws_id AND t.assigned_to = target_member.user_id),
      'shared_resources_owned', (SELECT count(*) FROM public.organization_shared_resources r WHERE r.workspace_id = ws_id AND r.owner_user_id = target_member.user_id),
      'shared_resources_custodied', (SELECT count(*) FROM public.organization_shared_resources r WHERE r.workspace_id = ws_id AND r.custodian_user_id = target_member.user_id),
      'teams_led', (SELECT count(*) FROM public.organization_units u WHERE u.workspace_id = ws_id AND u.leader_member_id = target_member.id),
      'cost_centers', (SELECT count(*) FROM public.organization_cost_centers c WHERE c.workspace_id = ws_id AND c.owner_member_id = target_member.id),
      'certificate_permissions', (SELECT count(*) FROM public.organization_certificate_permissions cp WHERE cp.workspace_id = ws_id AND cp.member_id = target_member.id),
      'active_authorities', (SELECT count(*) FROM public.organization_authorities a WHERE a.workspace_id = ws_id AND a.member_id = target_member.id AND a.status IN ('active', 'pending_validation'))
    ),
    'access', jsonb_build_object(
      'active_sessions', (
        SELECT count(*) FROM public.user_sessions s
        WHERE s.user_id = target_member.user_id
          AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)
          AND s.session_token NOT LIKE 'revoked:%'
      ),
      'active_api_credentials', (
        SELECT count(*) FROM public.organization_api_credentials c
        WHERE c.workspace_id = ws_id AND c.created_by = target_member.user_id AND c.status = 'active'
      ),
      'pending_invitations', (
        SELECT count(*) FROM public.organization_invitations i
        WHERE i.workspace_id = ws_id AND lower(i.email) = lower(target_profile.email) AND i.status = 'pending'
      ),
      'global_authenticator_note', 'Los autenticadores personales se conservan porque pueden proteger otros espacios. El acceso a esta organización queda bloqueado por la membresía.'
    )
  ) INTO result;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_organization_member_offboarding_job(
  ws_id UUID,
  target_member_id UUID,
  successor_member_id UUID DEFAULT NULL,
  requested_effective_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  offboarding_reason TEXT DEFAULT NULL,
  requested_transfer_plan JSONB DEFAULT '{}'::JSONB,
  requested_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_member public.workspace_members%ROWTYPE;
  successor_member public.workspace_members%ROWTYPE;
  inventory JSONB;
  transferable_count INTEGER;
  job public.organization_member_offboarding_jobs%ROWTYPE;
  effective_value TIMESTAMPTZ := COALESCE(requested_effective_at, CURRENT_TIMESTAMP);
  key_value TEXT := COALESCE(NULLIF(trim(requested_idempotency_key), ''), gen_random_uuid()::TEXT);
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'members.offboard') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO target_member
  FROM public.workspace_members
  WHERE id = target_member_id AND workspace_id = ws_id
  FOR UPDATE;

  IF target_member.id IS NULL THEN
    RAISE EXCEPTION 'organization_member_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF target_member.user_id = auth.uid() THEN
    RAISE EXCEPTION 'organization_cannot_offboard_self' USING ERRCODE = '23514';
  END IF;
  IF target_member.role = 'owner'::public.workspace_member_role THEN
    RAISE EXCEPTION 'organization_owner_transfer_required' USING ERRCODE = '23514';
  END IF;
  IF target_member.status = 'offboarded' THEN
    RAISE EXCEPTION 'organization_member_already_offboarded' USING ERRCODE = '23514';
  END IF;

  inventory := public.get_organization_member_offboarding_preview(ws_id, target_member_id);
  SELECT COALESCE(sum(value::INTEGER), 0) INTO transferable_count
  FROM jsonb_each_text(inventory -> 'assets')
  WHERE key <> 'active_authorities';

  IF successor_member_id IS NOT NULL THEN
    SELECT * INTO successor_member
    FROM public.workspace_members
    WHERE id = successor_member_id AND workspace_id = ws_id AND status = 'active';
    IF successor_member.id IS NULL OR successor_member.id = target_member.id THEN
      RAISE EXCEPTION 'organization_invalid_successor' USING ERRCODE = '23514';
    END IF;
  ELSIF transferable_count > 0 THEN
    RAISE EXCEPTION 'organization_successor_required' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.organization_member_offboarding_jobs (
    workspace_id, member_id, successor_member_id, requested_by, status,
    effective_at, reason, transfer_plan, asset_inventory, idempotency_key
  ) VALUES (
    ws_id, target_member_id, successor_member_id, auth.uid(),
    CASE WHEN effective_value > CURRENT_TIMESTAMP THEN 'scheduled' ELSE 'pending' END,
    effective_value, NULLIF(trim(offboarding_reason), ''),
    jsonb_build_object(
      'documents', COALESCE((requested_transfer_plan ->> 'documents')::BOOLEAN, TRUE),
      'case_files', COALESCE((requested_transfer_plan ->> 'case_files')::BOOLEAN, TRUE),
      'tasks', COALESCE((requested_transfer_plan ->> 'tasks')::BOOLEAN, TRUE),
      'shared_resources', COALESCE((requested_transfer_plan ->> 'shared_resources')::BOOLEAN, TRUE),
      'responsibilities', COALESCE((requested_transfer_plan ->> 'responsibilities')::BOOLEAN, TRUE),
      'api_credentials', COALESCE((requested_transfer_plan ->> 'api_credentials')::BOOLEAN, TRUE)
    ),
    inventory,
    key_value
  )
  ON CONFLICT (workspace_id, idempotency_key) DO UPDATE
    SET idempotency_key = EXCLUDED.idempotency_key
  RETURNING * INTO job;

  INSERT INTO public.organization_audit_events (
    workspace_id, actor_user_id, event_type, resource_type, resource_id,
    summary, severity, module, payload
  ) VALUES (
    ws_id, auth.uid(), 'member.offboarding.requested', 'organization_member_offboarding_job', job.id::TEXT,
    CASE WHEN job.status = 'scheduled' THEN 'Baja organizacional programada' ELSE 'Baja organizacional preparada' END,
    'high', 'continuity', jsonb_build_object('member_id', target_member_id, 'successor_member_id', successor_member_id, 'effective_at', effective_value)
  );

  RETURN jsonb_build_object('id', job.id, 'status', job.status, 'effective_at', job.effective_at, 'inventory', job.asset_inventory);
END;
$$;

CREATE OR REPLACE FUNCTION public.execute_organization_member_offboarding_job(target_job_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  job public.organization_member_offboarding_jobs%ROWTYPE;
  target_member public.workspace_members%ROWTYPE;
  successor_member public.workspace_members%ROWTYPE;
  target_email TEXT;
  report JSONB;
  started TIMESTAMPTZ := clock_timestamp();
  affected INTEGER;
  documents_count INTEGER := 0;
  cases_count INTEGER := 0;
  tasks_count INTEGER := 0;
  owned_resources_count INTEGER := 0;
  custody_resources_count INTEGER := 0;
  teams_count INTEGER := 0;
  units_removed_count INTEGER := 0;
  cost_centers_count INTEGER := 0;
  certificate_permissions_count INTEGER := 0;
  authorities_count INTEGER := 0;
  sessions_count INTEGER := 0;
  api_keys_count INTEGER := 0;
  invitations_count INTEGER := 0;
  error_state TEXT;
  error_message TEXT;
BEGIN
  SELECT * INTO job
  FROM public.organization_member_offboarding_jobs
  WHERE id = target_job_id
  FOR UPDATE;

  IF job.id IS NULL THEN
    RAISE EXCEPTION 'organization_offboarding_job_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF auth.role() <> 'service_role' AND NOT public.has_organization_permission(job.workspace_id, 'members.offboard') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;
  IF job.status = 'completed' THEN
    RETURN COALESCE(job.completion_report, jsonb_build_object('id', job.id, 'status', 'completed'));
  END IF;
  IF job.status IN ('cancelled', 'failed') THEN
    RAISE EXCEPTION 'organization_offboarding_job_not_executable' USING ERRCODE = '23514';
  END IF;
  IF job.effective_at > CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'organization_offboarding_not_due' USING ERRCODE = '22023';
  END IF;

  UPDATE public.organization_member_offboarding_jobs
  SET status = 'processing', started_at = CURRENT_TIMESTAMP, failure_code = NULL, failure_detail = NULL
  WHERE id = job.id;

  BEGIN
    SELECT * INTO target_member
    FROM public.workspace_members
    WHERE id = job.member_id AND workspace_id = job.workspace_id
    FOR UPDATE;

    IF target_member.id IS NULL OR target_member.status = 'offboarded' THEN
      RAISE EXCEPTION 'organization_member_not_available';
    END IF;
    IF target_member.role = 'owner'::public.workspace_member_role THEN
      RAISE EXCEPTION 'organization_owner_transfer_required';
    END IF;

    SELECT email INTO target_email FROM public.user_profiles WHERE id = target_member.user_id;

    IF job.successor_member_id IS NOT NULL THEN
      SELECT * INTO successor_member
      FROM public.workspace_members
      WHERE id = job.successor_member_id AND workspace_id = job.workspace_id AND status = 'active'
      FOR UPDATE;
      IF successor_member.id IS NULL THEN
        RAISE EXCEPTION 'organization_invalid_successor';
      END IF;
    END IF;

    IF COALESCE((job.transfer_plan ->> 'documents')::BOOLEAN, TRUE) THEN
      UPDATE public.documentos SET owner_id = successor_member.user_id
      WHERE workspace_id = job.workspace_id AND owner_id = target_member.user_id AND successor_member.id IS NOT NULL;
      GET DIAGNOSTICS documents_count = ROW_COUNT;
    END IF;

    IF COALESCE((job.transfer_plan ->> 'case_files')::BOOLEAN, TRUE) THEN
      UPDATE public.case_files SET owner_user_id = successor_member.user_id
      WHERE workspace_id = job.workspace_id AND owner_user_id = target_member.user_id AND successor_member.id IS NOT NULL;
      GET DIAGNOSTICS cases_count = ROW_COUNT;
    END IF;

    IF COALESCE((job.transfer_plan ->> 'tasks')::BOOLEAN, TRUE) THEN
      UPDATE public.tareas SET assigned_to = successor_member.user_id
      WHERE workspace_id = job.workspace_id AND assigned_to = target_member.user_id AND successor_member.id IS NOT NULL;
      GET DIAGNOSTICS tasks_count = ROW_COUNT;
    END IF;

    IF COALESCE((job.transfer_plan ->> 'shared_resources')::BOOLEAN, TRUE) THEN
      UPDATE public.organization_shared_resources SET owner_user_id = successor_member.user_id
      WHERE workspace_id = job.workspace_id AND owner_user_id = target_member.user_id AND successor_member.id IS NOT NULL;
      GET DIAGNOSTICS owned_resources_count = ROW_COUNT;

      UPDATE public.organization_shared_resources SET custodian_user_id = successor_member.user_id
      WHERE workspace_id = job.workspace_id AND custodian_user_id = target_member.user_id AND successor_member.id IS NOT NULL;
      GET DIAGNOSTICS custody_resources_count = ROW_COUNT;
    END IF;

    IF COALESCE((job.transfer_plan ->> 'responsibilities')::BOOLEAN, TRUE) THEN
      UPDATE public.organization_units SET leader_member_id = successor_member.id
      WHERE workspace_id = job.workspace_id AND leader_member_id = target_member.id AND successor_member.id IS NOT NULL;
      GET DIAGNOSTICS teams_count = ROW_COUNT;

      DELETE FROM public.organization_unit_members
      WHERE member_id = target_member.id
        AND unit_id IN (SELECT id FROM public.organization_units WHERE workspace_id = job.workspace_id);
      GET DIAGNOSTICS units_removed_count = ROW_COUNT;

      UPDATE public.organization_cost_centers SET owner_member_id = successor_member.id
      WHERE workspace_id = job.workspace_id AND owner_member_id = target_member.id AND successor_member.id IS NOT NULL;
      GET DIAGNOSTICS cost_centers_count = ROW_COUNT;

      UPDATE public.organization_certificate_permissions SET member_id = successor_member.id
      WHERE workspace_id = job.workspace_id AND member_id = target_member.id AND successor_member.id IS NOT NULL;
      GET DIAGNOSTICS certificate_permissions_count = ROW_COUNT;
    END IF;

    UPDATE public.organization_authorities
    SET status = 'suspended', updated_at = CURRENT_TIMESTAMP
    WHERE workspace_id = job.workspace_id AND member_id = target_member.id AND status IN ('active', 'pending_validation');
    GET DIAGNOSTICS authorities_count = ROW_COUNT;

    INSERT INTO public.organization_session_revocations (
      workspace_id, member_id, session_id, scope, reason, revoked_by
    )
    SELECT job.workspace_id, target_member.id, s.id, 'member_all',
      COALESCE(job.reason, 'Baja organizacional'), job.requested_by
    FROM public.user_sessions s
    WHERE s.user_id = target_member.user_id
      AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)
      AND s.session_token NOT LIKE 'revoked:%';
    GET DIAGNOSTICS sessions_count = ROW_COUNT;

    UPDATE public.user_sessions
    SET expires_at = CURRENT_TIMESTAMP,
        is_current = FALSE,
        session_token = 'revoked:offboarding:' || id::TEXT || ':' || extract(epoch from CURRENT_TIMESTAMP)::BIGINT::TEXT
    WHERE user_id = target_member.user_id
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      AND session_token NOT LIKE 'revoked:%';

    IF COALESCE((job.transfer_plan ->> 'api_credentials')::BOOLEAN, TRUE) THEN
      UPDATE public.organization_api_credentials
      SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP
      WHERE workspace_id = job.workspace_id AND created_by = target_member.user_id AND status = 'active';
      GET DIAGNOSTICS api_keys_count = ROW_COUNT;
    END IF;

    UPDATE public.organization_invitations
    SET status = 'revoked'
    WHERE workspace_id = job.workspace_id AND lower(email) = lower(target_email) AND status = 'pending';
    GET DIAGNOSTICS invitations_count = ROW_COUNT;

    UPDATE public.workspace_members
    SET status = 'offboarded', offboarded_at = CURRENT_TIMESTAMP,
        suspended_at = COALESCE(suspended_at, CURRENT_TIMESTAMP), access_expires_at = CURRENT_TIMESTAMP
    WHERE id = target_member.id AND workspace_id = job.workspace_id;

    report := jsonb_build_object(
      'id', job.id,
      'status', 'completed',
      'member_id', target_member.id,
      'successor_member_id', successor_member.id,
      'effective_at', job.effective_at,
      'completed_at', CURRENT_TIMESTAMP,
      'transferred', jsonb_build_object(
        'documents', documents_count,
        'case_files', cases_count,
        'tasks', tasks_count,
        'shared_resources_owned', owned_resources_count,
        'shared_resources_custodied', custody_resources_count,
        'teams_led', teams_count,
        'unit_memberships_removed', units_removed_count,
        'cost_centers', cost_centers_count,
        'certificate_permissions', certificate_permissions_count
      ),
      'revoked', jsonb_build_object(
        'authorities_suspended', authorities_count,
        'sessions', sessions_count,
        'api_credentials', api_keys_count,
        'pending_invitations', invitations_count
      ),
      'preserved', jsonb_build_array('membership_history', 'document_authorship', 'signature_evidence', 'audit_history', 'personal_authenticators')
    );

    UPDATE public.organization_member_offboarding_jobs
    SET status = 'completed', completion_report = report, completed_at = CURRENT_TIMESTAMP
    WHERE id = job.id;

    INSERT INTO public.organization_audit_events (
      workspace_id, actor_user_id, event_type, resource_type, resource_id,
      summary, severity, module, payload, duration_ms
    ) VALUES (
      job.workspace_id, job.requested_by, 'member.offboarding.completed',
      'organization_member_offboarding_job', job.id::TEXT, 'Baja organizacional concluida',
      'critical', 'continuity', report,
      GREATEST(0, (extract(epoch FROM (clock_timestamp() - started)) * 1000)::INTEGER)
    );

    INSERT INTO public.notifications (user_id, type, title, description, priority, metadata)
    VALUES (
      target_member.user_id, 'security', 'Acceso a organización finalizado',
      'Tu membresía fue dada de baja. El historial documental y de firma se conserva.', 'alta',
      jsonb_build_object('workspace_id', job.workspace_id, 'offboarding_job_id', job.id)
    );

    IF successor_member.id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, description, priority, metadata)
      VALUES (
        successor_member.user_id, 'organization', 'Responsabilidades reasignadas',
        'Recibiste activos y responsabilidades por una baja organizacional.', 'alta',
        jsonb_build_object('workspace_id', job.workspace_id, 'offboarding_job_id', job.id)
      );
    END IF;

    RETURN report;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS error_state = RETURNED_SQLSTATE, error_message = MESSAGE_TEXT;
    UPDATE public.organization_member_offboarding_jobs
    SET status = 'failed', failure_code = error_state, failure_detail = left(error_message, 1000)
    WHERE id = job.id;

    INSERT INTO public.organization_audit_events (
      workspace_id, actor_user_id, event_type, resource_type, resource_id,
      summary, outcome, severity, module, payload, duration_ms
    ) VALUES (
      job.workspace_id, job.requested_by, 'member.offboarding.failed',
      'organization_member_offboarding_job', job.id::TEXT, 'La baja organizacional no pudo completarse',
      'failed', 'critical', 'continuity', jsonb_build_object('failure_code', error_state),
      GREATEST(0, (extract(epoch FROM (clock_timestamp() - started)) * 1000)::INTEGER)
    );

    RETURN jsonb_build_object('id', job.id, 'status', 'failed', 'failure_code', error_state, 'message', 'No se realizó ningún cambio. Revisa la configuración y reintenta.');
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_organization_member_offboarding_job(target_job_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  job public.organization_member_offboarding_jobs%ROWTYPE;
BEGIN
  SELECT * INTO job FROM public.organization_member_offboarding_jobs WHERE id = target_job_id FOR UPDATE;
  IF job.id IS NULL THEN RAISE EXCEPTION 'organization_offboarding_job_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.has_organization_permission(job.workspace_id, 'members.offboard') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;
  IF job.status NOT IN ('pending', 'scheduled') THEN
    RAISE EXCEPTION 'organization_offboarding_job_not_cancellable' USING ERRCODE = '23514';
  END IF;
  UPDATE public.organization_member_offboarding_jobs
  SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP
  WHERE id = job.id;
  INSERT INTO public.organization_audit_events (
    workspace_id, actor_user_id, event_type, resource_type, resource_id, summary, severity, module
  ) VALUES (
    job.workspace_id, auth.uid(), 'member.offboarding.cancelled', 'organization_member_offboarding_job', job.id::TEXT,
    'Baja organizacional cancelada', 'high', 'continuity'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_organization_ownership_transfer(
  ws_id UUID,
  target_member_id UUID,
  requested_token_hash TEXT,
  requested_expires_at TIMESTAMPTZ,
  requested_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_owner public.workspace_members%ROWTYPE;
  target_member public.workspace_members%ROWTYPE;
  target_profile public.user_profiles%ROWTYPE;
  transfer public.organization_ownership_transfers%ROWTYPE;
  target_has_mfa BOOLEAN;
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'organization.transfer_ownership') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;
  IF requested_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'organization_invalid_transfer_token_hash' USING ERRCODE = '22023';
  END IF;
  IF requested_expires_at <= CURRENT_TIMESTAMP OR requested_expires_at > CURRENT_TIMESTAMP + INTERVAL '24 hours' THEN
    RAISE EXCEPTION 'organization_invalid_transfer_expiration' USING ERRCODE = '22023';
  END IF;

  SELECT wm.* INTO current_owner
  FROM public.workspaces w
  JOIN public.workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = w.owner_id
  WHERE w.id = ws_id AND w.owner_id = auth.uid() AND wm.role = 'owner' AND wm.status = 'active'
  FOR UPDATE OF w, wm;
  IF current_owner.id IS NULL THEN
    RAISE EXCEPTION 'organization_current_owner_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO target_member
  FROM public.workspace_members
  WHERE id = target_member_id AND workspace_id = ws_id AND status = 'active'
  FOR UPDATE;
  IF target_member.id IS NULL OR target_member.id = current_owner.id THEN
    RAISE EXCEPTION 'organization_invalid_new_owner' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO target_profile FROM public.user_profiles WHERE id = target_member.user_id;
  IF NOT COALESCE(target_profile.email_verified, FALSE) THEN
    RAISE EXCEPTION 'organization_new_owner_email_not_verified' USING ERRCODE = '23514';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_totp_settings t
    WHERE t.user_id = target_member.user_id AND t.is_enabled = TRUE AND t.confirmed_at IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM public.webauthn_credentials w
    WHERE w.user_id = target_member.user_id AND w.is_active = TRUE
  ) INTO target_has_mfa;
  IF NOT target_has_mfa THEN
    RAISE EXCEPTION 'organization_new_owner_mfa_required' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.organization_ownership_transfers (
    workspace_id, current_owner_member_id, target_member_id, requested_by,
    token_hash, idempotency_key, expires_at
  ) VALUES (
    ws_id, current_owner.id, target_member.id, auth.uid(), requested_token_hash,
    COALESCE(NULLIF(trim(requested_idempotency_key), ''), gen_random_uuid()::TEXT), requested_expires_at
  )
  ON CONFLICT (workspace_id, idempotency_key) DO UPDATE
    SET idempotency_key = EXCLUDED.idempotency_key
  RETURNING * INTO transfer;

  INSERT INTO public.notifications (user_id, type, title, description, priority, metadata)
  VALUES (
    target_member.user_id, 'security', 'Transferencia de propiedad pendiente',
    'El propietario actual inició una transferencia. Confirma únicamente desde el enlace seguro enviado a tu correo.',
    'alta', jsonb_build_object('workspace_id', ws_id, 'ownership_transfer_id', transfer.id)
  );

  INSERT INTO public.organization_audit_events (
    workspace_id, actor_user_id, event_type, resource_type, resource_id,
    summary, severity, module, payload
  ) VALUES (
    ws_id, auth.uid(), 'organization.ownership_transfer.requested',
    'organization_ownership_transfer', transfer.id::TEXT, 'Transferencia de propiedad solicitada',
    'critical', 'continuity', jsonb_build_object('current_owner_member_id', current_owner.id, 'target_member_id', target_member.id, 'expires_at', requested_expires_at)
  );

  RETURN jsonb_build_object('id', transfer.id, 'status', transfer.status, 'target_email', target_profile.email, 'expires_at', transfer.expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_organization_ownership_transfer(raw_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  transfer public.organization_ownership_transfers%ROWTYPE;
  current_owner public.workspace_members%ROWTYPE;
  target_member public.workspace_members%ROWTYPE;
  target_profile public.user_profiles%ROWTYPE;
  target_has_mfa BOOLEAN;
  owner_role_id UUID;
  admin_role_id UUID;
BEGIN
  SELECT * INTO transfer
  FROM public.organization_ownership_transfers
  WHERE token_hash = encode(digest(raw_token, 'sha256'), 'hex')
  FOR UPDATE;

  IF transfer.id IS NULL OR transfer.status <> 'pending' THEN
    RAISE EXCEPTION 'organization_ownership_transfer_invalid' USING ERRCODE = 'P0002';
  END IF;
  IF transfer.expires_at <= CURRENT_TIMESTAMP THEN
    UPDATE public.organization_ownership_transfers SET status = 'expired' WHERE id = transfer.id;
    RAISE EXCEPTION 'organization_ownership_transfer_expired' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO current_owner FROM public.workspace_members
  WHERE id = transfer.current_owner_member_id AND workspace_id = transfer.workspace_id AND status = 'active'
  FOR UPDATE;
  SELECT * INTO target_member FROM public.workspace_members
  WHERE id = transfer.target_member_id AND workspace_id = transfer.workspace_id AND status = 'active'
  FOR UPDATE;

  IF target_member.id IS NULL OR target_member.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'organization_ownership_confirmation_denied' USING ERRCODE = '42501';
  END IF;
  IF current_owner.id IS NULL OR current_owner.role <> 'owner'::public.workspace_member_role THEN
    RAISE EXCEPTION 'organization_current_owner_not_available' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = transfer.workspace_id AND w.owner_id = current_owner.user_id
  ) THEN
    RAISE EXCEPTION 'organization_workspace_owner_changed' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO target_profile FROM public.user_profiles WHERE id = target_member.user_id;
  IF NOT COALESCE(target_profile.email_verified, FALSE) THEN
    RAISE EXCEPTION 'organization_new_owner_email_not_verified' USING ERRCODE = '23514';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.user_totp_settings t
    WHERE t.user_id = target_member.user_id AND t.is_enabled = TRUE AND t.confirmed_at IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM public.webauthn_credentials w
    WHERE w.user_id = target_member.user_id AND w.is_active = TRUE
  ) INTO target_has_mfa;
  IF NOT target_has_mfa THEN
    RAISE EXCEPTION 'organization_new_owner_mfa_required' USING ERRCODE = '23514';
  END IF;

  UPDATE public.workspace_members
  SET role = 'admin'::public.workspace_member_role
  WHERE id = current_owner.id;
  UPDATE public.workspace_members
  SET role = 'owner'::public.workspace_member_role
  WHERE id = target_member.id;
  UPDATE public.workspaces
  SET owner_id = target_member.user_id, updated_at = CURRENT_TIMESTAMP
  WHERE id = transfer.workspace_id;

  SELECT id INTO owner_role_id FROM public.organization_roles
  WHERE workspace_id = transfer.workspace_id AND system_key = 'owner';
  SELECT id INTO admin_role_id FROM public.organization_roles
  WHERE workspace_id = transfer.workspace_id AND system_key = 'admin';

  DELETE FROM public.organization_member_roles omr
  USING public.organization_roles r
  WHERE omr.role_id = r.id
    AND omr.workspace_id = transfer.workspace_id
    AND omr.member_id IN (current_owner.id, target_member.id)
    AND r.system_key IN ('owner', 'admin');
  IF admin_role_id IS NOT NULL THEN
    INSERT INTO public.organization_member_roles (workspace_id, member_id, role_id, assigned_by)
    VALUES (transfer.workspace_id, current_owner.id, admin_role_id, target_member.user_id)
    ON CONFLICT DO NOTHING;
  END IF;
  IF owner_role_id IS NOT NULL THEN
    INSERT INTO public.organization_member_roles (workspace_id, member_id, role_id, assigned_by)
    VALUES (transfer.workspace_id, target_member.id, owner_role_id, target_member.user_id)
    ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.organization_ownership_transfers
  SET status = 'completed', confirmed_by = target_member.user_id,
      confirmed_at = CURRENT_TIMESTAMP
  WHERE id = transfer.id;

  UPDATE public.organization_ownership_transfers
  SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP
  WHERE workspace_id = transfer.workspace_id AND status = 'pending' AND id <> transfer.id;

  INSERT INTO public.organization_audit_events (
    workspace_id, actor_user_id, event_type, resource_type, resource_id,
    summary, severity, module, before_payload, after_payload
  ) VALUES (
    transfer.workspace_id, target_member.user_id, 'organization.ownership_transfer.completed',
    'organization_ownership_transfer', transfer.id::TEXT, 'Propiedad de la organización transferida',
    'critical', 'continuity', jsonb_build_object('owner_user_id', current_owner.user_id),
    jsonb_build_object('owner_user_id', target_member.user_id)
  );

  INSERT INTO public.notifications (user_id, type, title, description, priority, metadata)
  VALUES
    (current_owner.user_id, 'security', 'Propiedad transferida', 'La transferencia de propiedad se completó. Tu acceso continúa con rol de administrador.', 'alta', jsonb_build_object('workspace_id', transfer.workspace_id)),
    (target_member.user_id, 'security', 'Ahora eres propietario', 'La transferencia se confirmó y la organización permanece con un propietario activo.', 'alta', jsonb_build_object('workspace_id', transfer.workspace_id));

  RETURN jsonb_build_object('id', transfer.id, 'status', 'completed', 'workspace_id', transfer.workspace_id, 'new_owner_user_id', target_member.user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_organization_ownership_transfer(target_transfer_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  transfer public.organization_ownership_transfers%ROWTYPE;
BEGIN
  SELECT * INTO transfer FROM public.organization_ownership_transfers WHERE id = target_transfer_id FOR UPDATE;
  IF transfer.id IS NULL THEN RAISE EXCEPTION 'organization_ownership_transfer_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.has_organization_permission(transfer.workspace_id, 'organization.transfer_ownership') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;
  IF transfer.status <> 'pending' THEN
    RAISE EXCEPTION 'organization_ownership_transfer_not_cancellable' USING ERRCODE = '23514';
  END IF;
  UPDATE public.organization_ownership_transfers
  SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP
  WHERE id = transfer.id;
  INSERT INTO public.organization_audit_events (
    workspace_id, actor_user_id, event_type, resource_type, resource_id, summary, severity, module
  ) VALUES (
    transfer.workspace_id, auth.uid(), 'organization.ownership_transfer.cancelled',
    'organization_ownership_transfer', transfer.id::TEXT, 'Transferencia de propiedad cancelada',
    'critical', 'continuity'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_organization_member_offboarding_preview(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization_member_offboarding_job(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_organization_member_offboarding_job(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_organization_member_offboarding_job(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization_ownership_transfer(UUID, UUID, TEXT, TIMESTAMPTZ, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_organization_ownership_transfer(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_organization_ownership_transfer(UUID) TO authenticated;

REVOKE ALL ON public.organization_member_offboarding_jobs FROM anon, authenticated;
REVOKE ALL ON public.organization_ownership_transfers FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.organization_member_offboarding_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.organization_ownership_transfers TO service_role;

ALTER TABLE public.organization_member_offboarding_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_ownership_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_manage_org_offboarding" ON public.organization_member_offboarding_jobs;
CREATE POLICY "service_manage_org_offboarding" ON public.organization_member_offboarding_jobs
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "service_manage_org_ownership_transfers" ON public.organization_ownership_transfers;
CREATE POLICY "service_manage_org_ownership_transfers" ON public.organization_ownership_transfers
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

COMMENT ON TABLE public.organization_member_offboarding_jobs IS
  'Idempotent, auditable organization member offboarding. Historical membership, authorship and signatures are retained.';
COMMENT ON TABLE public.organization_ownership_transfers IS
  'One-time ownership transfer workflow. Stores SHA-256 token hashes only; raw confirmation tokens are never persisted.';
COMMENT ON COLUMN public.organization_member_offboarding_jobs.completion_report IS
  'Machine-readable closeout report with transferred, revoked and preserved categories.';
