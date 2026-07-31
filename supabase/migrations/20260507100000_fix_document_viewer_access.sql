-- =============================================================================
-- MIGRACIÓN: fix_document_viewer_access
-- Plataforma: DOCUBOX
-- Corrige el acceso al visor de documentos para participantes:
--   1. Refuerza la política SELECT de documentos para propietarios y participantes
--   2. Corrige la función can_read_document_storage para usar el UUID del documento
--   3. Amplía la política de document_metadata para incluir participantes
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PARTE 1: Función auxiliar para verificar si el usuario es participante
-- (SECURITY DEFINER para evitar recursión en RLS)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_email()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT email FROM auth.users WHERE id = auth.uid() LIMIT 1;
$$;

-- Función para verificar si el usuario actual puede leer un documento
CREATE OR REPLACE FUNCTION public.can_read_documento(p_documento_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_user_email TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  v_user_email := public.current_user_email();

  RETURN EXISTS (
    SELECT 1
    FROM public.documentos d
    WHERE d.id = p_documento_id
      AND (
        -- Es el propietario
        d.owner_id = v_user_id
        OR
        -- Es participante por email
        (v_user_email IS NOT NULL AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(d.participantes, '[]'::jsonb)) AS p
          WHERE p->>'email' = v_user_email
        ))
        OR
        -- Es participante por UUID
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
-- PARTE 2: Política RLS para documentos - SELECT para propietarios y participantes
-- ---------------------------------------------------------------------------

-- Eliminar políticas existentes de SELECT en documentos
DROP POLICY IF EXISTS "participants_can_read_documentos" ON public.documentos;
DROP POLICY IF EXISTS "users_manage_own_documentos" ON public.documentos;

-- Política ALL para el propietario (INSERT, UPDATE, DELETE + SELECT)
CREATE POLICY "owner_manage_documentos"
  ON public.documentos
  FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Política SELECT separada para participantes (por email o por UUID)
CREATE POLICY "participants_can_select_documentos"
  ON public.documentos
  FOR SELECT
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR (
      public.current_user_email() IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(participantes, '[]'::jsonb)) AS p
        WHERE p->>'email' = public.current_user_email()
      )
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(participantes, '[]'::jsonb)) AS p
      WHERE (p->>'id')::uuid = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- PARTE 3: Corregir función can_read_document_storage
-- El path en storage es: {workspace_id}/{document_uuid}/{filename}
-- El segundo segmento es el UUID del documento (d.id), NO el documento_id textual
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
  v_user_email TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  v_user_email := public.current_user_email();

  -- El path es: {workspace_id}/{document_uuid}/{filename}
  -- Extraemos el segundo segmento como document UUID
  v_document_id := split_part(object_name, '/', 2);

  IF v_document_id IS NULL OR v_document_id = '' THEN
    RETURN FALSE;
  END IF;

  -- Verificar si el usuario es propietario O participante
  RETURN EXISTS (
    SELECT 1
    FROM public.documentos d
    WHERE (
      -- Comparar con UUID (d.id) - formato principal del path
      d.id::TEXT = v_document_id
      OR
      -- Comparar con documento_id textual como fallback
      d.documento_id = v_document_id
    )
    AND (
      -- Es el propietario
      d.owner_id = v_user_id
      OR
      -- Es participante por email
      (v_user_email IS NOT NULL AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(d.participantes, '[]'::jsonb)) AS p
        WHERE p->>'email' = v_user_email
      ))
      OR
      -- Es participante por UUID
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(d.participantes, '[]'::jsonb)) AS p
        WHERE (p->>'id')::uuid = v_user_id
      )
    )
  );
END;
$$;

-- Recrear política de lectura en storage con la función corregida
DROP POLICY IF EXISTS "owner_or_participant_read_documents" ON storage.objects;
CREATE POLICY "owner_or_participant_read_documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'documents'
  AND public.can_read_document_storage(name)
);

-- ---------------------------------------------------------------------------
-- PARTE 4: Ampliar política de document_metadata para participantes
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "owner_can_read_metadata" ON public.document_metadata;
CREATE POLICY "owner_or_participant_can_read_metadata"
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
    OR
    -- Participante por email vía tabla documentos
    EXISTS (
      SELECT 1 FROM public.documentos doc
      WHERE doc.id = document_metadata.documentos_id
        AND public.current_user_email() IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(doc.participantes, '[]'::jsonb)) AS p
          WHERE p->>'email' = public.current_user_email()
        )
    )
    OR
    -- Participante por UUID vía tabla documentos
    EXISTS (
      SELECT 1 FROM public.documentos doc
      WHERE doc.id = document_metadata.documentos_id
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(doc.participantes, '[]'::jsonb)) AS p
          WHERE (p->>'id')::uuid = auth.uid()
        )
    )
  );

-- Índice GIN para acelerar búsquedas en participantes JSONB (si no existe)
CREATE INDEX IF NOT EXISTS idx_documentos_participantes_gin
  ON public.documentos USING GIN (participantes);
