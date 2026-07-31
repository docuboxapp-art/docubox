-- Migration: Set initial participation status to 'en_revision' for all participants
-- Context: Previously participants had no sub_estado (defaulting to 'sin_revisar' in the UI).
-- Now all participants start with 'en_revision' as their initial participation state.
-- Terminal states (firmo, rechazo, aprobo, cancelo) are preserved.

-- ── 1. Backfill: update participants with no sub_estado to 'en_revision' ──────
UPDATE public.documentos
SET participantes = (
  SELECT jsonb_agg(
    CASE
      -- Only set 'en_revision' if sub_estado is missing or is 'sin_revisar'
      -- Preserve all terminal states
      WHEN (elem->>'sub_estado') IS NULL
        OR (elem->>'sub_estado') = ''
        OR (elem->>'sub_estado') = 'sin_revisar'
        THEN jsonb_set(elem, '{sub_estado}', '"en_revision"')
      ELSE elem
    END
  )
  FROM jsonb_array_elements(COALESCE(participantes, '[]'::jsonb)) AS elem
)
WHERE participantes IS NOT NULL
  AND jsonb_array_length(COALESCE(participantes, '[]'::jsonb)) > 0
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(participantes, '[]'::jsonb)) AS elem
    WHERE (elem->>'sub_estado') IS NULL
       OR (elem->>'sub_estado') = ''
       OR (elem->>'sub_estado') = 'sin_revisar'
  );

-- ── 2. Replace update_participante_sub_estado to protect terminal states ──────
CREATE OR REPLACE FUNCTION public.update_participante_sub_estado(
  p_documento_id UUID,
  p_email        TEXT,
  p_sub_estado   TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  terminal_states TEXT[] := ARRAY['firmo', 'firmado', 'rechazo', 'rechazado', 'aprobo', 'aprobado', 'cancelo', 'cancelado'];
BEGIN
  UPDATE public.documentos
  SET participantes = (
    SELECT jsonb_agg(
      CASE
        WHEN (elem->>'email') = p_email
          -- Only update if current state is NOT a terminal state
          AND NOT ((elem->>'sub_estado') = ANY(terminal_states))
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
