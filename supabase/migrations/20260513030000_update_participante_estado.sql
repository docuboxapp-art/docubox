-- Migration: Add RPC to update the 'estado' field of a participant in documentos.participantes JSONB
-- This allows marking a participant's estado as 'firmado' when they submit their signature.

CREATE OR REPLACE FUNCTION public.update_participante_estado(
  p_documento_id UUID,
  p_email        TEXT,
  p_estado       TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.documentos
  SET participantes = (
    SELECT jsonb_agg(
      CASE
        WHEN (elem->>'email') = p_email
          THEN jsonb_set(elem, '{estado}', to_jsonb(p_estado))
        ELSE elem
      END
    )
    FROM jsonb_array_elements(COALESCE(participantes, '[]'::jsonb)) AS elem
  )
  WHERE id = p_documento_id;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.update_participante_estado(UUID, TEXT, TEXT) TO authenticated;
