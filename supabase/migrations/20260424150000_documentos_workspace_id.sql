-- =============================================================================
-- MIGRACIÓN: documentos_workspace_id
-- 1. Agrega workspace_id a la tabla documentos
-- 2. Crea workspace personal para usuarios que no tienen uno
-- 3. Actualiza documentos existentes con el workspace_id del propietario
-- =============================================================================

-- ── 1. Agregar columna workspace_id a documentos ─────────────────────────────
ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL;

-- Índice para búsquedas por workspace
CREATE INDEX IF NOT EXISTS idx_documentos_workspace_id
  ON public.documentos (workspace_id);

-- ── 2. Crear workspace personal para usuarios sin workspace ───────────────────
DO $$
DECLARE
  rec RECORD;
  new_workspace_id UUID;
BEGIN
  -- Iterar sobre usuarios que NO tienen ningún workspace asociado
  FOR rec IN
    SELECT up.id, up.full_name, up.email
    FROM public.user_profiles up
    WHERE NOT EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.user_id = up.id
    )
  LOOP
    new_workspace_id := gen_random_uuid();

    INSERT INTO public.workspaces (id, name, workspace_type, owner_id, description, created_at, updated_at)
    VALUES (
      new_workspace_id,
      COALESCE(NULLIF(rec.full_name, ''), split_part(rec.email, '@', 1)) || '''s Workspace',
      'personal'::public.workspace_type,
      rec.id,
      'Espacio de trabajo personal',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.workspace_members (id, workspace_id, user_id, role, joined_at)
    VALUES (
      gen_random_uuid(),
      new_workspace_id,
      rec.id,
      'owner'::public.workspace_member_role,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (workspace_id, user_id) DO NOTHING;

    RAISE NOTICE 'Workspace personal creado para usuario % (workspace_id: %)', rec.email, new_workspace_id;
  END LOOP;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error creando workspaces para usuarios sin workspace: %', SQLERRM;
END $$;

-- ── 3. Actualizar documentos existentes con workspace_id del propietario ──────
DO $$
BEGIN
  -- Asignar el workspace personal del owner a cada documento que no tenga workspace_id
  UPDATE public.documentos d
  SET workspace_id = (
    SELECT w.id
    FROM public.workspaces w
    INNER JOIN public.workspace_members wm ON wm.workspace_id = w.id
    WHERE wm.user_id = d.owner_id
      AND w.workspace_type = 'personal'
    ORDER BY w.created_at ASC
    LIMIT 1
  )
  WHERE d.workspace_id IS NULL;

  RAISE NOTICE 'Documentos existentes actualizados con workspace_id del propietario.';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error actualizando workspace_id en documentos: %', SQLERRM;
END $$;
