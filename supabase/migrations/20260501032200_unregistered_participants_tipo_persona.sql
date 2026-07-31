-- Add tipo_persona and denominacion_razon_social columns to unregistered_participants
-- tipo_persona: 'fisica' | 'moral'
-- denominacion_razon_social: only relevant when tipo_persona = 'moral'

ALTER TABLE public.unregistered_participants
ADD COLUMN IF NOT EXISTS tipo_persona TEXT DEFAULT 'fisica',
ADD COLUMN IF NOT EXISTS denominacion_razon_social TEXT;

COMMENT ON COLUMN public.unregistered_participants.tipo_persona IS 'Tipo de persona: fisica o moral.';
COMMENT ON COLUMN public.unregistered_participants.denominacion_razon_social IS 'Denominación o razón social (solo aplica para persona moral).';
