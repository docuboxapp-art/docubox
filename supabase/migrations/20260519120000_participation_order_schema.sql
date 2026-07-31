-- =============================================================================
-- MIGRACIÓN: participation_order_schema
-- Plataforma: DOCUBOX
-- Agrega campos para el esquema de orden de participación (paralelo, secuencial, mixto)
-- en la tabla documentos, y una función para avanzar la cadena de notificaciones.
-- =============================================================================

-- 1. Agregar columnas de orden de participación a documentos
ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS participation_order TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS grupos_firma JSONB DEFAULT NULL;

-- participation_order: 'paralelo' | 'secuencial' | 'mixto' | 'condicional' | null
-- grupos_firma: array de grupos para modo mixto
--   [{ id, nombre, tipo: 'paralelo'|'secuencial', participantIds: [...] }]

-- 2. Índice para búsquedas por orden de participación
CREATE INDEX IF NOT EXISTS idx_documentos_participation_order
  ON public.documentos(participation_order)
  WHERE participation_order IS NOT NULL;

-- 3. Función: obtener el siguiente grupo/participantes a notificar en modo secuencial/mixto
--    Retorna un array de emails de participantes que deben recibir notificación ahora.
CREATE OR REPLACE FUNCTION public.get_next_participants_to_notify(
  p_documento_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_doc RECORD;
  v_participation_order TEXT;
  v_participantes JSONB;
  v_grupos JSONB;
  v_result JSONB := '[]'::JSONB;
  v_participant JSONB;
  v_grupo JSONB;
  v_grupo_participantes JSONB;
  v_grupo_tipo TEXT;
  v_all_terminal BOOLEAN;
  v_terminal_states TEXT[] := ARRAY['firmo','firmado','aprobo','aprobado','rechazo','rechazado','cancelo','cancelado'];
  v_active_states TEXT[] := ARRAY['sin_revisar','en_revision','en_participando','notificado'];
  v_participant_sub TEXT;
  v_participant_email TEXT;
  v_participant_id TEXT;
  v_found_active_group BOOLEAN := FALSE;
BEGIN
  -- Obtener documento
  SELECT participation_order, participantes, grupos_firma
  INTO v_participation_order, v_participantes, v_grupos
  FROM public.documentos
  WHERE id = p_documento_id;

  IF v_participantes IS NULL THEN
    RETURN '[]'::JSONB;
  END IF;

  -- PARALELO: todos los participantes son elegibles
  IF v_participation_order = 'paralelo' OR v_participation_order IS NULL THEN
    SELECT jsonb_agg(p)
    INTO v_result
    FROM jsonb_array_elements(v_participantes) AS p
    WHERE NOT (p->>'isCurrentUser')::BOOLEAN IS TRUE
      AND NOT (p->>'sub_estado' = ANY(v_terminal_states));
    RETURN COALESCE(v_result, '[]'::JSONB);
  END IF;

  -- SECUENCIAL: encontrar el primer participante sin estado terminal
  IF v_participation_order = 'secuencial' THEN
    FOR v_participant IN SELECT * FROM jsonb_array_elements(v_participantes)
    LOOP
      v_participant_sub := COALESCE(v_participant->>'sub_estado', 'sin_revisar');
      -- Saltar al dueño del documento
      IF (v_participant->>'isCurrentUser')::BOOLEAN IS TRUE THEN
        CONTINUE;
      END IF;
      -- Si este participante no ha terminado, es el siguiente
      IF NOT (v_participant_sub = ANY(v_terminal_states)) THEN
        v_result := jsonb_build_array(v_participant);
        RETURN v_result;
      END IF;
    END LOOP;
    RETURN '[]'::JSONB;
  END IF;

  -- MIXTO: procesar grupos en orden
  IF v_participation_order = 'mixto' AND v_grupos IS NOT NULL THEN
    FOR v_grupo IN SELECT * FROM jsonb_array_elements(v_grupos)
    LOOP
      v_grupo_tipo := COALESCE(v_grupo->>'tipo', 'paralelo');
      v_grupo_participantes := COALESCE(v_grupo->'participantIds', '[]'::JSONB);

      -- Verificar si este grupo ya completó (todos en estado terminal)
      v_all_terminal := TRUE;
      FOR v_participant_id IN SELECT jsonb_array_elements_text(v_grupo_participantes)
      LOOP
        -- Buscar el participante en el array de participantes
        SELECT p->>'sub_estado'
        INTO v_participant_sub
        FROM jsonb_array_elements(v_participantes) AS p
        WHERE p->>'id' = v_participant_id
        LIMIT 1;

        IF v_participant_sub IS NULL OR NOT (COALESCE(v_participant_sub, 'sin_revisar') = ANY(v_terminal_states)) THEN
          v_all_terminal := FALSE;
          EXIT;
        END IF;
      END LOOP;

      -- Si el grupo no completó, este es el grupo activo
      IF NOT v_all_terminal THEN
        v_found_active_group := TRUE;

        IF v_grupo_tipo = 'paralelo' THEN
          -- Retornar todos los participantes del grupo que no han terminado
          SELECT jsonb_agg(p)
          INTO v_result
          FROM jsonb_array_elements(v_participantes) AS p
          WHERE p->>'id' = ANY(
            SELECT jsonb_array_elements_text(v_grupo_participantes)
          )
          AND NOT (COALESCE(p->>'sub_estado', 'sin_revisar') = ANY(v_terminal_states))
          AND NOT (p->>'isCurrentUser')::BOOLEAN IS TRUE;
          RETURN COALESCE(v_result, '[]'::JSONB);

        ELSIF v_grupo_tipo = 'secuencial' THEN
          -- Retornar el primer participante del grupo que no ha terminado
          FOR v_participant_id IN SELECT jsonb_array_elements_text(v_grupo_participantes)
          LOOP
            SELECT p
            INTO v_participant
            FROM jsonb_array_elements(v_participantes) AS p
            WHERE p->>'id' = v_participant_id
            LIMIT 1;

            IF v_participant IS NOT NULL THEN
              v_participant_sub := COALESCE(v_participant->>'sub_estado', 'sin_revisar');
              IF NOT (v_participant_sub = ANY(v_terminal_states))
                AND NOT (v_participant->>'isCurrentUser')::BOOLEAN IS TRUE THEN
                RETURN jsonb_build_array(v_participant);
              END IF;
            END IF;
          END LOOP;
          RETURN '[]'::JSONB;
        END IF;

        EXIT; -- Salir del loop de grupos una vez encontrado el grupo activo
      END IF;
    END LOOP;

    RETURN '[]'::JSONB;
  END IF;

  -- Fallback: retornar todos
  SELECT jsonb_agg(p)
  INTO v_result
  FROM jsonb_array_elements(v_participantes) AS p
  WHERE NOT (p->>'isCurrentUser')::BOOLEAN IS TRUE;
  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$;

-- 4. Función: marcar participantes como visibles/notificados según el orden
--    Actualiza el campo 'visible' y 'notificado' en el JSONB de participantes
CREATE OR REPLACE FUNCTION public.set_participants_visible(
  p_documento_id UUID,
  p_participant_ids TEXT[]
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
        WHEN (elem->>'id') = ANY(p_participant_ids)
          OR (elem->>'email') = ANY(p_participant_ids)
          THEN jsonb_set(
                jsonb_set(elem, '{visible}', 'true'::jsonb),
                '{notificado}', 'true'::jsonb
               )
        ELSE elem
      END
    )
    FROM jsonb_array_elements(COALESCE(participantes, '[]'::jsonb)) AS elem
  )
  WHERE id = p_documento_id;
END;
$$;

-- 5. Permisos
GRANT EXECUTE ON FUNCTION public.get_next_participants_to_notify(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_participants_to_notify(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_participants_visible(UUID, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_participants_visible(UUID, TEXT[]) TO service_role;
