-- PDF-native restrictions are part of the immutable source that is later
-- protected and signed. They may be configured in a draft, but not changed
-- after the signature workflow has started.
CREATE OR REPLACE FUNCTION public.freeze_pdf_native_protection_after_start()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.estado IS DISTINCT FROM 'borrador'
    AND (
      NEW.proteccion_firmado IS DISTINCT FROM OLD.proteccion_firmado
      OR NEW.impedir_impresion IS DISTINCT FROM OLD.impedir_impresion
      OR NEW.evitar_copia_texto IS DISTINCT FROM OLD.evitar_copia_texto
      OR NEW.impedir_modificacion IS DISTINCT FROM OLD.impedir_modificacion
      OR NEW.impedir_extraccion IS DISTINCT FROM OLD.impedir_extraccion
      OR NEW.evitar_montaje IS DISTINCT FROM OLD.evitar_montaje
    ) THEN
    RAISE EXCEPTION 'PDF_NATIVE_PROTECTION_POLICY_FROZEN'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_documentos_freeze_pdf_native_protection ON public.documentos;
CREATE TRIGGER trg_documentos_freeze_pdf_native_protection
  BEFORE UPDATE ON public.documentos
  FOR EACH ROW
  EXECUTE FUNCTION public.freeze_pdf_native_protection_after_start();
