-- Add grupo_tipo_documento_id column to carpetas table
ALTER TABLE public.carpetas
ADD COLUMN IF NOT EXISTS grupo_tipo_documento_id UUID REFERENCES public.grupo_tipo_documento(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_carpetas_grupo_tipo_documento_id ON public.carpetas(grupo_tipo_documento_id);
