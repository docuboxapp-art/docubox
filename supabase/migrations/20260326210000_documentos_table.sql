-- ─── Documentos Table ────────────────────────────────────────────────────────
-- Stores documents created via /crear-documento with SHA-256 hash and all form config

CREATE TABLE IF NOT EXISTS public.documentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id TEXT NOT NULL UNIQUE, -- human-readable doc ID e.g. DOC-2026-XXXX
  owner_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,

  -- File info
  file_name TEXT NOT NULL,
  file_size BIGINT,
  file_type TEXT,
  file_hash_sha256 TEXT NOT NULL, -- SHA-256 hash of the file content

  -- Propiedades del documento (right panel)
  nombre TEXT NOT NULL,
  descripcion TEXT,
  numero_oficio TEXT, -- optional field "Número de oficio / documento"
  grupo_tipo_documento_id UUID REFERENCES public.grupo_tipo_documento(id) ON DELETE SET NULL,
  tipo_documento_id UUID REFERENCES public.tipo_documento(id) ON DELETE SET NULL,
  ruta_guardado TEXT DEFAULT 'raiz', -- folder path / id
  etiquetas_ids UUID[] DEFAULT '{}',

  -- Configuración general (tab: formerly "Propiedades del documento" in left panel)
  es_urgente BOOLEAN DEFAULT false,
  es_publico BOOLEAN DEFAULT false,

  -- Configuración de seguridad y protección (tab: formerly "Establecer protección y seguridad")
  tiene_vencimiento BOOLEAN DEFAULT false,
  fecha_vencimiento TIMESTAMPTZ,
  tiene_codigo_acceso BOOLEAN DEFAULT false,
  codigo_acceso_hash TEXT,
  proteccion_firmado BOOLEAN DEFAULT false,
  legal_hold BOOLEAN DEFAULT false,

  -- Status
  estado TEXT DEFAULT 'borrador',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ─── Carpetas Table ───────────────────────────────────────────────────────────
-- Folder structure for mis-documentos, linked to user

CREATE TABLE IF NOT EXISTS public.carpetas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  parent_id UUID REFERENCES public.carpetas(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_documentos_owner_id ON public.documentos(owner_id);
CREATE INDEX IF NOT EXISTS idx_documentos_documento_id ON public.documentos(documento_id);
CREATE INDEX IF NOT EXISTS idx_documentos_grupo_tipo ON public.documentos(grupo_tipo_documento_id);
CREATE INDEX IF NOT EXISTS idx_documentos_tipo ON public.documentos(tipo_documento_id);
CREATE INDEX IF NOT EXISTS idx_carpetas_owner_id ON public.carpetas(owner_id);
CREATE INDEX IF NOT EXISTS idx_carpetas_parent_id ON public.carpetas(parent_id);

-- ─── Updated_at trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS documentos_updated_at ON public.documentos;
CREATE TRIGGER documentos_updated_at
  BEFORE UPDATE ON public.documentos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS carpetas_updated_at ON public.carpetas;
CREATE TRIGGER carpetas_updated_at
  BEFORE UPDATE ON public.carpetas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carpetas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_documentos" ON public.documentos;
CREATE POLICY "users_manage_own_documentos"
  ON public.documentos FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "users_manage_own_carpetas" ON public.carpetas;
CREATE POLICY "users_manage_own_carpetas"
  ON public.carpetas FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Public read for grupo_tipo_documento and tipo_documento (catalog tables)
DROP POLICY IF EXISTS "public_read_grupo_tipo_documento" ON public.grupo_tipo_documento;
CREATE POLICY "public_read_grupo_tipo_documento"
  ON public.grupo_tipo_documento FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "public_read_tipo_documento" ON public.tipo_documento;
CREATE POLICY "public_read_tipo_documento"
  ON public.tipo_documento FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "public_read_etiquetas" ON public.etiquetas;
CREATE POLICY "public_read_etiquetas"
  ON public.etiquetas FOR SELECT TO authenticated
  USING (true);

-- ─── Seed default carpetas for existing users ─────────────────────────────────
DO $$
DECLARE
  existing_user_id UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_profiles'
  ) THEN
    SELECT id INTO existing_user_id FROM public.user_profiles LIMIT 1;
    IF existing_user_id IS NOT NULL THEN
      INSERT INTO public.carpetas (id, owner_id, nombre, parent_id)
      VALUES
        (gen_random_uuid(), existing_user_id, 'Contratos', NULL),
        (gen_random_uuid(), existing_user_id, 'Facturas', NULL),
        (gen_random_uuid(), existing_user_id, 'Proyectos', NULL)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Seed carpetas failed: %', SQLERRM;
END $$;
