-- The audit-chain trigger runs with a restricted search_path. pgcrypto is installed
-- in the extensions schema, so the digest function must be schema-qualified.
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
  NEW.event_hash := encode(extensions.digest(material, 'sha256'), 'hex');
  RETURN NEW;
END;
$$;
