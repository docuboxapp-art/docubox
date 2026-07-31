-- =============================================================================
-- MIGRACIÓN: owner_only_update_delete_and_metadata_fix
-- Plataforma: DOCUBOX
-- =============================================================================
--
-- 1. Restringe UPDATE y DELETE en storage.objects para que solo el propietario
--    del documento pueda modificar/eliminar sus archivos.
-- 2. Agrega columna documentos_id en document_metadata para vincular con la
--    tabla documentos (flujo /crear-documento), además del FK existente a documents.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PARTE 1: Restricción UPDATE/DELETE en storage.objects al propietario
-- ---------------------------------------------------------------------------

-- Función que verifica si el usuario actual es propietario del documento
-- basándose en el path del archivo (workspaceId/documentId/filename)
CREATE OR REPLACE FUNCTION public.is_storage_document_owner(file_path TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  doc_id TEXT;
BEGIN
  -- El path tiene formato: {workspaceId}/{documentId}/{filename}
  -- Extraemos el segundo segmento como documentId
  doc_id := split_part(file_path, '/', 2);

  IF doc_id IS NULL OR doc_id = '' THEN
    RETURN FALSE;
  END IF;

  -- Verificar en tabla documentos (flujo /crear-documento)
  IF EXISTS (
    SELECT 1 FROM public.documentos d
    WHERE d.id::TEXT = doc_id
      AND d.owner_id = auth.uid()
  ) THEN
    RETURN TRUE;
  END IF;

  -- Verificar en tabla documents (flujo legal/compliance)
  IF EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id::TEXT = doc_id
      AND d.owner_id = auth.uid()
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- Reemplazar política UPDATE: solo el propietario puede actualizar sus archivos
DROP POLICY IF EXISTS "authenticated_update_documents" ON storage.objects;
DROP POLICY IF EXISTS "owner_only_update_documents" ON storage.objects;
CREATE POLICY "owner_only_update_documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'documents'
  AND public.is_storage_document_owner(name)
)
WITH CHECK (
  bucket_id = 'documents'
  AND public.is_storage_document_owner(name)
);

-- Reemplazar política DELETE: solo el propietario puede eliminar sus archivos
DROP POLICY IF EXISTS "authenticated_delete_documents" ON storage.objects;
DROP POLICY IF EXISTS "owner_only_delete_documents" ON storage.objects;
CREATE POLICY "owner_only_delete_documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'documents'
  AND public.is_storage_document_owner(name)
);

-- ---------------------------------------------------------------------------
-- PARTE 2: Vincular document_metadata con tabla documentos
-- ---------------------------------------------------------------------------

-- Agregar columna documentos_id (nullable) para el flujo /crear-documento
ALTER TABLE public.document_metadata
ADD COLUMN IF NOT EXISTS documentos_id UUID REFERENCES public.documentos(id) ON DELETE CASCADE;

-- Índice UNIQUE en documentos_id para relación 1-a-1 y soporte de upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_metadata_documentos_id_unique
  ON public.document_metadata (documentos_id)
  WHERE documentos_id IS NOT NULL;

-- Índice para búsqueda por documentos_id
CREATE INDEX IF NOT EXISTS idx_document_metadata_documentos_id
  ON public.document_metadata (documentos_id);

-- Actualizar política SELECT para permitir lectura también por documentos_id
DROP POLICY IF EXISTS "owner_can_read_metadata" ON public.document_metadata;
CREATE POLICY "owner_can_read_metadata"
  ON public.document_metadata
  FOR SELECT
  USING (
    -- Propietario vía tabla documents (flujo legal)
    EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_metadata.document_id
        AND d.owner_id = auth.uid()
    )
    OR
    -- Propietario vía tabla documentos (flujo /crear-documento)
    EXISTS (
      SELECT 1 FROM public.documentos doc
      WHERE doc.id = document_metadata.documentos_id
        AND doc.owner_id = auth.uid()
    )
  );

-- Política INSERT: service_role o authenticated (para el flujo /crear-documento vía API route)
DROP POLICY IF EXISTS "service_role_can_insert_metadata" ON public.document_metadata;
CREATE POLICY "service_role_can_insert_metadata"
  ON public.document_metadata
  FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR auth.role() = 'authenticated'
  );

-- Política UPDATE: service_role o authenticated
DROP POLICY IF EXISTS "service_role_can_update_metadata" ON public.document_metadata;
CREATE POLICY "service_role_can_update_metadata"
  ON public.document_metadata
  FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR auth.role() = 'authenticated'
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR auth.role() = 'authenticated'
  );
