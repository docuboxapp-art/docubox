-- =============================================================================
-- MIGRACIÓN: fix_documentos_sin_workspace
-- Corrige documentos que no tienen workspace_id asignado:
-- 1. Crea workspace personal para usuarios que aún no tienen uno
-- 2. Asigna el workspace personal del owner a cada documento sin workspace_id
-- =============================================================================

-- ── 1. Crear workspace personal para usuarios sin workspace ───────────────────
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
    RAISE NOTICE 'Error creando workspaces: %', SQLERRM;
END $$;

-- ── 2. Asignar workspace_id a documentos que no lo tienen ─────────────────────
DO $$
DECLARE
  docs_fixed INTEGER := 0;
  docs_orphan INTEGER := 0;
BEGIN
  -- Contar documentos sin workspace_id antes de la corrección
  SELECT COUNT(*) INTO docs_orphan
  FROM public.documentos
  WHERE workspace_id IS NULL;

  RAISE NOTICE 'Documentos sin workspace_id encontrados: %', docs_orphan;

  -- Asignar el workspace personal del owner a cada documento sin workspace_id
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

  GET DIAGNOSTICS docs_fixed = ROW_COUNT;
  RAISE NOTICE 'Documentos corregidos con workspace_id: %', docs_fixed;

  -- Reportar documentos que aún no tienen workspace_id (owner sin workspace)
  SELECT COUNT(*) INTO docs_orphan
  FROM public.documentos
  WHERE workspace_id IS NULL;

  IF docs_orphan > 0 THEN
    RAISE NOTICE 'ADVERTENCIA: % documentos aún sin workspace_id (owner sin workspace personal)', docs_orphan;
  ELSE
    RAISE NOTICE 'Todos los documentos tienen workspace_id asignado correctamente.';
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error asignando workspace_id a documentos: %', SQLERRM;
END $$;
