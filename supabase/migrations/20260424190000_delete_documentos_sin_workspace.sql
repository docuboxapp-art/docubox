-- =============================================================================
-- MIGRACIÓN: delete_documentos_sin_workspace
-- Elimina todos los documentos que no tienen workspace_id asignado.
-- =============================================================================

DO $$
DECLARE
  docs_count INTEGER := 0;
  docs_deleted INTEGER := 0;
BEGIN
  -- Contar documentos sin workspace_id antes de eliminar
  SELECT COUNT(*) INTO docs_count
  FROM public.documentos
  WHERE workspace_id IS NULL;

  RAISE NOTICE 'Documentos sin workspace_id encontrados: %', docs_count;

  IF docs_count = 0 THEN
    RAISE NOTICE 'No hay documentos sin workspace_id. Nada que eliminar.';
  ELSE
    -- Eliminar documentos sin workspace_id
    DELETE FROM public.documentos
    WHERE workspace_id IS NULL;

    GET DIAGNOSTICS docs_deleted = ROW_COUNT;
    RAISE NOTICE 'Documentos eliminados: %', docs_deleted;
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error al eliminar documentos sin workspace_id: %', SQLERRM;
END $$;
