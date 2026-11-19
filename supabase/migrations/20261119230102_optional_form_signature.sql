-- Only an explicit boolean false disables signatures. Existing published rows are untouched.
CREATE OR REPLACE FUNCTION public.sync_form_template_schemas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.requires_signature := (NEW.settings->'requiresSignature') IS DISTINCT FROM 'false'::jsonb;
  NEW.settings := COALESCE(NEW.settings, '{}'::jsonb)
    || jsonb_build_object('requiresSignature', NEW.requires_signature);
  NEW.form_schema := jsonb_build_object(
    'version', 1,
    'sections', COALESCE(NEW.settings->'sections', '[]'::jsonb),
    'fields', COALESCE(NEW.schema, '[]'::jsonb)
  );
  NEW.pdf_schema := COALESCE(NEW.settings->'pdfSchema', '{}'::jsonb);
  NEW.allowed_signature_types := CASE
    WHEN jsonb_typeof(NEW.settings->'allowedSignatureTypes') = 'array'
      AND jsonb_array_length(NEW.settings->'allowedSignatureTypes') > 0
    THEN ARRAY(SELECT jsonb_array_elements_text(NEW.settings->'allowedSignatureTypes'))
    ELSE ARRAY['click_sign', 'autografa_digital', 'efirma_sat']::text[]
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.require_form_signature_on_publication()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'published'
    AND (NEW.settings->'requiresSignature') IS DISTINCT FROM 'false'::jsonb
    AND (
      jsonb_typeof(NEW.schema) IS DISTINCT FROM 'array'
      OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(NEW.schema) = 'array' THEN NEW.schema ELSE '[]'::jsonb END
        ) AS field
        WHERE field->>'type' = 'signature_block'
          AND COALESCE((field->>'required')::boolean, true)
      )
    ) THEN
    RAISE EXCEPTION 'A required signature field is necessary when form signature is enabled'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_require_form_signature_on_publication ON public.form_templates;
CREATE TRIGGER trg_require_form_signature_on_publication
  BEFORE INSERT OR UPDATE OF status, schema, settings ON public.form_templates
  FOR EACH ROW EXECUTE FUNCTION public.require_form_signature_on_publication();
