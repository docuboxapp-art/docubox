-- Phase D enriches a participation response immediately after the atomic
-- completion function commits it. Keep the signed payload immutable while
-- allowing the server to attach only delegation/witness actor metadata.
CREATE OR REPLACE FUNCTION public.protect_committed_participation_response()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_server_metadata_columns CONSTANT TEXT[] := ARRAY[
    'effective_actor_user_id',
    'delegation_id',
    'witness_completed',
    'witness_completed_at',
    'tipo_participacion'
  ];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.operational_committed_at IS NOT NULL THEN
      RAISE EXCEPTION 'COMMITTED_PARTICIPATION_RESPONSE_IMMUTABLE' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.operational_committed_at IS NOT NULL THEN
    IF current_user = 'service_role'
       AND (to_jsonb(NEW) - v_server_metadata_columns)
           = (to_jsonb(OLD) - v_server_metadata_columns) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'COMMITTED_PARTICIPATION_RESPONSE_IMMUTABLE' USING ERRCODE = '55000';
  END IF;

  IF current_user <> 'service_role'
     AND (
       NEW.participant_reference_id IS DISTINCT FROM CASE WHEN TG_OP = 'UPDATE' THEN OLD.participant_reference_id ELSE NULL END
       OR NEW.completion_attempt_id IS DISTINCT FROM CASE WHEN TG_OP = 'UPDATE' THEN OLD.completion_attempt_id ELSE NULL END
       OR NEW.operational_committed_at IS DISTINCT FROM CASE WHEN TG_OP = 'UPDATE' THEN OLD.operational_committed_at ELSE NULL END
       OR NEW.signature_evidence_id IS DISTINCT FROM CASE WHEN TG_OP = 'UPDATE' THEN OLD.signature_evidence_id ELSE NULL END
       OR NEW.document_version_id IS DISTINCT FROM CASE WHEN TG_OP = 'UPDATE' THEN OLD.document_version_id ELSE NULL END
       OR NEW.firma_completada IS DISTINCT FROM CASE WHEN TG_OP = 'UPDATE' THEN OLD.firma_completada ELSE false END
       OR NEW.firma_completada_at IS DISTINCT FROM CASE WHEN TG_OP = 'UPDATE' THEN OLD.firma_completada_at ELSE NULL END
       OR NEW.aprobacion_completada IS DISTINCT FROM CASE WHEN TG_OP = 'UPDATE' THEN OLD.aprobacion_completada ELSE false END
       OR NEW.aprobacion_completada_at IS DISTINCT FROM CASE WHEN TG_OP = 'UPDATE' THEN OLD.aprobacion_completada_at ELSE NULL END
     ) THEN
    RAISE EXCEPTION 'PARTICIPATION_COMPLETION_SERVER_ONLY' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_committed_participation_response()
  FROM PUBLIC, anon, authenticated;
