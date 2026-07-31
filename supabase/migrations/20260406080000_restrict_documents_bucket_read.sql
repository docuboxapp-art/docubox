-- =============================================================================
-- MIGRACIÓN: restrict_documents_bucket_read
-- Restringe la política de lectura del bucket 'documents' para que solo el
-- propietario del documento y los participantes registrados puedan leer el archivo.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- FUNCIÓN: can_read_document_storage
-- Verifica si el usuario actual (auth.uid()) tiene acceso de lectura al archivo
-- en el bucket 'documents'. El path tiene el formato: {workspace_id}/{document_id}/{filename}
-- Acceso permitido si:
--   1. El usuario es el owner_id del documento en la tabla documentos, O
--   2. El usuario aparece como participante en documentos.participantes (JSONB array con {id, ...})
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_read_document_storage(object_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_document_id TEXT;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- El path es: {workspace_id}/{document_id}/{filename}
  -- Extraemos el segundo segmento como document_id
  v_document_id := split_part(object_name, '/', 2);

  IF v_document_id IS NULL OR v_document_id = '' THEN
    RETURN FALSE;
  END IF;

  -- Verificar si el usuario es propietario O participante registrado
  RETURN EXISTS (
    SELECT 1
    FROM public.documentos d
    WHERE d.documento_id = v_document_id
      AND (
        -- Es el propietario del documento
        d.owner_id = v_user_id
        OR
        -- Es un participante registrado (JSONB array de objetos con campo "id")
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(d.participantes, '[]'::jsonb)) AS p
          WHERE (p->>'id')::uuid = v_user_id
        )
      )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- POLÍTICA DE LECTURA RESTRICTIVA
-- Reemplaza la política anterior que permitía a cualquier usuario autenticado
-- leer cualquier archivo del bucket.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "authenticated_read_documents" ON storage.objects;
CREATE POLICY "owner_or_participant_read_documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'documents'
  AND public.can_read_document_storage(name)
);
