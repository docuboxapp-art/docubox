-- Legal Hold changes are privileged server-side lifecycle operations.
-- Browser-originated updates cannot activate, release or alter their evidence.

CREATE OR REPLACE FUNCTION public.enforce_document_legal_hold_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  is_service_role BOOLEAN := COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role';
BEGIN
  IF NOT is_service_role AND (
    NEW.legal_hold IS DISTINCT FROM OLD.legal_hold
    OR NEW.legal_hold_status IS DISTINCT FROM OLD.legal_hold_status
    OR NEW.legal_hold_reason IS DISTINCT FROM OLD.legal_hold_reason
    OR NEW.legal_hold_created_at IS DISTINCT FROM OLD.legal_hold_created_at
    OR NEW.legal_hold_created_by IS DISTINCT FROM OLD.legal_hold_created_by
    OR NEW.legal_hold_released_at IS DISTINCT FROM OLD.legal_hold_released_at
    OR NEW.legal_hold_released_by IS DISTINCT FROM OLD.legal_hold_released_by
    OR NEW.legal_hold_release_reason IS DISTINCT FROM OLD.legal_hold_release_reason
  ) THEN
    RAISE EXCEPTION 'LEGAL_HOLD_SERVER_SIDE_REQUIRED';
  END IF;

  IF NEW.legal_hold_status = 'ACTIVE' AND (
    NEW.legal_hold IS DISTINCT FROM TRUE
    OR NULLIF(BTRIM(COALESCE(NEW.legal_hold_reason, '')), '') IS NULL
    OR NEW.legal_hold_created_at IS NULL
    OR NEW.legal_hold_created_by IS NULL
  ) THEN
    RAISE EXCEPTION 'LEGAL_HOLD_REASON_REQUIRED';
  END IF;

  IF OLD.legal_hold_status = 'ACTIVE' AND NEW.legal_hold_status = 'RELEASED' AND (
    NEW.legal_hold IS DISTINCT FROM FALSE
    OR NULLIF(BTRIM(COALESCE(NEW.legal_hold_release_reason, '')), '') IS NULL
    OR NEW.legal_hold_released_at IS NULL
    OR NEW.legal_hold_released_by IS NULL
  ) THEN
    RAISE EXCEPTION 'LEGAL_HOLD_RELEASE_REASON_REQUIRED';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS documentos_enforce_legal_hold_transition ON public.documentos;
CREATE TRIGGER documentos_enforce_legal_hold_transition
  BEFORE UPDATE OF legal_hold, legal_hold_status, legal_hold_reason,
    legal_hold_created_at, legal_hold_created_by,
    legal_hold_released_at, legal_hold_released_by, legal_hold_release_reason
  ON public.documentos
  FOR EACH ROW EXECUTE FUNCTION public.enforce_document_legal_hold_transition();
