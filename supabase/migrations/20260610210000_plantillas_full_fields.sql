-- Plantillas Full Fields Migration
-- Adds all missing columns to support the complete template module

-- Add missing columns to plantillas table
ALTER TABLE public.plantillas
  ADD COLUMN IF NOT EXISTS numero_oficio TEXT,
  ADD COLUMN IF NOT EXISTS area_responsable TEXT,
  ADD COLUMN IF NOT EXISTS tipo_plantilla TEXT,
  ADD COLUMN IF NOT EXISTS etiquetas_ids JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tipo_documento_id UUID REFERENCES public.tipo_documento(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS grupo_tipo_id UUID REFERENCES public.grupo_tipo_documento(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hoja_tamano TEXT DEFAULT 'Carta (Letter)',
  ADD COLUMN IF NOT EXISTS hoja_orientacion TEXT DEFAULT 'vertical',
  ADD COLUMN IF NOT EXISTS contenido_html TEXT,
  ADD COLUMN IF NOT EXISTS campos_insertados JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS publicacion_opcion TEXT DEFAULT 'borrador',
  ADD COLUMN IF NOT EXISTS comentario_publicacion TEXT,
  ADD COLUMN IF NOT EXISTS estado_plantilla TEXT DEFAULT 'Borrador',
  ADD COLUMN IF NOT EXISTS version_publicada TEXT DEFAULT '1.0';

-- Rename existing columns to match new naming convention (only if old names exist)
DO $$
BEGIN
  -- Rename 'name' to 'nombre' if 'nombre' doesn't exist yet
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plantillas' AND column_name = 'name'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plantillas' AND column_name = 'nombre'
  ) THEN
    ALTER TABLE public.plantillas RENAME COLUMN name TO nombre;
  END IF;

  -- Rename 'description' to 'descripcion' if 'descripcion' doesn't exist yet
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plantillas' AND column_name = 'description'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plantillas' AND column_name = 'descripcion'
  ) THEN
    ALTER TABLE public.plantillas RENAME COLUMN description TO descripcion;
  END IF;

  -- Rename 'status' to 'estado' if 'estado' doesn't exist yet
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plantillas' AND column_name = 'status'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plantillas' AND column_name = 'estado'
  ) THEN
    ALTER TABLE public.plantillas RENAME COLUMN status TO estado;
  END IF;
END $$;

-- Add indexes for new foreign key columns
CREATE INDEX IF NOT EXISTS idx_plantillas_tipo_documento_id ON public.plantillas(tipo_documento_id);
CREATE INDEX IF NOT EXISTS idx_plantillas_grupo_tipo_id ON public.plantillas(grupo_tipo_id);

-- Ensure RLS is still enabled
ALTER TABLE public.plantillas ENABLE ROW LEVEL SECURITY;

-- Recreate RLS policy to ensure it covers all operations
DROP POLICY IF EXISTS "users_manage_own_plantillas" ON public.plantillas;
CREATE POLICY "users_manage_own_plantillas"
ON public.plantillas
FOR ALL
TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());
