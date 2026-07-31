-- Sub-estados for participants stored in documentos.participantes JSONB array
-- Sub-estados for "En proceso" documents:
--   sin_revisar    → participant has not opened the viewer yet (default)
--   en_revision    → participant opened the viewer
--   en_participando → participant clicked "Participar" in the viewer
--
-- NOTE: There is no separate documentos_participantes table.
-- Participants are stored as a JSONB array in documentos.participantes.
-- sub_estado is managed as a key within each participant object in that array.
-- No schema change is required — JSONB columns accept arbitrary keys.

-- Helper function: update sub_estado for a specific participant (by email) in a document
CREATE OR REPLACE FUNCTION public.update_participante_sub_estado(
  p_documento_id UUID,
  p_email        TEXT,
  p_sub_estado   TEXT
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
          THEN jsonb_set(elem, '{sub_estado}', to_jsonb(p_sub_estado))
        ELSE elem
      END
    )
    FROM jsonb_array_elements(COALESCE(participantes, '[]'::jsonb)) AS elem
  )
  WHERE id = p_documento_id;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.update_participante_sub_estado(UUID, TEXT, TEXT) TO authenticated;
