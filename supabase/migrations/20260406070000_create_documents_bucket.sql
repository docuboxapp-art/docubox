-- Crear bucket 'documents' en Supabase Storage para almacenar documentos subidos
-- Este bucket es privado y requiere autenticación para acceder

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  false,
  52428800, -- 50 MB en bytes
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- RLS: Habilitar seguridad a nivel de fila para el bucket
-- Los usuarios solo pueden acceder a sus propios archivos (organizados por workspace_id/document_id/)

-- Policy: Los usuarios autenticados pueden subir archivos a su propio workspace
DROP POLICY IF EXISTS "authenticated_upload_documents" ON storage.objects;
CREATE POLICY "authenticated_upload_documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'documents');

-- Policy: Los usuarios autenticados pueden leer archivos del bucket
DROP POLICY IF EXISTS "authenticated_read_documents" ON storage.objects;
CREATE POLICY "authenticated_read_documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'documents');

-- Policy: Los usuarios autenticados pueden actualizar sus propios archivos
DROP POLICY IF EXISTS "authenticated_update_documents" ON storage.objects;
CREATE POLICY "authenticated_update_documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'documents');

-- Policy: Los usuarios autenticados pueden eliminar sus propios archivos
DROP POLICY IF EXISTS "authenticated_delete_documents" ON storage.objects;
CREATE POLICY "authenticated_delete_documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'documents');
