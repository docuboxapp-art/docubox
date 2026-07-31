-- Tabla de contactos del usuario.
-- Cuando el usuario registra a un participante como contacto, se guarda aquí.
-- Vinculado al usuario que lo registró.

CREATE TABLE IF NOT EXISTS public.contacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  nombre            TEXT NOT NULL,
  apellido_paterno  TEXT,
  apellido_materno  TEXT,
  email             TEXT,
  telefono          TEXT,
  rfc               TEXT,
  curp              TEXT,
  notas             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.contacts IS 'Contactos registrados por el usuario desde participantes de documentos.';

CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON public.contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON public.contacts(email);

-- Unique: un usuario no puede tener el mismo email dos veces
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_user_email ON public.contacts(user_id, email) WHERE email IS NOT NULL;

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contacts_manage_own" ON public.contacts;
CREATE POLICY "contacts_manage_own"
  ON public.contacts
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION public.update_contacts_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_updated_at_trigger ON public.contacts;
CREATE TRIGGER contacts_updated_at_trigger
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_contacts_updated_at();

SELECT 'contacts table created' AS status
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'contacts'
);
