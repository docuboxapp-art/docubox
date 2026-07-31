-- ============================================================
-- Automation Rules Module
-- Trigger system for auto-escalation, deadline notifications,
-- prerequisite blocking, and signature retry tasks.
-- NOTE: document_chunks (ai_document_chunks) and ai_conversations
-- (lucia_sessions/lucia_messages) already exist — not duplicated.
-- ============================================================

-- ── ENUM: automation trigger type ──────────────────────────────────────────
DROP TYPE IF EXISTS public.automation_trigger_type CASCADE;
CREATE TYPE public.automation_trigger_type AS ENUM (
  'tarea_vencida',
  'firma_fallida',
  'prerequisito_incompleto',
  'plazo_proximo',
  'estado_cambiado',
  'tarea_creada',
  'tarea_completada',
  'documento_rechazado'
);

-- ── ENUM: automation action type ───────────────────────────────────────────
DROP TYPE IF EXISTS public.automation_action_type CASCADE;
CREATE TYPE public.automation_action_type AS ENUM (
  'escalar_tarea',
  'notificar_firmante',
  'bloquear_operacion',
  'generar_tarea_reintento',
  'enviar_recordatorio',
  'cambiar_estado',
  'asignar_responsable',
  'crear_tarea'
);

-- ── TABLE: automation_rules ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.automation_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by       uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  nombre           text NOT NULL,
  descripcion      text,
  activa           boolean NOT NULL DEFAULT true,
  trigger_type     public.automation_trigger_type NOT NULL,
  trigger_config   jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_type      public.automation_action_type NOT NULL,
  action_config    jsonb NOT NULL DEFAULT '{}'::jsonb,
  condiciones      jsonb DEFAULT '[]'::jsonb,
  prioridad        integer NOT NULL DEFAULT 0,
  ejecutada_count  integer NOT NULL DEFAULT 0,
  ultima_ejecucion timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS automation_rules_workspace_id_idx
  ON public.automation_rules (workspace_id);

CREATE INDEX IF NOT EXISTS automation_rules_trigger_type_idx
  ON public.automation_rules (trigger_type);

CREATE INDEX IF NOT EXISTS automation_rules_activa_idx
  ON public.automation_rules (activa);

-- ── TABLE: automation_executions (audit log) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.automation_executions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id        uuid NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  tarea_id       uuid,
  documento_id   uuid,
  resultado      text NOT NULL DEFAULT 'ok',
  detalle        jsonb DEFAULT '{}'::jsonb,
  ejecutado_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS automation_executions_rule_id_idx
  ON public.automation_executions (rule_id);

CREATE INDEX IF NOT EXISTS automation_executions_workspace_id_idx
  ON public.automation_executions (workspace_id);

CREATE INDEX IF NOT EXISTS automation_executions_ejecutado_at_idx
  ON public.automation_executions (ejecutado_at DESC);

-- ── updated_at trigger ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_automation_rules_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_automation_rules_updated_at ON public.automation_rules;
CREATE TRIGGER trg_automation_rules_updated_at
  BEFORE UPDATE ON public.automation_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.set_automation_rules_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_executions ENABLE ROW LEVEL SECURITY;

-- automation_rules: workspace members can read; only creators/admins can write
DROP POLICY IF EXISTS "automation_rules_workspace_read" ON public.automation_rules;
CREATE POLICY "automation_rules_workspace_read"
  ON public.automation_rules
  FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "automation_rules_creator_insert" ON public.automation_rules;
CREATE POLICY "automation_rules_creator_insert"
  ON public.automation_rules
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "automation_rules_creator_update" ON public.automation_rules;
CREATE POLICY "automation_rules_creator_update"
  ON public.automation_rules
  FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid()
    AND workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    AND workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "automation_rules_creator_delete" ON public.automation_rules;
CREATE POLICY "automation_rules_creator_delete"
  ON public.automation_rules
  FOR DELETE
  TO authenticated
  USING (
    created_by = auth.uid()
    AND workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

-- automation_executions: workspace members read only
DROP POLICY IF EXISTS "automation_executions_workspace_read" ON public.automation_executions;
CREATE POLICY "automation_executions_workspace_read"
  ON public.automation_executions
  FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "automation_executions_service_all" ON public.automation_executions;
CREATE POLICY "automation_executions_service_all"
  ON public.automation_executions
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── Seed default automation rules for existing workspaces ───────────────────
DO $$
DECLARE
  ws_id   uuid;
  usr_id  uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'workspaces'
  ) THEN
    SELECT id INTO ws_id FROM public.workspaces LIMIT 1;
    SELECT id INTO usr_id FROM public.user_profiles LIMIT 1;

    IF ws_id IS NOT NULL AND usr_id IS NOT NULL THEN
      INSERT INTO public.automation_rules
        (workspace_id, created_by, nombre, descripcion, trigger_type, action_type, trigger_config, action_config, prioridad)
      VALUES
        (ws_id, usr_id,
         'Escalado automático por vencimiento',
         'Si una tarea vence sin completarse, escalarla al supervisor del workspace.',
         'tarea_vencida', 'escalar_tarea',
         '{"horas_gracia": 0}'::jsonb,
         '{"notificar_supervisor": true}'::jsonb,
         10),
        (ws_id, usr_id,
         'Notificar firmante próximo a vencer',
         'Enviar recordatorio al firmante 24 horas antes del vencimiento.',
         'plazo_proximo', 'notificar_firmante',
         '{"horas_antes": 24}'::jsonb,
         '{"canal": "email"}'::jsonb,
         20),
        (ws_id, usr_id,
         'Bloquear firma si falta anexo',
         'Impedir el avance a firma si hay tareas de tipo subir_anexo pendientes.',
         'prerequisito_incompleto', 'bloquear_operacion',
         '{"tipo_prerequisito": "subir_anexo"}'::jsonb,
         '{"mensaje": "Completa los anexos requeridos antes de firmar."}'::jsonb,
         30),
        (ws_id, usr_id,
         'Reintento tras fallo de firma',
         'Generar una nueva tarea de firma cuando una firma electrónica falla.',
         'firma_fallida', 'generar_tarea_reintento',
         '{"max_reintentos": 3}'::jsonb,
         '{"tipo_tarea": "firmar_documento", "prioridad": "alta"}'::jsonb,
         40),
        (ws_id, usr_id,
         'Bloqueo por identidad no validada',
         'Impedir la firma si la validación de identidad del participante está pendiente.',
         'prerequisito_incompleto', 'bloquear_operacion',
         '{"tipo_prerequisito": "validar_identidad"}'::jsonb,
         '{"mensaje": "Valida tu identidad antes de continuar."}'::jsonb,
         50)
      ON CONFLICT (id) DO NOTHING;
    END IF;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Seed automation_rules failed: %', SQLERRM;
END $$;
