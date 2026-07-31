-- =============================================================================
-- MIGRATION: backfill_participant_user_ids
-- Plataforma: DOCUBOX
-- Backfills user_id in documentos.participantes JSONB for registered users.
-- This allows the mis-participaciones API to find documents by user_id
-- in addition to email, fixing the issue where participants don't see
-- their assigned documents.
-- =============================================================================

-- Function to backfill user_id in participantes JSONB array
-- Matches participants by email to auth.users and sets user_id
CREATE OR REPLACE FUNCTION public.backfill_participantes_user_ids()
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
  LOOP
    v_updated_parts := '[]'::jsonb;
    
    FOR v_part IN SELECT * FROM jsonb_array_elements(v_doc.participantes)
    LOOP
      -- Only update if user_id is missing and email is present
      IF (v_part->>'user_id') IS NULL AND (v_part->>'email') IS NOT NULL THEN
        -- Look up the user by email
        SELECT au.id INTO v_user_id
        FROM auth.users au
        WHERE lower(au.email) = lower(v_part->>'email')
        LIMIT 1;
        
        IF v_user_id IS NOT NULL THEN
          v_part := jsonb_set(v_part, '{user_id}', to_jsonb(v_user_id::text));
          v_count := v_count + 1;
        END IF;
      END IF;
      
      v_updated_parts := v_updated_parts || jsonb_build_array(v_part);
    END LOOP;
    
    -- Only update if we made changes
    IF v_updated_parts != v_doc.participantes THEN
      UPDATE public.documentos
      SET participantes = v_updated_parts
      WHERE id = v_doc.id;
    END IF;
  END LOOP;
  
  RETURN v_count;
END;
$$;

-- Run the backfill
DO $$
DECLARE
  v_updated INTEGER;
BEGIN
  SELECT public.backfill_participantes_user_ids() INTO v_updated;
  RAISE NOTICE 'Backfilled user_id for % participant entries', v_updated;
END $$;

-- Create a trigger to auto-set user_id when a document is created/updated
-- This ensures future documents always have user_id set for registered participants
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
    -- Only update if user_id is missing and email is present
    IF (v_part->>'user_id') IS NULL AND (v_part->>'email') IS NOT NULL THEN
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

-- Drop and recreate trigger
DROP TRIGGER IF EXISTS trg_auto_set_participant_user_ids ON public.documentos;
CREATE TRIGGER trg_auto_set_participant_user_ids
  BEFORE INSERT OR UPDATE OF participantes
  ON public.documentos
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_set_participant_user_ids();
