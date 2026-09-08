-- Keep distributed fixed-window buckets bounded without adding a scheduler.
-- One out of every 256 uniformly hashed keys performs a small, skip-locked sweep.

CREATE INDEX IF NOT EXISTS idx_ai_rate_limit_buckets_expires_at
  ON public.ai_rate_limit_buckets(expires_at);

DELETE FROM public.ai_rate_limit_buckets
WHERE expires_at <= CURRENT_TIMESTAMP;

CREATE OR REPLACE FUNCTION public.consume_server_rate_limit(
  p_key_hash TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_allowed BOOLEAN;
BEGIN
  v_allowed := public.consume_ai_rate_limit(p_key_hash, p_limit, p_window_seconds);

  IF LEFT(p_key_hash, 2) = '00' THEN
    WITH expired AS (
      SELECT bucket.key_hash
      FROM public.ai_rate_limit_buckets bucket
      WHERE bucket.expires_at <= CURRENT_TIMESTAMP
      ORDER BY bucket.expires_at
      FOR UPDATE SKIP LOCKED
      LIMIT 256
    )
    DELETE FROM public.ai_rate_limit_buckets bucket
    USING expired
    WHERE bucket.key_hash = expired.key_hash;
  END IF;

  RETURN v_allowed;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_server_rate_limit(TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_server_rate_limit(TEXT, INTEGER, INTEGER)
  TO service_role;

COMMENT ON FUNCTION public.consume_server_rate_limit(TEXT, INTEGER, INTEGER) IS
  'Distributed fixed-window limiter with bounded opportunistic cleanup for trusted server routes.';
