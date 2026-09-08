CREATE OR REPLACE FUNCTION public.claim_blockchain_evidence_jobs(
  p_worker text,
  p_operation text DEFAULT 'ALL',
  p_limit integer DEFAULT 20
)
RETURNS SETOF public.document_blockchain_evidence
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'BLOCKCHAIN_EVIDENCE_SERVICE_ROLE_REQUIRED';
  END IF;
  IF p_operation NOT IN ('STAMP', 'UPGRADE', 'ALL') THEN
    RAISE EXCEPTION 'BLOCKCHAIN_EVIDENCE_OPERATION_INVALID';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT e.id
    FROM public.document_blockchain_evidence e
    WHERE e.status IN (
      'GENERATED','SUBMISSION_FAILED','PENDING_BITCOIN','ANCHORED',
      'UPGRADE_FAILED','VERIFICATION_FAILED','STORAGE_ERROR'
    )
      AND COALESCE(e.next_upgrade_attempt_at, now()) <= now()
      AND (e.claimed_at IS NULL OR e.claimed_at < now() - interval '15 minutes')
      AND (
        p_operation = 'ALL'
        OR (p_operation = 'STAMP' AND e.proof_storage_path IS NULL)
        OR (p_operation = 'UPGRADE' AND e.proof_storage_path IS NOT NULL)
      )
    ORDER BY COALESCE(e.next_upgrade_attempt_at, e.created_at)
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  UPDATE public.document_blockchain_evidence e
     SET claimed_at = now(), claimed_by = p_worker, updated_at = now()
    FROM candidates c
   WHERE e.id = c.id
  RETURNING e.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_blockchain_evidence_jobs(text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_blockchain_evidence_jobs(text, text, integer)
  TO service_role;

COMMENT ON FUNCTION public.claim_blockchain_evidence_jobs(text, text, integer) IS
  'Claims idempotent OpenTimestamps stamp or upgrade jobs using SKIP LOCKED.';
