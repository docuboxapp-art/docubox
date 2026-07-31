-- ─── Document Draft Progress & Enhanced Security ─────────────────────────────
-- Adds columns to documentos for: wizard step progress, security sub-options,
-- general config options (sello digital, estampa, metadatos), participant messages

-- Add ultimo_paso (wizard step persistence)
ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS ultimo_paso INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS participation_order TEXT,
  ADD COLUMN IF NOT EXISTS participant_mode TEXT;

-- Security sub-options (proteccion adicional)
ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS impedir_impresion BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS evitar_copia_texto BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS impedir_modificacion BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS impedir_extraccion BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS evitar_montaje BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS recordatorio_frecuencia TEXT,
  ADD COLUMN IF NOT EXISTS codigo_acceso TEXT;

-- General config new options
ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS sello_digital BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS estampa_autenticacion BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS metadatos_adicionales BOOLEAN DEFAULT false;

-- Participant custom messages stored per participant in participantes jsonb
-- (already exists as jsonb column, messages stored inside each participant object)

-- Index for draft queries
CREATE INDEX IF NOT EXISTS idx_documentos_estado ON public.documentos(estado);
CREATE INDEX IF NOT EXISTS idx_documentos_owner_estado ON public.documentos(owner_id, estado);
