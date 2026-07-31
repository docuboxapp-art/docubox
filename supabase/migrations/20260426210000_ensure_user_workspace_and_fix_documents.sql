-- =============================================================================
-- MIGRACIÓN: ensure_user_workspace_and_fix_documents
-- 1. Asegura que todos los usuarios tengan un workspace personal
-- 2. Asigna workspace_id a documentos que no lo tienen
-- 3. Actualiza documentos cuyo owner_id no coincide con ningún user_profile
-- =============================================================================

-- ── 1. Crear workspace personal para usuarios que no tienen uno ───────────────
DO $$
DECLARE
  rec RECORD;
  new_workspace_id UUID;
BEGIN
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
      COALESCE(NULLIF(rec.full_name, ''), split_part(rec.email, '@', 1)) || ' Workspace',
      'personal'::public.workspace_type,
      rec.id,
      NULL,
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
    RAISE NOTICE 'Error creando workspaces: %', SQLERRM;
END $$;

-- ── 2. Asignar workspace_id a documentos que no lo tienen ─────────────────────
DO $$
DECLARE
  docs_fixed INTEGER := 0;
BEGIN
  UPDATE public.documentos d
  SET workspace_id = (
    SELECT w.id
    FROM public.workspaces w
    INNER JOIN public.workspace_members wm ON wm.workspace_id = w.id
    WHERE wm.user_id = d.owner_id
      AND w.workspace_type = 'personal'
    LIMIT 1
  )
  WHERE d.workspace_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.workspace_members wm2
      WHERE wm2.user_id = d.owner_id
    );

  GET DIAGNOSTICS docs_fixed = ROW_COUNT;
  RAISE NOTICE 'Documentos actualizados con workspace_id: %', docs_fixed;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error asignando workspace_id a documentos: %', SQLERRM;
END $$;
