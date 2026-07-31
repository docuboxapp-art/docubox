-- Tabla de participantes no registrados en la plataforma.
-- Cuando un usuario invita a alguien que no tiene cuenta, se guarda aquí.
-- Cuando ese participante se registra, se elimina de esta tabla y pasa a ser un usuario normal.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.unregistered_participants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invited_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  nombre            TEXT NOT NULL,
  apellido_paterno  TEXT,
  apellido_materno  TEXT,
  email             TEXT,
  telefono          TEXT,
  rfc               TEXT,
  curp              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  registered_at     TIMESTAMPTZ  -- se llena cuando el participante se registra
);

COMMENT ON TABLE public.unregistered_participants IS 'Participantes invitados que aún no tienen cuenta en la plataforma.';
COMMENT ON COLUMN public.unregistered_participants.id IS 'Identificador único del participante no registrado.';
COMMENT ON COLUMN public.unregistered_participants.workspace_id IS 'Workspace desde el que fue invitado.';
COMMENT ON COLUMN public.unregistered_participants.invited_by IS 'Usuario que realizó la invitación.';
COMMENT ON COLUMN public.unregistered_participants.nombre IS 'Nombre del participante.';
COMMENT ON COLUMN public.unregistered_participants.apellido_paterno IS 'Apellido paterno del participante.';
COMMENT ON COLUMN public.unregistered_participants.apellido_materno IS 'Apellido materno del participante.';
COMMENT ON COLUMN public.unregistered_participants.email IS 'Correo electrónico del participante.';
COMMENT ON COLUMN public.unregistered_participants.telefono IS 'Teléfono del participante.';
COMMENT ON COLUMN public.unregistered_participants.rfc IS 'RFC del participante (opcional).';
COMMENT ON COLUMN public.unregistered_participants.curp IS 'CURP del participante (opcional).';
COMMENT ON COLUMN public.unregistered_participants.created_at IS 'Fecha de creación del registro.';
COMMENT ON COLUMN public.unregistered_participants.registered_at IS 'Fecha en que el participante se registró en la plataforma. NULL si aún no se ha registrado.';

CREATE INDEX IF NOT EXISTS idx_unregistered_participants_email ON public.unregistered_participants(email);
CREATE INDEX IF NOT EXISTS idx_unregistered_participants_telefono ON public.unregistered_participants(telefono);
CREATE INDEX IF NOT EXISTS idx_unregistered_participants_workspace ON public.unregistered_participants(workspace_id);
CREATE INDEX IF NOT EXISTS idx_unregistered_participants_invited_by ON public.unregistered_participants(invited_by);

ALTER TABLE public.unregistered_participants ENABLE ROW LEVEL SECURITY;

-- Solo el service_role puede insertar
DROP POLICY IF EXISTS "unregistered_participants_insert_service" ON public.unregistered_participants;
CREATE POLICY "unregistered_participants_insert_service"
  ON public.unregistered_participants
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Los usuarios autenticados pueden ver los participantes no registrados de su workspace
DROP POLICY IF EXISTS "unregistered_participants_select_workspace" ON public.unregistered_participants;
CREATE POLICY "unregistered_participants_select_workspace"
  ON public.unregistered_participants
  FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

-- El service_role puede actualizar (para marcar registered_at cuando se registren)
DROP POLICY IF EXISTS "unregistered_participants_update_service" ON public.unregistered_participants;
CREATE POLICY "unregistered_participants_update_service"
  ON public.unregistered_participants
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- El service_role puede eliminar (cuando el participante se registra)
DROP POLICY IF EXISTS "unregistered_participants_delete_service" ON public.unregistered_participants;
CREATE POLICY "unregistered_participants_delete_service"
  ON public.unregistered_participants
  FOR DELETE
  TO service_role
  USING (true);

-- Verificación
SELECT 'unregistered_participants table created' AS status
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'unregistered_participants'
);
