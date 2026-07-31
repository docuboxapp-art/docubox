-- ─── Notifications In-App Table ──────────────────────────────────────────────
-- Tabla para notificaciones internas de la plataforma Docubox
-- Conecta con todos los flujos clave: envío, firma, completado, vencimiento, cancelación

CREATE TABLE IF NOT EXISTS public.notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  type          TEXT NOT NULL DEFAULT 'info',
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  priority      TEXT NOT NULL DEFAULT 'media',
  read          BOOLEAN NOT NULL DEFAULT false,
  metadata      JSONB DEFAULT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON public.notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "users_manage_own_notifications" ON public.notifications;
CREATE POLICY "users_manage_own_notifications"
ON public.notifications
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Allow service role to insert notifications on behalf of users (for server-side flows)
DROP POLICY IF EXISTS "service_role_insert_notifications" ON public.notifications;
CREATE POLICY "service_role_insert_notifications"
ON public.notifications
FOR INSERT
TO service_role
WITH CHECK (true);
