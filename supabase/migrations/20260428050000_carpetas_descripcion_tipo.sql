-- Add descripcion and tipo_documento_id columns to carpetas table
ALTER TABLE public.carpetas
ADD COLUMN IF NOT EXISTS descripcion TEXT,
ADD COLUMN IF NOT EXISTS tipo_documento_id UUID REFERENCES public.tipo_documento(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_carpetas_tipo_documento_id ON public.carpetas(tipo_documento_id);
