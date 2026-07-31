-- ============================================================
-- XML Evidence Generation Queue + Trigger
-- ============================================================

-- 1. Add XML evidence columns to documents table
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS xml_evidencia_path TEXT,
  ADD COLUMN IF NOT EXISTS xml_hash_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS xml_generated_at TIMESTAMPTZ;

-- 2. Create xml_generation_queue table
CREATE TABLE IF NOT EXISTS public.xml_generation_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed')),
  attempts INT NOT NULL DEFAULT 0,
  error_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_xml_queue_document_id ON public.xml_generation_queue(document_id);
CREATE INDEX IF NOT EXISTS idx_xml_queue_status ON public.xml_generation_queue(status);
CREATE INDEX IF NOT EXISTS idx_xml_queue_status_attempts ON public.xml_generation_queue(status, attempts);

ALTER TABLE public.xml_generation_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "xml_queue_service_write" ON public.xml_generation_queue;
CREATE POLICY "xml_queue_service_write" ON public.xml_generation_queue
  FOR ALL USING (auth.role() = 'service_role');

-- 3. Trigger function: enqueue when document status changes to 'completado'
CREATE OR REPLACE FUNCTION public.fn_queue_xml_generation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completado' AND OLD.status <> 'completado' THEN
    INSERT INTO public.xml_generation_queue (document_id)
    VALUES (NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_xml_generation ON public.documents;
CREATE TRIGGER trg_xml_generation
  AFTER UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.fn_queue_xml_generation();

-- 4. Supporting tables for XML evidence data (if they don't exist)

-- document_signers: stores each signer's identity and evidence
CREATE TABLE IF NOT EXISTS public.document_signers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  orden INT NOT NULL DEFAULT 1,
  tipo_firma TEXT,
  rfc TEXT,
  nombre_completo TEXT,
  rol TEXT,
  num_certificado_sat TEXT,
  certificado_cer_base64 TEXT,
  fecha_firma TIMESTAMPTZ,
  ip_address TEXT,
  pais TEXT,
  ciudad TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  user_agent TEXT,
  os_detectado TEXT,
  tipo_dispositivo TEXT,
  huella_navegador TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_signers_document_id ON public.document_signers(document_id);
ALTER TABLE public.document_signers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "document_signers_service_write" ON public.document_signers;
CREATE POLICY "document_signers_service_write" ON public.document_signers
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "document_signers_owner_read" ON public.document_signers;
CREATE POLICY "document_signers_owner_read" ON public.document_signers
  FOR SELECT USING (
    document_id IN (
      SELECT id FROM public.documents WHERE owner_id = auth.uid()
    )
  );

-- document_signatures: cryptographic signature data per signer
CREATE TABLE IF NOT EXISTS public.document_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signer_id UUID NOT NULL REFERENCES public.document_signers(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  firma_xmldsig_base64 TEXT,
  sello_tiempo_nom151_base64 TEXT,
  psc_nombre TEXT,
  psc_folio TEXT,
  psc_fecha_utc TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_signatures_signer_id ON public.document_signatures(signer_id);
CREATE INDEX IF NOT EXISTS idx_document_signatures_document_id ON public.document_signatures(document_id);
ALTER TABLE public.document_signatures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "document_signatures_service_write" ON public.document_signatures;
CREATE POLICY "document_signatures_service_write" ON public.document_signatures
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "document_signatures_owner_read" ON public.document_signatures;
CREATE POLICY "document_signatures_owner_read" ON public.document_signatures
  FOR SELECT USING (
    document_id IN (
      SELECT id FROM public.documents WHERE owner_id = auth.uid()
    )
  );

-- document_conservation: NOM-151 global conservation record
CREATE TABLE IF NOT EXISTS public.document_conservation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  psc_nombre TEXT,
  psc_folio TEXT,
  sello_base64 TEXT,
  fecha_utc TIMESTAMPTZ,
  url_verificacion TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_conservation_document_id ON public.document_conservation(document_id);
ALTER TABLE public.document_conservation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "document_conservation_service_write" ON public.document_conservation;
CREATE POLICY "document_conservation_service_write" ON public.document_conservation
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "document_conservation_owner_read" ON public.document_conservation;
CREATE POLICY "document_conservation_owner_read" ON public.document_conservation
  FOR SELECT USING (
    document_id IN (
      SELECT id FROM public.documents WHERE owner_id = auth.uid()
    )
  );
