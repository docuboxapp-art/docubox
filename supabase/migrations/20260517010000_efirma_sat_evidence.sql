-- Migration: e.firma SAT evidence columns + session-captures bucket + document_evidence e.firma fields
-- Timestamp: 20260517010000

-- ══ 1. Extend signature_evidence with full e.firma SAT fields ══════════════

ALTER TABLE public.signature_evidence
  -- OCSP
  ADD COLUMN IF NOT EXISTS ocsp_status          TEXT,
  ADD COLUMN IF NOT EXISTS ocsp_checked_at      TIMESTAMPTZ,
  -- Certificado completo
  ADD COLUMN IF NOT EXISTS cert_serial_number   TEXT,
  ADD COLUMN IF NOT EXISTS cert_subject         TEXT,
  ADD COLUMN IF NOT EXISTS cert_rfc             VARCHAR(13),
  ADD COLUMN IF NOT EXISTS cert_curp            VARCHAR(18),
  ADD COLUMN IF NOT EXISTS cert_not_before      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cert_not_after       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cert_issuer          TEXT,
  -- Acto criptográfico
  ADD COLUMN IF NOT EXISTS document_sha256      TEXT,
  ADD COLUMN IF NOT EXISTS digital_seal_sha256  TEXT,
  ADD COLUMN IF NOT EXISTS digital_seal_path    TEXT,
  ADD COLUMN IF NOT EXISTS sign_algorithm       TEXT,
  ADD COLUMN IF NOT EXISTS signed_at            TIMESTAMPTZ,
  -- Intentos de contraseña (sin guardar la contraseña)
  ADD COLUMN IF NOT EXISTS password_attempts    SMALLINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS password_locked      BOOLEAN  DEFAULT FALSE,
  -- Inmutabilidad
  ADD COLUMN IF NOT EXISTS is_voided            BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS voided_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by            UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS void_reason          TEXT,
  -- Biométrico (si no existe)
  ADD COLUMN IF NOT EXISTS face_match_score     NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS face_match_verdict   TEXT,
  ADD COLUMN IF NOT EXISTS nubarium_request_id  TEXT,
  ADD COLUMN IF NOT EXISTS biometric_method     TEXT,
  ADD COLUMN IF NOT EXISTS image_sha256_selfie  TEXT;

-- ══ 2. Índices para e.firma SAT ═══════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_sig_evidence_cert_rfc
  ON public.signature_evidence (cert_rfc)
  WHERE cert_rfc IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sig_evidence_cert_serial
  ON public.signature_evidence (cert_serial_number)
  WHERE cert_serial_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sig_evidence_signed_at
  ON public.signature_evidence (signed_at DESC)
  WHERE signed_at IS NOT NULL;

-- ══ 3. Crear bucket session-captures (privado) ════════════════════════════
-- El bucket se crea vía Storage API desde la Edge Function si no existe.
-- Aquí registramos la política de acceso en la tabla storage.buckets.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'session-captures',
  'session-captures',
  false,
  52428800,
  ARRAY['image/jpeg', 'image/png', 'text/plain']
)
ON CONFLICT (id) DO NOTHING;

-- RLS para session-captures: solo service_role puede insertar/leer
DROP POLICY IF EXISTS "session_captures_service_insert" ON storage.objects;
CREATE POLICY "session_captures_service_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'session-captures'
    AND auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "session_captures_owner_select" ON storage.objects;
CREATE POLICY "session_captures_owner_select"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'session-captures'
    AND auth.role() = 'service_role'
  );
