-- ============================================================
-- Migration: Add missing fields to signature_evidence
-- Timestamp: 20260518060000
-- ============================================================
-- Fields being added:
--   Device: language, screen_resolution, device_type, cpu_cores, device_memory_gb
--   Fingerprint: canvas_hash, webgl_renderer, audio_hash
--   Geo: geo_source, country, region
--   Time: client_timestamp
--   Behavior: total_points, avg_speed_px_s, max_speed_px_s
--   Document: workspace_id, workspace_name, document_pages, document_size_kb, document_created_at
--   Participant: participant_name, participant_email, participant_role
-- ============================================================

ALTER TABLE public.signature_evidence
  -- Device / session
  ADD COLUMN IF NOT EXISTS language            TEXT,
  ADD COLUMN IF NOT EXISTS screen_resolution   TEXT,
  ADD COLUMN IF NOT EXISTS device_type         TEXT,
  ADD COLUMN IF NOT EXISTS cpu_cores           SMALLINT,
  ADD COLUMN IF NOT EXISTS device_memory_gb    NUMERIC(5,2),

  -- Device fingerprint extras
  ADD COLUMN IF NOT EXISTS canvas_hash         TEXT,
  ADD COLUMN IF NOT EXISTS webgl_renderer      TEXT,
  ADD COLUMN IF NOT EXISTS audio_hash          TEXT,

  -- Geolocation extras
  ADD COLUMN IF NOT EXISTS geo_source          TEXT,
  ADD COLUMN IF NOT EXISTS country             TEXT,
  ADD COLUMN IF NOT EXISTS region              TEXT,

  -- Client-side timestamp (reference only — server timestamp is authoritative)
  ADD COLUMN IF NOT EXISTS client_timestamp    TIMESTAMPTZ,

  -- Human behavior metrics (autograph only)
  ADD COLUMN IF NOT EXISTS total_points        INTEGER,
  ADD COLUMN IF NOT EXISTS avg_speed_px_s      NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS max_speed_px_s      NUMERIC(10,2),

  -- Document context snapshot at signing time
  ADD COLUMN IF NOT EXISTS workspace_id        UUID,
  ADD COLUMN IF NOT EXISTS workspace_name      TEXT,
  ADD COLUMN IF NOT EXISTS document_pages      SMALLINT,
  ADD COLUMN IF NOT EXISTS document_size_kb    NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS document_created_at TIMESTAMPTZ,

  -- Participant identity snapshot
  ADD COLUMN IF NOT EXISTS participant_name    TEXT,
  ADD COLUMN IF NOT EXISTS participant_email   TEXT,
  ADD COLUMN IF NOT EXISTS participant_role    TEXT;

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_sig_evidence_participant_email
  ON public.signature_evidence (participant_email)
  WHERE participant_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sig_evidence_workspace_id
  ON public.signature_evidence (workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sig_evidence_device_type
  ON public.signature_evidence (device_type)
  WHERE device_type IS NOT NULL;
