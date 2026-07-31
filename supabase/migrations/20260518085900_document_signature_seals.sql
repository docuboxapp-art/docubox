-- DOCUBOX — Crear tabla document_signature_seals
-- Almacena el registro de sellos de firma aplicados a documentos
-- Incluye hashes SHA-256, folio único, datos del firmante y firma criptográfica

CREATE TABLE IF NOT EXISTS public.document_signature_seals (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id               UUID NOT NULL,
  signer_email              TEXT NOT NULL,
  signer_name               TEXT,
  folio                     TEXT,
  original_hash             TEXT,
  sealed_hash               TEXT,
  reason                    TEXT,
  location                  TEXT,
  ip_address                TEXT,
  geolocation               TEXT,
  sealed_at                 TIMESTAMPTZ DEFAULT NOW(),
  crypto_signature_applied  BOOLEAN DEFAULT FALSE,
  signature_subfilter       TEXT DEFAULT NULL,
  certificate_cn            TEXT DEFAULT NULL,
  certificate_org           TEXT DEFAULT NULL,
  certificate_country       TEXT DEFAULT NULL,
  timestamp_applied         BOOLEAN DEFAULT FALSE,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (document_id, signer_email)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_document_signature_seals_document_id
  ON public.document_signature_seals (document_id);

CREATE INDEX IF NOT EXISTS idx_document_signature_seals_signer_email
  ON public.document_signature_seals (signer_email);

-- RLS
ALTER TABLE public.document_signature_seals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados pueden leer sus propios sellos"
  ON public.document_signature_seals
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role puede insertar y actualizar sellos"
  ON public.document_signature_seals
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Comentarios
COMMENT ON TABLE public.document_signature_seals IS
  'Registro de sellos de firma aplicados a documentos en DOCUBOX';
COMMENT ON COLUMN public.document_signature_seals.document_id IS
  'ID del documento firmado';
COMMENT ON COLUMN public.document_signature_seals.folio IS
  'Folio único DOCUBOX del sello';
COMMENT ON COLUMN public.document_signature_seals.original_hash IS
  'Hash SHA-256 del documento original antes del sellado';
COMMENT ON COLUMN public.document_signature_seals.sealed_hash IS
  'Hash SHA-256 del documento después del sellado';
COMMENT ON COLUMN public.document_signature_seals.crypto_signature_applied IS
  'Indica si se aplicó firma criptográfica PKCS#7/PAdES al documento';
COMMENT ON COLUMN public.document_signature_seals.signature_subfilter IS
  'Subfilter de la firma PAdES, ej: ETSI.CAdES.detached';
COMMENT ON COLUMN public.document_signature_seals.certificate_cn IS
  'Common Name del certificado X.509 usado para firmar';
COMMENT ON COLUMN public.document_signature_seals.certificate_org IS
  'Organización del certificado X.509 usado para firmar';
COMMENT ON COLUMN public.document_signature_seals.certificate_country IS
  'País del certificado X.509 usado para firmar';
