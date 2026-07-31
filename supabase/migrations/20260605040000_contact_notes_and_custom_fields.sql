-- Contact Notes: per-contact notes with author and timestamp
-- Contact Custom Fields: per-contact key-value custom fields

-- ── contact_notes ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contact_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_notes_contact_id ON public.contact_notes(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_notes_user_id    ON public.contact_notes(user_id);

ALTER TABLE public.contact_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contact_notes_manage_own" ON public.contact_notes;
CREATE POLICY "contact_notes_manage_own"
  ON public.contact_notes
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── contact_custom_fields ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contact_custom_fields (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  field_name  TEXT NOT NULL,
  field_value TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_custom_fields_contact_id ON public.contact_custom_fields(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_custom_fields_user_id    ON public.contact_custom_fields(user_id);

ALTER TABLE public.contact_custom_fields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contact_custom_fields_manage_own" ON public.contact_custom_fields;
CREATE POLICY "contact_custom_fields_manage_own"
  ON public.contact_custom_fields
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Trigger to update updated_at on contact_custom_fields
CREATE OR REPLACE FUNCTION public.update_contact_custom_fields_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contact_custom_fields_updated_at_trigger ON public.contact_custom_fields;
CREATE TRIGGER contact_custom_fields_updated_at_trigger
  BEFORE UPDATE ON public.contact_custom_fields
  FOR EACH ROW
  EXECUTE FUNCTION public.update_contact_custom_fields_updated_at();

-- Also add extra profile columns to contacts if not present
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS tipo_persona TEXT DEFAULT 'Persona física',
  ADD COLUMN IF NOT EXISTS empresa TEXT,
  ADD COLUMN IF NOT EXISTS cargo TEXT,
  ADD COLUMN IF NOT EXISTS direccion TEXT,
  ADD COLUMN IF NOT EXISTS canal_preferido TEXT DEFAULT 'WhatsApp',
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
