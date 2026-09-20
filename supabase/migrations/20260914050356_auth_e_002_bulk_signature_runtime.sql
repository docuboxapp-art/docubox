-- AUTH-E-002: complete the existing Bulk Signatures runtime without creating
-- a parallel campaign, workflow, delivery, or evidence engine.

INSERT INTO public.organization_permissions (permission_key, name, description, category)
VALUES
  ('bulk_signatures.read', 'Ver firmas masivas', 'Consultar campanas, filas e incidencias masivas.', 'Operacion'),
  ('bulk_signatures.create', 'Crear firmas masivas', 'Crear y validar campanas masivas.', 'Operacion'),
  ('bulk_signatures.execute', 'Ejecutar firmas masivas', 'Lanzar, reprogramar, pausar y reanudar campanas.', 'Operacion'),
  ('bulk_signatures.cancel', 'Cancelar firmas masivas', 'Cancelar campanas y filas aun no completadas.', 'Operacion')
ON CONFLICT (permission_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category;

ALTER TABLE public.bulk_signature_campaigns
  ADD COLUMN IF NOT EXISTS source_version_id UUID REFERENCES public.document_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE public.bulk_campaign_items
  ADD COLUMN IF NOT EXISTS materialization_document_id UUID,
  ADD COLUMN IF NOT EXISTS source_document_id UUID REFERENCES public.documentos(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_version_id UUID REFERENCES public.document_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS claimed_by TEXT,
  ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retryable BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS failure_stage TEXT CHECK (failure_stage IS NULL OR failure_stage IN ('materialization','delivery')),
  ADD COLUMN IF NOT EXISTS delivery_channel TEXT NOT NULL DEFAULT 'email' CHECK (delivery_channel IN ('email','sms')),
  ADD COLUMN IF NOT EXISTS delivery_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (delivery_attempt_count >= 0),
  ADD COLUMN IF NOT EXISTS materialized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

ALTER TABLE public.bulk_campaign_events
  ADD COLUMN IF NOT EXISTS event_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bulk_item_reserved_document
  ON public.bulk_campaign_items(materialization_document_id)
  WHERE materialization_document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bulk_items_runtime_due_idx
  ON public.bulk_campaign_items(status, COALESCE(next_retry_at, created_at))
  WHERE status IN ('ready','generating','queued','sending','failed');
CREATE UNIQUE INDEX IF NOT EXISTS uq_bulk_campaign_event_key
  ON public.bulk_campaign_events(campaign_id, event_key)
  WHERE event_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_bulk_runtime_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  campaign_workspace UUID;
  source_workspace UUID;
  target_workspace UUID;
BEGIN
  SELECT workspace_id INTO campaign_workspace
  FROM public.bulk_signature_campaigns
  WHERE id = NEW.campaign_id;
  IF NOT FOUND OR campaign_workspace IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'bulk_campaign_workspace_mismatch' USING ERRCODE = '23514';
  END IF;

  IF NEW.source_document_id IS NOT NULL THEN
    SELECT workspace_id INTO source_workspace FROM public.documentos WHERE id = NEW.source_document_id;
    IF NOT FOUND OR source_workspace IS DISTINCT FROM NEW.workspace_id THEN
      RAISE EXCEPTION 'bulk_source_workspace_mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.document_id IS NOT NULL THEN
    SELECT workspace_id INTO target_workspace FROM public.documentos WHERE id = NEW.document_id;
    IF NOT FOUND OR target_workspace IS DISTINCT FROM NEW.workspace_id THEN
      RAISE EXCEPTION 'bulk_instance_workspace_mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_bulk_runtime_scope ON public.bulk_campaign_items;
CREATE TRIGGER enforce_bulk_runtime_scope
  BEFORE INSERT OR UPDATE OF campaign_id, workspace_id, source_document_id, document_id
  ON public.bulk_campaign_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_bulk_runtime_scope();

CREATE OR REPLACE FUNCTION public.refresh_bulk_campaign_progress()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_campaign UUID;
  total_count INTEGER;
  signed_count INTEGER;
  failed_count INTEGER;
  pending_count INTEGER;
  runtime_count INTEGER;
  sent_count INTEGER;
BEGIN
  target_campaign := CASE WHEN TG_OP = 'DELETE' THEN OLD.campaign_id ELSE NEW.campaign_id END;
  SELECT count(*),
         count(*) FILTER (WHERE status = 'signed'),
         count(*) FILTER (WHERE status = 'failed'),
         count(*) FILTER (WHERE status NOT IN ('signed','failed','cancelled','rejected','expired')),
         count(*) FILTER (WHERE status IN ('ready','generating','queued','sending') OR (status = 'failed' AND retryable)),
         count(*) FILTER (WHERE status IN ('sent','viewed','signing','signed'))
  INTO total_count, signed_count, failed_count, pending_count, runtime_count, sent_count
  FROM public.bulk_campaign_items
  WHERE campaign_id = target_campaign;

  UPDATE public.bulk_signature_campaigns campaign
  SET total_items = total_count,
      participant_count = total_count,
      completed_items = signed_count,
      failed_items = failed_count,
      pending_items = pending_count,
      status = CASE
        WHEN campaign.status IN ('draft','paused','cancelled','closed','expired') THEN campaign.status
        WHEN campaign.status = 'scheduled' AND campaign.scheduled_at > CURRENT_TIMESTAMP THEN 'scheduled'
        WHEN total_count > 0 AND signed_count = total_count THEN 'completed'
        WHEN total_count > 0 AND pending_count = 0 AND failed_count > 0 THEN 'completed_with_exceptions'
        WHEN sent_count > 0 THEN 'active'
        WHEN runtime_count > 0 THEN 'processing'
        ELSE campaign.status
      END,
      completed_at = CASE
        WHEN total_count > 0 AND (signed_count = total_count OR (pending_count = 0 AND failed_count > 0))
          THEN COALESCE(campaign.completed_at, CURRENT_TIMESTAMP)
        ELSE campaign.completed_at
      END,
      updated_at = CURRENT_TIMESTAMP
  WHERE campaign.id = target_campaign;

  IF runtime_count = 0 THEN
    UPDATE public.bulk_campaign_jobs job
    SET status = CASE WHEN failed_count > 0 THEN 'partially_completed' ELSE 'completed' END,
        finished_at = COALESCE(job.finished_at, CURRENT_TIMESTAMP),
        error_message = CASE WHEN failed_count > 0 THEN failed_count || ' filas no pudieron completarse' ELSE NULL END
    WHERE job.campaign_id = target_campaign
      AND job.job_type = 'materialize_and_deliver'
      AND job.status IN ('queued','running');
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_bulk_campaign_progress ON public.bulk_campaign_items;
CREATE TRIGGER refresh_bulk_campaign_progress
  AFTER INSERT OR UPDATE OR DELETE ON public.bulk_campaign_items
  FOR EACH ROW EXECUTE FUNCTION public.refresh_bulk_campaign_progress();

CREATE OR REPLACE FUNCTION public.sync_bulk_item_from_document_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  mapped_status TEXT;
BEGIN
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN RETURN NEW; END IF;
  mapped_status := CASE lower(COALESCE(NEW.estado, ''))
    WHEN 'completado' THEN 'signed'
    WHEN 'completed' THEN 'signed'
    WHEN 'firmado' THEN 'signed'
    WHEN 'certificado' THEN 'signed'
    WHEN 'rechazado' THEN 'rejected'
    WHEN 'cancelado' THEN 'cancelled'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'vencido' THEN 'expired'
    WHEN 'expired' THEN 'expired'
    ELSE NULL
  END;
  IF mapped_status IS NULL THEN RETURN NEW; END IF;

  UPDATE public.bulk_campaign_items
  SET status = mapped_status,
      progress = CASE WHEN mapped_status = 'signed' THEN 100 ELSE progress END,
      last_activity_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE document_id = NEW.id
    AND workspace_id IS NOT DISTINCT FROM NEW.workspace_id
    AND status NOT IN ('signed','cancelled');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_bulk_item_from_document_state ON public.documentos;
CREATE TRIGGER sync_bulk_item_from_document_state
  AFTER UPDATE OF estado ON public.documentos
  FOR EACH ROW EXECUTE FUNCTION public.sync_bulk_item_from_document_state();

CREATE OR REPLACE FUNCTION public.claim_bulk_campaign_item_materialization(
  p_worker_id TEXT,
  p_now TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
)
RETURNS SETOF public.bulk_campaign_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     OR length(btrim(COALESCE(p_worker_id, ''))) < 4 THEN
    RAISE EXCEPTION 'bulk_worker_not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT item.id
    FROM public.bulk_campaign_items item
    JOIN public.bulk_signature_campaigns campaign ON campaign.id = item.campaign_id
    JOIN public.bulk_campaign_jobs job
      ON job.campaign_id = campaign.id
     AND job.job_type = 'materialize_and_deliver'
     AND job.status IN ('queued','running')
     AND job.available_at <= p_now
    WHERE campaign.status IN ('ready','scheduled','processing','active')
      AND (campaign.scheduled_at IS NULL OR campaign.scheduled_at <= p_now)
      AND (campaign.expires_at IS NULL OR campaign.expires_at > p_now)
      AND (
        item.status = 'ready'
        OR (item.status = 'generating' AND item.claim_expires_at <= p_now)
        OR (item.status = 'failed' AND item.failure_stage = 'materialization'
            AND item.retryable AND COALESCE(item.next_retry_at, p_now) <= p_now)
      )
    ORDER BY campaign.scheduled_at NULLS FIRST, item.created_at, item.id
    FOR UPDATE OF item SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.bulk_campaign_items item
  SET status = 'generating',
      materialization_document_id = COALESCE(item.materialization_document_id, gen_random_uuid()),
      claimed_by = p_worker_id,
      claim_expires_at = p_now + INTERVAL '5 minutes',
      attempt_count = item.attempt_count + 1,
      retryable = TRUE,
      failure_stage = NULL,
      next_retry_at = NULL,
      error_code = NULL,
      error_message = NULL,
      last_activity_at = p_now,
      updated_at = p_now
  FROM candidate
  WHERE item.id = candidate.id
  RETURNING item.*;

  UPDATE public.bulk_campaign_jobs job
  SET status = 'running',
      started_at = COALESCE(job.started_at, p_now),
      attempt_count = CASE WHEN job.status = 'queued' THEN job.attempt_count + 1 ELSE job.attempt_count END
  WHERE job.campaign_id IN (
    SELECT campaign_id FROM public.bulk_campaign_items
    WHERE claimed_by = p_worker_id AND status = 'generating'
  ) AND job.job_type = 'materialize_and_deliver' AND job.status = 'queued';
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_bulk_campaign_item_materialization(
  p_item_id UUID,
  p_worker_id TEXT,
  p_document_id UUID
)
RETURNS public.bulk_campaign_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  result public.bulk_campaign_items;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'bulk_worker_not_authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.bulk_campaign_items item
  SET document_id = p_document_id,
      status = 'queued',
      progress = GREATEST(item.progress, 70),
      materialized_at = COALESCE(item.materialized_at, CURRENT_TIMESTAMP),
      claimed_by = NULL,
      claim_expires_at = NULL,
      failure_stage = NULL,
      retryable = TRUE,
      next_retry_at = NULL,
      error_code = NULL,
      error_message = NULL,
      last_activity_at = CURRENT_TIMESTAMP
  WHERE item.id = p_item_id
    AND item.status = 'generating'
    AND item.claimed_by = p_worker_id
    AND item.materialization_document_id = p_document_id
  RETURNING item.* INTO result;
  IF result.id IS NULL THEN
    RAISE EXCEPTION 'bulk_materialization_claim_lost' USING ERRCODE = '40001';
  END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_bulk_campaign_item_delivery(
  p_worker_id TEXT,
  p_now TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
)
RETURNS SETOF public.bulk_campaign_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     OR length(btrim(COALESCE(p_worker_id, ''))) < 4 THEN
    RAISE EXCEPTION 'bulk_worker_not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH candidate AS (
    SELECT item.id
    FROM public.bulk_campaign_items item
    JOIN public.bulk_signature_campaigns campaign ON campaign.id = item.campaign_id
    JOIN public.bulk_campaign_jobs job
      ON job.campaign_id = campaign.id
     AND job.job_type = 'materialize_and_deliver'
     AND job.status IN ('queued','running')
    WHERE campaign.status IN ('processing','active','ready','scheduled')
      AND (campaign.scheduled_at IS NULL OR campaign.scheduled_at <= p_now)
      AND (campaign.expires_at IS NULL OR campaign.expires_at > p_now)
      AND item.document_id IS NOT NULL
      AND (
        item.status = 'queued'
        OR (item.status = 'sending' AND item.delivery_channel = 'email' AND item.claim_expires_at <= p_now)
        OR (item.status = 'failed' AND item.failure_stage = 'delivery'
            AND item.retryable AND COALESCE(item.next_retry_at, p_now) <= p_now)
      )
    ORDER BY item.created_at, item.id
    FOR UPDATE OF item SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.bulk_campaign_items item
  SET status = 'sending',
      claimed_by = p_worker_id,
      claim_expires_at = p_now + INTERVAL '5 minutes',
      delivery_attempt_count = item.delivery_attempt_count + 1,
      failure_stage = NULL,
      next_retry_at = NULL,
      error_code = NULL,
      error_message = NULL,
      last_activity_at = p_now,
      updated_at = p_now
  FROM candidate
  WHERE item.id = candidate.id
  RETURNING item.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_bulk_campaign_item_delivery(
  p_item_id UUID,
  p_worker_id TEXT,
  p_provider_message_id TEXT DEFAULT NULL
)
RETURNS public.bulk_campaign_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  result public.bulk_campaign_items;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'bulk_worker_not_authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.bulk_campaign_items item
  SET status = 'sent',
      progress = GREATEST(item.progress, 80),
      delivered_at = COALESCE(item.delivered_at, CURRENT_TIMESTAMP),
      provider_message_id = COALESCE(p_provider_message_id, item.provider_message_id),
      claimed_by = NULL,
      claim_expires_at = NULL,
      retryable = FALSE,
      failure_stage = NULL,
      next_retry_at = NULL,
      error_code = NULL,
      error_message = NULL,
      last_activity_at = CURRENT_TIMESTAMP
  WHERE item.id = p_item_id AND item.status = 'sending' AND item.claimed_by = p_worker_id
  RETURNING item.* INTO result;
  IF result.id IS NULL THEN
    RAISE EXCEPTION 'bulk_delivery_claim_lost' USING ERRCODE = '40001';
  END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_bulk_campaign_item_attempt(
  p_item_id UUID,
  p_worker_id TEXT,
  p_stage TEXT,
  p_error_code TEXT,
  p_error_message TEXT,
  p_retryable BOOLEAN
)
RETURNS public.bulk_campaign_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  result public.bulk_campaign_items;
  attempts INTEGER;
  can_retry BOOLEAN;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     OR p_stage NOT IN ('materialization','delivery') THEN
    RAISE EXCEPTION 'bulk_worker_not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT CASE WHEN p_stage = 'delivery' THEN delivery_attempt_count ELSE attempt_count END
  INTO attempts FROM public.bulk_campaign_items
  WHERE id = p_item_id AND claimed_by = p_worker_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bulk_claim_lost' USING ERRCODE = '40001'; END IF;
  can_retry := p_retryable AND attempts < 5;
  UPDATE public.bulk_campaign_items item
  SET status = 'failed',
      retryable = can_retry,
      failure_stage = p_stage,
      next_retry_at = CASE WHEN can_retry
        THEN CURRENT_TIMESTAMP + make_interval(secs => LEAST(3600, 30 * power(2, GREATEST(0, attempts - 1))::INTEGER))
        ELSE NULL END,
      error_code = left(COALESCE(p_error_code, 'BULK_EXECUTION_FAILED'), 120),
      error_message = left(COALESCE(p_error_message, 'No se pudo completar la fila.'), 1000),
      claimed_by = NULL,
      claim_expires_at = NULL,
      last_activity_at = CURRENT_TIMESTAMP
  WHERE item.id = p_item_id
  RETURNING item.* INTO result;
  RETURN result;
END;
$$;

-- Existing creator RPC remains the single transactional entry point. It now
-- freezes the selected source and creates the existing job row when launched.
CREATE OR REPLACE FUNCTION public.create_bulk_campaign_with_recipients(
  p_workspace_id UUID,
  p_creator_id UUID,
  p_idempotency_key TEXT,
  p_campaign JSONB,
  p_recipients JSONB
)
RETURNS public.bulk_signature_campaigns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  created_campaign public.bulk_signature_campaigns;
  recipient_count INTEGER;
  desired_status TEXT;
  source_document UUID;
  source_version UUID;
  source_hash TEXT;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'bulk_campaign_service_role_required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_campaign) <> 'object' OR jsonb_typeof(p_recipients) <> 'array' THEN
    RAISE EXCEPTION 'bulk_campaign_payload_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members member
    WHERE member.workspace_id = p_workspace_id AND member.user_id = p_creator_id
      AND COALESCE(member.status::TEXT, 'active') = 'active'
      AND (member.access_expires_at IS NULL OR member.access_expires_at > CURRENT_TIMESTAMP)
  ) THEN
    RAISE EXCEPTION 'bulk_campaign_workspace_access_denied' USING ERRCODE = '42501';
  END IF;
  recipient_count := jsonb_array_length(p_recipients);
  IF recipient_count < 1 OR recipient_count > 10000 THEN
    RAISE EXCEPTION 'bulk_campaign_recipient_count_invalid' USING ERRCODE = '22023';
  END IF;
  source_document := NULLIF(p_campaign ->> 'source_document_id', '')::UUID;
  source_version := NULLIF(p_campaign ->> 'source_version_id', '')::UUID;
  source_hash := lower(COALESCE(p_campaign #>> '{source_snapshot,sha256}', ''));
  IF source_document IS NULL OR source_hash !~ '^[0-9a-f]{64}$' OR NOT EXISTS (
    SELECT 1 FROM public.documentos document
    WHERE document.id = source_document AND document.workspace_id = p_workspace_id
      AND document.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'bulk_campaign_source_invalid' USING ERRCODE = '23514';
  END IF;
  IF source_version IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.document_versions version
    WHERE version.id = source_version AND version.document_id = source_document
      AND version.workspace_id = p_workspace_id AND lower(version.sha256) = source_hash
  ) THEN
    RAISE EXCEPTION 'bulk_campaign_source_version_invalid' USING ERRCODE = '23514';
  END IF;
  desired_status := CASE
    WHEN NULLIF(p_campaign ->> 'scheduled_at', '') IS NOT NULL THEN 'scheduled'
    WHEN COALESCE((p_campaign ->> 'launch')::BOOLEAN, FALSE) THEN 'ready'
    ELSE 'draft'
  END;

  INSERT INTO public.bulk_signature_campaigns (
    workspace_id, name, description, campaign_type, source_type, status,
    owner_user_id, template_id, source_document_id, source_version_id, source_snapshot,
    priority, internal_reference, timezone, expires_at, scheduled_at, signature_policy,
    identity_policy, notification_policy, source_configuration, validation_summary,
    total_items, pending_items, participant_count, idempotency_key, created_by, updated_by
  ) VALUES (
    p_workspace_id, trim(p_campaign ->> 'name'), NULLIF(trim(p_campaign ->> 'description'), ''),
    p_campaign ->> 'campaign_type', COALESCE(NULLIF(p_campaign ->> 'source_type', ''), p_campaign ->> 'campaign_type'),
    desired_status, p_creator_id, NULLIF(p_campaign ->> 'template_id', '')::UUID,
    source_document, source_version, p_campaign -> 'source_snapshot',
    COALESCE(NULLIF(p_campaign ->> 'priority', ''), 'normal'),
    NULLIF(trim(p_campaign ->> 'internal_reference'), ''),
    COALESCE(NULLIF(p_campaign ->> 'timezone', ''), 'UTC'),
    NULLIF(p_campaign ->> 'expires_at', '')::TIMESTAMPTZ,
    NULLIF(p_campaign ->> 'scheduled_at', '')::TIMESTAMPTZ,
    COALESCE(p_campaign -> 'signature_policy', '{}'::JSONB),
    COALESCE(p_campaign -> 'identity_policy', '{}'::JSONB),
    COALESCE(p_campaign -> 'notification_policy', '{}'::JSONB),
    COALESCE(p_campaign -> 'source_configuration', '{}'::JSONB),
    jsonb_build_object('total', recipient_count, 'valid', recipient_count, 'invalid', 0),
    recipient_count, recipient_count, recipient_count, p_idempotency_key, p_creator_id, p_creator_id
  ) RETURNING * INTO created_campaign;

  INSERT INTO public.bulk_campaign_items (
    workspace_id, campaign_id, source_row_id, source_row_hash, source_payload,
    participant_name, participant_email, participant_phone, source_document_id,
    source_version_id, source_sha256, delivery_channel, status, progress
  )
  SELECT p_workspace_id, created_campaign.id, row ->> 'source_row_id', row ->> 'source_row_hash',
         COALESCE(row -> 'payload', '{}'::JSONB), row ->> 'name', lower(row ->> 'email'),
         NULLIF(row ->> 'phone', ''), source_document, source_version, source_hash,
         CASE WHEN lower(COALESCE(row #>> '{payload,canal}', row #>> '{payload,channel}', 'email')) = 'sms'
              THEN 'sms' ELSE 'email' END,
         'ready', 10
  FROM jsonb_array_elements(p_recipients) AS row;

  INSERT INTO public.bulk_campaign_imports (
    workspace_id, campaign_id, file_name, mime_type, status, validation_summary,
    total_rows, valid_rows, invalid_rows, created_by
  ) VALUES (
    p_workspace_id, created_campaign.id,
    COALESCE(NULLIF(p_campaign ->> 'source_name', ''), 'lista'), 'text/csv', 'valid',
    jsonb_build_object('total', recipient_count, 'valid', recipient_count, 'invalid', 0),
    recipient_count, recipient_count, 0, p_creator_id
  );

  IF desired_status IN ('ready','scheduled') THEN
    INSERT INTO public.bulk_campaign_jobs (
      workspace_id, campaign_id, job_type, status, batch_number, batch_size,
      idempotency_key, available_at, metadata
    ) VALUES (
      p_workspace_id, created_campaign.id, 'materialize_and_deliver', 'queued', 1, 25,
      'bulk-materialize:' || created_campaign.id::TEXT,
      COALESCE(created_campaign.scheduled_at, CURRENT_TIMESTAMP),
      jsonb_build_object('schema_version', 1, 'source_sha256', source_hash)
    ) ON CONFLICT (workspace_id, idempotency_key) DO NOTHING;
  END IF;
  RETURN created_campaign;
EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO created_campaign FROM public.bulk_signature_campaigns
    WHERE workspace_id = p_workspace_id AND idempotency_key = p_idempotency_key;
    IF created_campaign.id IS NULL THEN RAISE; END IF;
    RETURN created_campaign;
END;
$$;

-- Direct client writes are removed. Reads remain tenant/RBAC scoped; all
-- mutations pass through the authenticated module APIs and service-only RPCs.
DO $$
DECLARE
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'bulk_signature_campaigns','bulk_campaign_items','bulk_campaign_imports',
    'bulk_campaign_jobs','bulk_campaign_incidents','bulk_campaign_manifests',
    'bulk_signing_sessions','bulk_campaign_events'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS bulk_workspace_members_access ON public.%I', target_table);
    EXECUTE format('DROP POLICY IF EXISTS bulk_rbac_read ON public.%I', target_table);
    EXECUTE format(
      'CREATE POLICY bulk_rbac_read ON public.%I FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, ''bulk_signatures.read''))',
      target_table
    );
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', target_table);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', target_table);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', target_table);
  END LOOP;
END $$;

DROP POLICY IF EXISTS bulk_signing_session_items_access ON public.bulk_signing_session_items;
CREATE POLICY bulk_signing_session_items_access ON public.bulk_signing_session_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bulk_signing_sessions session
      WHERE session.id = bulk_signing_session_items.session_id
        AND public.has_organization_permission(session.workspace_id, 'bulk_signatures.read')
    )
  );
REVOKE ALL ON TABLE public.bulk_signing_session_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.bulk_signing_session_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bulk_signing_session_items TO service_role;

REVOKE ALL ON FUNCTION public.enforce_bulk_runtime_scope() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_bulk_campaign_progress() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_bulk_item_from_document_state() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_bulk_campaign_item_materialization(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_bulk_campaign_item_materialization(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_bulk_campaign_item_delivery(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_bulk_campaign_item_delivery(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_bulk_campaign_item_attempt(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_bulk_campaign_with_recipients(UUID, UUID, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_bulk_campaign_item_materialization(TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_bulk_campaign_item_materialization(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_bulk_campaign_item_delivery(TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_bulk_campaign_item_delivery(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_bulk_campaign_item_attempt(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_bulk_campaign_with_recipients(UUID, UUID, TEXT, JSONB, JSONB) TO service_role;

COMMENT ON COLUMN public.bulk_campaign_items.materialization_document_id IS
  'Stable UUID reserved before side effects. Retries reuse it to prevent duplicate documents.';
COMMENT ON COLUMN public.bulk_signature_campaigns.source_snapshot IS
  'Immutable source identity/hash selected when the campaign was created; source documents are never rewritten.';
