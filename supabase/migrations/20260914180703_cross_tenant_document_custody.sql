-- Cross-tenant custody is an administrative relationship. The document's
-- historical workspace, cryptographic metadata and stored artifacts stay put.

INSERT INTO public.platform_feature_flags (
  flag_key, name, description, global_enabled, rollout_percentage, allowed_plans
)
VALUES (
  'cross_tenant_document_custody',
  'Custodia documental entre organizaciones',
  'Transferencia bilateral de custodia sin cambiar ownership, tenant historico o artefactos.',
  false,
  0,
  '{}'
)
ON CONFLICT (flag_key) DO NOTHING;

INSERT INTO public.organization_permissions (permission_key, name, description, category)
VALUES
  ('documents.custody.transfer', 'Transferir custodia', 'Solicitar y cancelar transferencias de custodia documental.', 'Gobernanza'),
  ('documents.custody.receive', 'Recibir custodia', 'Revisar, aceptar o rechazar solicitudes de custodia documental.', 'Gobernanza')
ON CONFLICT (permission_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category;

INSERT INTO public.organization_role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM public.organization_roles role
CROSS JOIN public.organization_permissions permission
WHERE role.system_key IN ('owner', 'admin')
  AND permission.permission_key IN ('documents.custody.transfer', 'documents.custody.receive')
ON CONFLICT DO NOTHING;

ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS current_custodian_workspace_id UUID REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS custody_updated_at TIMESTAMPTZ;

UPDATE public.documentos
SET current_custodian_workspace_id = workspace_id
WHERE current_custodian_workspace_id IS NULL
  AND workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS documentos_current_custodian_idx
  ON public.documentos(current_custodian_workspace_id, updated_at DESC)
  WHERE current_custodian_workspace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.document_custody_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE RESTRICT,
  source_workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  destination_workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  source_custodian_member_id UUID REFERENCES public.workspace_members(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'rejected', 'cancelled', 'expired')),
  accepted_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  accepted_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT CHECK (rejection_reason IS NULL OR length(trim(rejection_reason)) BETWEEN 3 AND 500),
  cancelled_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days'),
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 240),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (source_workspace_id <> destination_workspace_id),
  CHECK (expires_at > requested_at),
  UNIQUE(source_workspace_id, idempotency_key),
  UNIQUE(document_id, correlation_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS document_custody_transfers_one_active_idx
  ON public.document_custody_transfers(document_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS document_custody_transfers_source_idx
  ON public.document_custody_transfers(source_workspace_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS document_custody_transfers_destination_idx
  ON public.document_custody_transfers(destination_workspace_id, status, requested_at DESC);

ALTER TABLE public.document_custody_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_custody_transfers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.document_custody_transfers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.document_custody_transfers TO authenticated;

DROP POLICY IF EXISTS document_custody_transfers_authorized_read ON public.document_custody_transfers;
CREATE POLICY document_custody_transfers_authorized_read
  ON public.document_custody_transfers FOR SELECT TO authenticated
  USING (
    public.has_organization_permission(source_workspace_id, 'documents.custody.transfer')
    OR public.has_organization_permission(destination_workspace_id, 'documents.custody.receive')
  );

CREATE OR REPLACE FUNCTION public.cross_tenant_custody_user_has_permission(
  p_user_id UUID,
  p_workspace_id UUID,
  p_permission TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members member
    WHERE member.workspace_id = p_workspace_id
      AND member.user_id = p_user_id
      AND member.status = 'active'
      AND (member.access_expires_at IS NULL OR member.access_expires_at > CURRENT_TIMESTAMP)
      AND (
        member.role = 'owner'
        OR member.role = 'admin'
        OR EXISTS (
          SELECT 1
          FROM public.organization_member_roles member_role
          JOIN public.organization_role_permissions role_permission
            ON role_permission.role_id = member_role.role_id
          JOIN public.organization_permissions permission
            ON permission.id = role_permission.permission_id
          WHERE member_role.workspace_id = p_workspace_id
            AND member_role.member_id = member.id
            AND permission.permission_key = p_permission
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.request_cross_tenant_custody_transfer(
  p_document_id UUID,
  p_source_workspace_id UUID,
  p_destination_workspace_id UUID,
  p_actor_user_id UUID,
  p_reason TEXT,
  p_idempotency_key TEXT,
  p_correlation_id UUID,
  p_expires_at TIMESTAMPTZ DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days')
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_document public.documentos%ROWTYPE;
  v_transfer public.document_custody_transfers%ROWTYPE;
  v_source_member_id UUID;
BEGIN
  SELECT * INTO v_document
  FROM public.documentos
  WHERE id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTODY_DOCUMENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF COALESCE(v_document.current_custodian_workspace_id, v_document.workspace_id)
      IS DISTINCT FROM p_source_workspace_id THEN
    RAISE EXCEPTION 'CUSTODY_SOURCE_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;
  IF NOT public.cross_tenant_custody_user_has_permission(
    p_actor_user_id, p_source_workspace_id, 'documents.custody.transfer'
  ) THEN
    RAISE EXCEPTION 'CUSTODY_SOURCE_PERMISSION_DENIED' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspaces workspace
    WHERE workspace.id = p_source_workspace_id
      AND workspace.workspace_type = 'business'::public.workspace_type
      AND workspace.organization_enabled = true
  ) THEN
    RAISE EXCEPTION 'CUSTODY_SOURCE_NOT_ELIGIBLE' USING ERRCODE = '22023';
  END IF;
  IF p_source_workspace_id = p_destination_workspace_id THEN
    RAISE EXCEPTION 'CUSTODY_USE_INTERNAL_TRANSFER' USING ERRCODE = '22023';
  END IF;
  IF lower(COALESCE(v_document.estado, '')) NOT IN ('completado', 'vencido', 'cancelado', 'rechazado') THEN
    RAISE EXCEPTION 'CUSTODY_ACTIVE_DOCUMENT_DENIED' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspaces workspace
    WHERE workspace.id = p_destination_workspace_id
      AND workspace.workspace_type = 'business'::public.workspace_type
      AND workspace.organization_enabled = true
      AND EXISTS (
        SELECT 1 FROM public.workspace_members member
        WHERE member.workspace_id = workspace.id
          AND member.status = 'active'
          AND (member.access_expires_at IS NULL OR member.access_expires_at > CURRENT_TIMESTAMP)
          AND member.role IN ('owner', 'admin')
      )
  ) THEN
    RAISE EXCEPTION 'CUSTODY_DESTINATION_NOT_ELIGIBLE' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at <= CURRENT_TIMESTAMP OR p_expires_at > CURRENT_TIMESTAMP + INTERVAL '30 days' THEN
    RAISE EXCEPTION 'CUSTODY_EXPIRATION_INVALID' USING ERRCODE = '22023';
  END IF;

  UPDATE public.document_custody_transfers
  SET status = 'expired', updated_at = CURRENT_TIMESTAMP
  WHERE document_id = p_document_id
    AND status = 'pending'
    AND expires_at <= CURRENT_TIMESTAMP;

  SELECT * INTO v_transfer
  FROM public.document_custody_transfers
  WHERE source_workspace_id = p_source_workspace_id
    AND idempotency_key = trim(p_idempotency_key);
  IF FOUND THEN
    IF v_transfer.document_id IS DISTINCT FROM p_document_id
       OR v_transfer.destination_workspace_id IS DISTINCT FROM p_destination_workspace_id THEN
      RAISE EXCEPTION 'CUSTODY_IDEMPOTENCY_CONFLICT' USING ERRCODE = '23505';
    END IF;
    RETURN to_jsonb(v_transfer) || jsonb_build_object('idempotent', true);
  END IF;

  SELECT history.custodian_member_id INTO v_source_member_id
  FROM public.document_custody_history history
  WHERE history.document_id = p_document_id
    AND history.ended_at IS NULL
  ORDER BY history.transferred_at DESC
  LIMIT 1;

  IF v_source_member_id IS NULL THEN
    SELECT member.id INTO v_source_member_id
    FROM public.workspace_members member
    WHERE member.workspace_id = p_source_workspace_id
      AND member.user_id = p_actor_user_id
      AND member.status = 'active'
    LIMIT 1;
  END IF;

  BEGIN
    INSERT INTO public.document_custody_transfers (
      document_id, source_workspace_id, destination_workspace_id,
      source_custodian_member_id, requested_by, reason, expires_at,
      correlation_id, idempotency_key
    ) VALUES (
      p_document_id, p_source_workspace_id, p_destination_workspace_id,
      v_source_member_id, p_actor_user_id, trim(p_reason), p_expires_at,
      p_correlation_id, trim(p_idempotency_key)
    ) RETURNING * INTO v_transfer;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_transfer
    FROM public.document_custody_transfers
    WHERE source_workspace_id = p_source_workspace_id
      AND idempotency_key = trim(p_idempotency_key);
    IF FOUND THEN
      IF v_transfer.document_id IS DISTINCT FROM p_document_id
         OR v_transfer.destination_workspace_id IS DISTINCT FROM p_destination_workspace_id THEN
        RAISE EXCEPTION 'CUSTODY_IDEMPOTENCY_CONFLICT' USING ERRCODE = '23505';
      END IF;
      RETURN to_jsonb(v_transfer) || jsonb_build_object('idempotent', true);
    END IF;
    RAISE EXCEPTION 'CUSTODY_ACTIVE_TRANSFER_EXISTS' USING ERRCODE = '23505';
  END;

  INSERT INTO public.document_operational_events (
    workspace_id, document_id, actor_user_id, event_type, event_key,
    correlation_id, source, payload
  ) VALUES (
    p_source_workspace_id, p_document_id, p_actor_user_id,
    'custody.transfer_requested', 'custody:' || v_transfer.id::TEXT || ':requested',
    p_correlation_id, 'database',
    jsonb_build_object(
      'transfer_id', v_transfer.id,
      'source_workspace_id', p_source_workspace_id,
      'destination_workspace_id', p_destination_workspace_id,
      'source_custodian_member_id', v_source_member_id,
      'expires_at', p_expires_at
    )
  ) ON CONFLICT (document_id, event_key) DO NOTHING;

  INSERT INTO public.organization_audit_events (
    workspace_id, actor_user_id, event_type, resource_type, resource_id,
    summary, payload
  ) VALUES (
    p_source_workspace_id, p_actor_user_id, 'custody.transfer_requested',
    'document_custody_transfer', v_transfer.id::TEXT,
    'Transferencia de custodia solicitada',
    jsonb_build_object(
      'document_id', p_document_id,
      'source_workspace_id', p_source_workspace_id,
      'destination_workspace_id', p_destination_workspace_id,
      'source_custodian_member_id', v_source_member_id,
      'correlation_id', p_correlation_id
    )
  );

  RETURN to_jsonb(v_transfer) || jsonb_build_object('idempotent', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_cross_tenant_custody_transfers(
  p_workspace_id UUID,
  p_now TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_transfer public.document_custody_transfers%ROWTYPE;
  v_count INTEGER := 0;
BEGIN
  FOR v_transfer IN
    UPDATE public.document_custody_transfers
    SET status = 'expired', updated_at = p_now
    WHERE status = 'pending'
      AND expires_at <= p_now
      AND (source_workspace_id = p_workspace_id OR destination_workspace_id = p_workspace_id)
    RETURNING *
  LOOP
    v_count := v_count + 1;
    INSERT INTO public.document_operational_events (
      workspace_id, document_id, event_type, event_key, correlation_id, source, payload
    ) VALUES (
      v_transfer.source_workspace_id, v_transfer.document_id,
      'custody.transfer_expired', 'custody:' || v_transfer.id::TEXT || ':expired',
      v_transfer.correlation_id, 'database', jsonb_build_object('transfer_id', v_transfer.id)
    ) ON CONFLICT (document_id, event_key) DO NOTHING;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_cross_tenant_custody_transfer(
  p_transfer_id UUID,
  p_workspace_id UUID,
  p_actor_user_id UUID,
  p_action TEXT,
  p_reason TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_transfer public.document_custody_transfers%ROWTYPE;
  v_document public.documentos%ROWTYPE;
  v_previous public.document_custody_history%ROWTYPE;
  v_destination_member_id UUID;
  v_event_type TEXT;
BEGIN
  SELECT * INTO v_transfer
  FROM public.document_custody_transfers
  WHERE id = p_transfer_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTODY_TRANSFER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF p_action = 'cancel' THEN
    IF p_workspace_id IS DISTINCT FROM v_transfer.source_workspace_id
       OR NOT public.cross_tenant_custody_user_has_permission(
         p_actor_user_id, p_workspace_id, 'documents.custody.transfer'
       ) THEN
      RAISE EXCEPTION 'CUSTODY_CANCEL_PERMISSION_DENIED' USING ERRCODE = '42501';
    END IF;
  ELSIF p_action IN ('accept', 'reject') THEN
    IF p_workspace_id IS DISTINCT FROM v_transfer.destination_workspace_id
       OR NOT public.cross_tenant_custody_user_has_permission(
         p_actor_user_id, p_workspace_id, 'documents.custody.receive'
       ) THEN
      RAISE EXCEPTION 'CUSTODY_DESTINATION_PERMISSION_DENIED' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'CUSTODY_ACTION_INVALID' USING ERRCODE = '22023';
  END IF;

  IF v_transfer.status <> 'pending' THEN
    IF v_transfer.status = (CASE p_action
      WHEN 'accept' THEN 'completed'
      WHEN 'reject' THEN 'rejected'
      WHEN 'cancel' THEN 'cancelled'
      ELSE '' END) THEN
      RETURN to_jsonb(v_transfer) || jsonb_build_object('idempotent', true);
    END IF;
    RAISE EXCEPTION 'CUSTODY_TRANSFER_NOT_PENDING' USING ERRCODE = '55000';
  END IF;

  IF v_transfer.expires_at <= CURRENT_TIMESTAMP THEN
    UPDATE public.document_custody_transfers
    SET status = 'expired', updated_at = CURRENT_TIMESTAMP
    WHERE id = v_transfer.id
    RETURNING * INTO v_transfer;
    INSERT INTO public.document_operational_events (
      workspace_id, document_id, actor_user_id, event_type, event_key,
      correlation_id, source, payload
    ) VALUES (
      v_transfer.source_workspace_id, v_transfer.document_id, p_actor_user_id,
      'custody.transfer_expired', 'custody:' || v_transfer.id::TEXT || ':expired',
      v_transfer.correlation_id, 'database', jsonb_build_object('transfer_id', v_transfer.id)
    ) ON CONFLICT (document_id, event_key) DO NOTHING;
    RETURN to_jsonb(v_transfer) || jsonb_build_object('idempotent', false);
  END IF;

  SELECT * INTO v_document
  FROM public.documentos
  WHERE id = v_transfer.document_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_document.current_custodian_workspace_id, v_document.workspace_id)
      IS DISTINCT FROM v_transfer.source_workspace_id THEN
    RAISE EXCEPTION 'CUSTODY_CURRENT_SCOPE_CHANGED' USING ERRCODE = '55000';
  END IF;

  IF p_action = 'cancel' THEN
    IF p_workspace_id IS DISTINCT FROM v_transfer.source_workspace_id
       OR NOT public.cross_tenant_custody_user_has_permission(
         p_actor_user_id, p_workspace_id, 'documents.custody.transfer'
       ) THEN
      RAISE EXCEPTION 'CUSTODY_CANCEL_PERMISSION_DENIED' USING ERRCODE = '42501';
    END IF;
    UPDATE public.document_custody_transfers
    SET status = 'cancelled', cancelled_by = p_actor_user_id,
        cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = v_transfer.id
    RETURNING * INTO v_transfer;
    v_event_type := 'custody.transfer_cancelled';
  ELSIF p_action IN ('accept', 'reject') THEN
    IF p_workspace_id IS DISTINCT FROM v_transfer.destination_workspace_id
       OR NOT public.cross_tenant_custody_user_has_permission(
         p_actor_user_id, p_workspace_id, 'documents.custody.receive'
       ) THEN
      RAISE EXCEPTION 'CUSTODY_DESTINATION_PERMISSION_DENIED' USING ERRCODE = '42501';
    END IF;
    IF p_action = 'reject' THEN
      UPDATE public.document_custody_transfers
      SET status = 'rejected', rejected_by = p_actor_user_id,
          rejected_at = CURRENT_TIMESTAMP, rejection_reason = NULLIF(trim(p_reason), ''),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = v_transfer.id
      RETURNING * INTO v_transfer;
      v_event_type := 'custody.transfer_rejected';
    ELSE
      SELECT member.id INTO v_destination_member_id
      FROM public.workspace_members member
      WHERE member.workspace_id = v_transfer.destination_workspace_id
        AND member.user_id = p_actor_user_id
        AND member.status = 'active'
        AND (member.access_expires_at IS NULL OR member.access_expires_at > CURRENT_TIMESTAMP)
      LIMIT 1;
      IF v_destination_member_id IS NULL THEN
        RAISE EXCEPTION 'CUSTODY_DESTINATION_MEMBER_REQUIRED' USING ERRCODE = '42501';
      END IF;

      UPDATE public.document_custody_history
      SET ended_at = CURRENT_TIMESTAMP
      WHERE document_id = v_transfer.document_id AND ended_at IS NULL;
      SELECT * INTO v_previous
      FROM public.document_custody_history
      WHERE document_id = v_transfer.document_id
      ORDER BY transferred_at DESC
      LIMIT 1;

      UPDATE public.documentos
      SET current_custodian_workspace_id = v_transfer.destination_workspace_id,
          custody_updated_at = CURRENT_TIMESTAMP
      WHERE id = v_transfer.document_id;

      INSERT INTO public.document_custody_history (
        workspace_id, document_id, previous_custodian_member_id,
        custodian_member_id, transferred_by, reason, idempotency_key
      ) VALUES (
        v_transfer.destination_workspace_id, v_transfer.document_id,
        v_previous.custodian_member_id, v_destination_member_id,
        p_actor_user_id, v_transfer.reason,
        'cross-tenant:' || v_transfer.id::TEXT
      );

      UPDATE public.document_custody_transfers
      SET status = 'completed', accepted_by = p_actor_user_id,
          accepted_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = v_transfer.id
      RETURNING * INTO v_transfer;
      v_event_type := 'custody.transferred';

      INSERT INTO public.document_operational_events (
        workspace_id, document_id, actor_user_id, event_type, event_key,
        correlation_id, source, payload
      ) VALUES (
        v_transfer.destination_workspace_id, v_transfer.document_id, p_actor_user_id,
        'custody.transfer_accepted', 'custody:' || v_transfer.id::TEXT || ':accepted',
        v_transfer.correlation_id, 'database',
        jsonb_build_object('transfer_id', v_transfer.id)
      ) ON CONFLICT (document_id, event_key) DO NOTHING;
    END IF;
  ELSE
    RAISE EXCEPTION 'CUSTODY_ACTION_INVALID' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.document_operational_events (
    workspace_id, document_id, actor_user_id, event_type, event_key,
    correlation_id, source, payload
  ) VALUES (
    CASE WHEN p_action IN ('accept', 'reject')
      THEN v_transfer.destination_workspace_id ELSE v_transfer.source_workspace_id END,
    v_transfer.document_id, p_actor_user_id, v_event_type,
    'custody:' || v_transfer.id::TEXT || ':' || replace(v_event_type, '.', '-'),
    v_transfer.correlation_id, 'database',
    jsonb_build_object(
      'transfer_id', v_transfer.id,
      'source_workspace_id', v_transfer.source_workspace_id,
      'destination_workspace_id', v_transfer.destination_workspace_id,
      'previous_custodian_member_id', CASE WHEN p_action = 'accept'
        THEN v_previous.custodian_member_id ELSE NULL END,
      'new_custodian_member_id', CASE WHEN p_action = 'accept'
        THEN v_destination_member_id ELSE NULL END
    )
  ) ON CONFLICT (document_id, event_key) DO NOTHING;

  INSERT INTO public.organization_audit_events (
    workspace_id, actor_user_id, event_type, resource_type, resource_id,
    summary, payload
  ) VALUES (
    p_workspace_id, p_actor_user_id, v_event_type, 'document_custody_transfer',
    v_transfer.id::TEXT,
    CASE p_action
      WHEN 'accept' THEN 'Transferencia de custodia aceptada y completada'
      WHEN 'reject' THEN 'Transferencia de custodia rechazada'
      ELSE 'Transferencia de custodia cancelada'
    END,
    jsonb_build_object(
      'document_id', v_transfer.document_id,
      'source_workspace_id', v_transfer.source_workspace_id,
      'destination_workspace_id', v_transfer.destination_workspace_id,
      'previous_custodian_member_id', CASE WHEN p_action = 'accept'
        THEN v_previous.custodian_member_id ELSE NULL END,
      'new_custodian_member_id', CASE WHEN p_action = 'accept'
        THEN v_destination_member_id ELSE NULL END,
      'correlation_id', v_transfer.correlation_id
    )
  );

  RETURN to_jsonb(v_transfer) || jsonb_build_object('idempotent', false);
END;
$$;

-- Existing intra-organization custody remains the same operation, but only the
-- organization that currently holds custody can use it after a cross-tenant transfer.
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
  IF NOT FOUND OR COALESCE(v_document.current_custodian_workspace_id, v_document.workspace_id)
      IS DISTINCT FROM p_workspace_id THEN
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

-- Custody grants organization administrators document access without changing
-- historical ownership. Existing participant and explicit ACL access stays valid.
CREATE OR REPLACE FUNCTION public.can_access_documento(p_document_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.documentos document
    WHERE document.id = p_document_id
      AND NOT EXISTS (
        SELECT 1 FROM public.document_user_visibility visibility
        WHERE visibility.document_id = document.id
          AND visibility.user_id = auth.uid()
          AND (visibility.hidden_at IS NOT NULL OR (visibility.trashed_at IS NOT NULL AND visibility.restored_at IS NULL))
      )
      AND (
        document.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.workspace_members manager
          WHERE manager.workspace_id = COALESCE(document.current_custodian_workspace_id, document.workspace_id)
            AND manager.user_id = auth.uid()
            AND manager.status = 'active'
            AND lower(manager.role::TEXT) IN ('owner', 'admin', 'workspace_admin')
            AND (manager.access_expires_at IS NULL OR manager.access_expires_at > CURRENT_TIMESTAMP)
        )
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(document.participantes, '[]'::JSONB)) participant
          WHERE lower(COALESCE(participant ->> 'current_access', 'true')) NOT IN ('false', '0', 'no')
            AND participant ->> 'portal_token_invalidated_at' IS NULL
            AND (
              public.try_uuid(participant ->> 'id') = auth.uid()
              OR public.try_uuid(participant ->> 'user_id') = auth.uid()
              OR lower(COALESCE(participant ->> 'email', '')) = lower(COALESCE(auth.jwt() ->> 'email', ''))
            )
        )
        OR public.has_document_access_permission(document.id, 'view')
      )
  );
$$;

-- Retention inherited from the source is never changed by accepting custody.
-- A current custodian may later apply one of its own policies through the
-- existing explicit, audited retention operation.
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
  IF NOT FOUND OR COALESCE(v_document.current_custodian_workspace_id, v_document.workspace_id)
      IS DISTINCT FROM p_workspace_id THEN
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
        (
          document.owner_id = auth.uid()
          AND COALESCE(document.current_custodian_workspace_id, document.workspace_id)
              IS NOT DISTINCT FROM document.workspace_id
        )
        OR EXISTS (
          SELECT 1 FROM public.workspace_members membership
          WHERE membership.workspace_id = COALESCE(
              document.current_custodian_workspace_id, document.workspace_id
            )
            AND membership.user_id = auth.uid()
            AND membership.status = 'active'
            AND lower(membership.role::TEXT) IN ('owner','admin','workspace_admin')
            AND (membership.access_expires_at IS NULL OR membership.access_expires_at > CURRENT_TIMESTAMP)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_document_storage(object_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_document_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  v_document_id := public.try_uuid(split_part(object_name, '/', 2));
  IF v_document_id IS NULL THEN RETURN false; END IF;
  RETURN public.can_access_documento(v_document_id);
END;
$$;

DROP POLICY IF EXISTS owner_manage_documentos ON public.documentos;
CREATE POLICY owner_manage_documentos
  ON public.documentos AS PERMISSIVE FOR ALL TO authenticated
  USING (
    (SELECT auth.uid()) = owner_id
    AND COALESCE(current_custodian_workspace_id, workspace_id) IS NOT DISTINCT FROM workspace_id
  )
  WITH CHECK (
    (SELECT auth.uid()) = owner_id
    AND COALESCE(current_custodian_workspace_id, workspace_id) IS NOT DISTINCT FROM workspace_id
  );

DROP POLICY IF EXISTS organization_members_read_custody ON public.document_custody_history;
CREATE POLICY organization_members_read_custody
  ON public.document_custody_history FOR SELECT TO authenticated
  USING (public.can_access_documento(document_id));

REVOKE ALL ON FUNCTION public.cross_tenant_custody_user_has_permission(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_cross_tenant_custody_transfer(UUID, UUID, UUID, UUID, TEXT, TEXT, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_cross_tenant_custody_transfer(UUID, UUID, UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_cross_tenant_custody_transfers(UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transfer_document_custody(UUID, UUID, UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cross_tenant_custody_user_has_permission(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_cross_tenant_custody_transfer(UUID, UUID, UUID, UUID, TEXT, TEXT, UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_cross_tenant_custody_transfer(UUID, UUID, UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_cross_tenant_custody_transfers(UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.transfer_document_custody(UUID, UUID, UUID, UUID, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.can_manage_document_package(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_document_storage(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_document_retention_policy(UUID, UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_document_package(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_document_storage(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_document_retention_policy(UUID, UUID, UUID, UUID, TEXT)
  TO service_role;

COMMENT ON COLUMN public.documentos.current_custodian_workspace_id IS
  'Administrative custodian. workspace_id remains the immutable historical/encryption tenant.';
COMMENT ON TABLE public.document_custody_transfers IS
  'Append-only bilateral custody transfer ledger. It never reparents or rewrites document artifacts.';
