-- Migration: geocode_cache table for reverse geocoding results
-- Timestamp: 20260518070000

CREATE TABLE IF NOT EXISTS public.geocode_cache (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key   text UNIQUE NOT NULL,
  result      jsonb NOT NULL,
  created_at  timestamptz DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_geocode_cache_cache_key  ON public.geocode_cache (cache_key);
CREATE INDEX IF NOT EXISTS idx_geocode_cache_expires_at ON public.geocode_cache (expires_at);

-- Enable RLS — only service role can access (no public policies)
ALTER TABLE public.geocode_cache ENABLE ROW LEVEL SECURITY;
