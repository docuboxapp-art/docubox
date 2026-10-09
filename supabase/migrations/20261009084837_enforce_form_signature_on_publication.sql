CREATE OR REPLACE FUNCTION public.require_form_signature_on_publication()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'published' AND (
    jsonb_typeof(NEW.schema) IS DISTINCT FROM 'array'
    OR NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(NEW.schema) = 'array' THEN NEW.schema ELSE '[]'::jsonb END
      ) AS field
      WHERE field->>'type' = 'signature_block'
        AND COALESCE((field->>'required')::boolean, true)
    )
  ) THEN
    RAISE EXCEPTION 'A required signature field is necessary to publish a form'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_require_form_signature_on_publication ON public.form_templates;
CREATE TRIGGER trg_require_form_signature_on_publication
  BEFORE INSERT OR UPDATE OF status, schema ON public.form_templates
  FOR EACH ROW EXECUTE FUNCTION public.require_form_signature_on_publication();
