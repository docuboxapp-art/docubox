-- Signature is a property of every form. Liveness is selected for each launch.
ALTER TABLE public.form_templates
  ALTER COLUMN requires_signature SET DEFAULT true;

ALTER TABLE public.form_tokens
  ADD COLUMN IF NOT EXISTS require_liveness boolean NOT NULL DEFAULT false;

ALTER TABLE public.signature_requests
  ADD COLUMN IF NOT EXISTS require_liveness boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.form_tokens.require_liveness IS
  'Whether the recipient was asked for proof of life when this form was launched.';
COMMENT ON COLUMN public.signature_requests.require_liveness IS
  'Proof-of-life requirement selected for this signing request.';

CREATE OR REPLACE FUNCTION public.sync_form_template_schemas()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.settings := COALESCE(NEW.settings, '{}'::jsonb) || '{"requiresSignature":true}'::jsonb;
  NEW.form_schema := jsonb_build_object(
    'version', 1,
    'sections', COALESCE(NEW.settings->'sections', '[]'::jsonb),
    'fields', COALESCE(NEW.schema, '[]'::jsonb)
  );
  NEW.pdf_schema := COALESCE(NEW.settings->'pdfSchema', '{}'::jsonb);
  NEW.requires_signature := true;
  NEW.allowed_signature_types := CASE
    WHEN jsonb_typeof(NEW.settings->'allowedSignatureTypes') = 'array'
      AND jsonb_array_length(NEW.settings->'allowedSignatureTypes') > 0
    THEN ARRAY(SELECT jsonb_array_elements_text(NEW.settings->'allowedSignatureTypes'))
    ELSE ARRAY['click_sign', 'autografa_digital', 'efirma_sat']::text[]
  END;
  RETURN NEW;
END;
$$;
