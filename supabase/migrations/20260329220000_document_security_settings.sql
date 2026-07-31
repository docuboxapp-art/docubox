-- Document Security Settings Table
CREATE TABLE IF NOT EXISTS public.document_security_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id TEXT NOT NULL,
  owner_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,

  -- Vencimiento
  vencimiento_enabled BOOLEAN DEFAULT false,
  fecha_vencimiento DATE,
  recordatorio_frecuencia TEXT,

  -- Código de acceso
  codigo_acceso_enabled BOOLEAN DEFAULT false,
  codigo_acceso TEXT,

  -- Protección adicional a documento firmado
  proteccion_adicional_enabled BOOLEAN DEFAULT false,
  impedir_impresion BOOLEAN DEFAULT false,
  evitar_copia_texto BOOLEAN DEFAULT false,
  impedir_modificacion BOOLEAN DEFAULT false,
  impedir_extraccion BOOLEAN DEFAULT false,
  evitar_montaje BOOLEAN DEFAULT false,

  -- Legal Hold
  legal_hold_enabled BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_document_security_settings_doc_owner UNIQUE (documento_id, owner_id)
);

CREATE INDEX IF NOT EXISTS idx_document_security_settings_documento_id
  ON public.document_security_settings(documento_id);

CREATE INDEX IF NOT EXISTS idx_document_security_settings_owner_id
  ON public.document_security_settings(owner_id);

ALTER TABLE public.document_security_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_document_security_settings" ON public.document_security_settings;
CREATE POLICY "users_manage_own_document_security_settings"
  ON public.document_security_settings
  FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_document_security_settings_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_document_security_settings_updated_at ON public.document_security_settings;
CREATE TRIGGER trg_document_security_settings_updated_at
  BEFORE UPDATE ON public.document_security_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_document_security_settings_updated_at();
