-- Pin the trigger function lookup path so runtime behavior cannot be changed
-- through objects created in another schema.
ALTER FUNCTION public.freeze_pdf_native_protection_after_start()
  SET search_path = '';
