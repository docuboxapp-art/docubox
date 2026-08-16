-- Hash-chain organization audit events and move billing mutations behind the backend.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.organization_audit_events
  ADD COLUMN IF NOT EXISTS sequence_number BIGINT,
  ADD COLUMN IF NOT EXISTS previous_event_hash TEXT,
  ADD COLUMN IF NOT EXISTS event_hash TEXT,
  ADD COLUMN IF NOT EXISTS chain_version INTEGER NOT NULL DEFAULT 1;

DO $$
DECLARE
  workspace_record RECORD;
  event_record RECORD;
  previous_hash TEXT;
  current_hash TEXT;
  next_sequence BIGINT;
  material TEXT;
BEGIN
  FOR workspace_record IN SELECT DISTINCT workspace_id FROM public.organization_audit_events LOOP
    previous_hash := NULL;
    next_sequence := 0;
    FOR event_record IN
      SELECT * FROM public.organization_audit_events
      WHERE workspace_id = workspace_record.workspace_id
      ORDER BY occurred_at, id
    LOOP
      next_sequence := next_sequence + 1;
      material := concat_ws('|',
        event_record.workspace_id::TEXT,
        next_sequence::TEXT,
        COALESCE(previous_hash, 'GENESIS'),
        event_record.occurred_at::TEXT,
        COALESCE(event_record.actor_user_id::TEXT, ''),
        event_record.event_type,
        event_record.resource_type,
        COALESCE(event_record.resource_id, ''),
        event_record.summary,
        event_record.payload::TEXT,
        event_record.outcome,
        event_record.severity,
        COALESCE(event_record.module, ''),
        event_record.origin,
        event_record.correlation_id::TEXT,
        COALESCE(event_record.ip_address::TEXT, ''),
        COALESCE(event_record.user_agent, ''),
        COALESCE(event_record.before_payload::TEXT, ''),
        COALESCE(event_record.after_payload::TEXT, ''),
        event_record.evidence_refs::TEXT
      );
      current_hash := encode(digest(material, 'sha256'), 'hex');
      UPDATE public.organization_audit_events
      SET sequence_number = next_sequence,
          previous_event_hash = previous_hash,
          event_hash = current_hash,
          chain_version = 1
      WHERE id = event_record.id;
      previous_hash := current_hash;
    END LOOP;
  END LOOP;
END;
$$;

DROP INDEX IF EXISTS public.idx_org_audit_workspace_sequence;

CREATE UNIQUE INDEX idx_org_audit_workspace_sequence
  ON public.organization_audit_events(workspace_id, sequence_number);

ALTER TABLE public.organization_audit_events
  ALTER COLUMN sequence_number SET NOT NULL,
  ALTER COLUMN event_hash SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_audit_sequence_positive_check') THEN
    ALTER TABLE public.organization_audit_events ADD CONSTRAINT org_audit_sequence_positive_check
      CHECK (sequence_number > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_audit_event_hash_format_check') THEN
    ALTER TABLE public.organization_audit_events ADD CONSTRAINT org_audit_event_hash_format_check
      CHECK (event_hash ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_audit_previous_hash_format_check') THEN
    ALTER TABLE public.organization_audit_events ADD CONSTRAINT org_audit_previous_hash_format_check
      CHECK (previous_event_hash IS NULL OR previous_event_hash ~ '^[0-9a-f]{64}$');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.chain_organization_audit_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  prior_sequence BIGINT;
  prior_hash TEXT;
  material TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.workspace_id::TEXT, 0));
  IF auth.uid() IS NOT NULL THEN
    NEW.actor_user_id := auth.uid();
  END IF;
  SELECT sequence_number, event_hash INTO prior_sequence, prior_hash
  FROM public.organization_audit_events
  WHERE workspace_id = NEW.workspace_id
  ORDER BY sequence_number DESC NULLS LAST, occurred_at DESC, id DESC
  LIMIT 1;
  NEW.sequence_number := COALESCE(prior_sequence, 0) + 1;
  NEW.previous_event_hash := prior_hash;
  NEW.chain_version := 1;
  material := concat_ws('|',
    NEW.workspace_id::TEXT,
    NEW.sequence_number::TEXT,
    COALESCE(prior_hash, 'GENESIS'),
    NEW.occurred_at::TEXT,
    COALESCE(NEW.actor_user_id::TEXT, ''),
    NEW.event_type,
    NEW.resource_type,
    COALESCE(NEW.resource_id, ''),
    NEW.summary,
    NEW.payload::TEXT,
    NEW.outcome,
    NEW.severity,
    COALESCE(NEW.module, ''),
    NEW.origin,
    NEW.correlation_id::TEXT,
    COALESCE(NEW.ip_address::TEXT, ''),
    COALESCE(NEW.user_agent, ''),
    COALESCE(NEW.before_payload::TEXT, ''),
    COALESCE(NEW.after_payload::TEXT, ''),
    NEW.evidence_refs::TEXT
  );
  NEW.event_hash := encode(digest(material, 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_organization_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'organization_audit_events_are_immutable' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS chain_organization_audit_event ON public.organization_audit_events;
CREATE TRIGGER chain_organization_audit_event
  BEFORE INSERT ON public.organization_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.chain_organization_audit_event();
DROP TRIGGER IF EXISTS prevent_organization_audit_mutation ON public.organization_audit_events;
CREATE TRIGGER prevent_organization_audit_mutation
  BEFORE UPDATE OR DELETE ON public.organization_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_organization_audit_mutation();

DROP POLICY IF EXISTS "org_admin_manage_cost_centers" ON public.organization_cost_centers;
REVOKE INSERT, UPDATE, DELETE ON public.organization_cost_centers FROM authenticated;

COMMENT ON COLUMN public.organization_audit_events.event_hash IS 'SHA-256 chain hash over the canonical organization audit event material.';
