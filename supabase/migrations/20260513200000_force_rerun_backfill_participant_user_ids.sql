-- =============================================================================
-- MIGRATION: force_rerun_backfill_participant_user_ids
-- Re-runs the backfill to ensure ALL registered participants have user_id set
-- in the documentos.participantes JSONB array.
-- This fixes the issue where imssjose24@gmail.com and other registered users
-- don't see their assigned documents in /mis-participaciones and dashboard.
-- =============================================================================

-- Re-run the backfill unconditionally (update ALL entries, not just missing ones)
CREATE OR REPLACE FUNCTION public.force_backfill_participantes_user_ids()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_doc RECORD;
  v_updated_parts JSONB;
  v_part JSONB;
  v_user_id UUID;
  v_count INTEGER := 0;
BEGIN
  FOR v_doc IN
    SELECT id, participantes
    FROM public.documentos
    WHERE participantes IS NOT NULL
      AND jsonb_array_length(COALESCE(participantes, '[]'::jsonb)) > 0
      AND deleted_at IS NULL
  LOOP
    v_updated_parts := '[]'::jsonb;
    
    FOR v_part IN SELECT * FROM jsonb_array_elements(v_doc.participantes)
    LOOP
      -- Update if email is present (always re-lookup to fix any stale/wrong user_id)
      IF (v_part->>'email') IS NOT NULL AND (v_part->>'email') != '' THEN
        SELECT au.id INTO v_user_id
        FROM auth.users au
        WHERE lower(au.email) = lower(v_part->>'email')
        LIMIT 1;
        
        IF v_user_id IS NOT NULL THEN
          -- Always set/overwrite user_id to ensure it's correct
          v_part := jsonb_set(v_part, '{user_id}', to_jsonb(v_user_id::text));
          v_count := v_count + 1;
        END IF;
      END IF;
      
      v_updated_parts := v_updated_parts || jsonb_build_array(v_part);
    END LOOP;
    
    -- Always update to ensure consistency
    UPDATE public.documentos
    SET participantes = v_updated_parts
    WHERE id = v_doc.id;
  END LOOP;
  
  RETURN v_count;
END;
$$;

-- Execute the force backfill
DO $$
DECLARE
  v_updated INTEGER;
BEGIN
  SELECT public.force_backfill_participantes_user_ids() INTO v_updated;
  RAISE NOTICE 'Force-backfilled user_id for % participant entries', v_updated;
END $$;

-- Ensure the trigger is still in place for future documents
CREATE OR REPLACE FUNCTION public.auto_set_participant_user_ids()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated_parts JSONB;
  v_part JSONB;
  v_user_id UUID;
BEGIN
  IF NEW.participantes IS NULL OR jsonb_array_length(COALESCE(NEW.participantes, '[]'::jsonb)) = 0 THEN
    RETURN NEW;
  END IF;
  
  v_updated_parts := '[]'::jsonb;
  
  FOR v_part IN SELECT * FROM jsonb_array_elements(NEW.participantes)
  LOOP
    IF (v_part->>'email') IS NOT NULL AND (v_part->>'email') != '' THEN
      SELECT au.id INTO v_user_id
      FROM auth.users au
      WHERE lower(au.email) = lower(v_part->>'email')
      LIMIT 1;
      
      IF v_user_id IS NOT NULL THEN
        v_part := jsonb_set(v_part, '{user_id}', to_jsonb(v_user_id::text));
      END IF;
    END IF;
    
    v_updated_parts := v_updated_parts || jsonb_build_array(v_part);
  END LOOP;
  
  NEW.participantes := v_updated_parts;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_set_participant_user_ids ON public.documentos;
CREATE TRIGGER trg_auto_set_participant_user_ids
  BEFORE INSERT OR UPDATE OF participantes
  ON public.documentos
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_set_participant_user_ids();
