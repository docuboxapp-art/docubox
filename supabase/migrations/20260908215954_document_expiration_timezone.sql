ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS fecha_vencimiento_timezone TEXT;

COMMENT ON COLUMN public.documentos.fecha_vencimiento_timezone IS
  'Zona horaria IANA seleccionada por el creador al definir fecha_vencimiento. El instante canónico se guarda en UTC en fecha_vencimiento.';
