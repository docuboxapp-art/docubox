-- ─── Pending Tasks Module ─────────────────────────────────────────────────────
-- Migration: 20260524030000_pending_tasks_module.sql

-- 1. ENUMs
DROP TYPE IF EXISTS public.tarea_tipo CASCADE;
CREATE TYPE public.tarea_tipo AS ENUM (
  'firmar_documento', 'revisar_documento', 'aprobar_documento',
  'subir_anexo', 'validar_identidad', 'corregir_datos',
  'resolver_comentario', 'confirmar_lectura', 'descargar_constancia',
  'validar_efirma', 'obtener_nom151', 'cerrar_expediente'
);

DROP TYPE IF EXISTS public.tarea_prioridad CASCADE;
CREATE TYPE public.tarea_prioridad AS ENUM ('critica', 'alta', 'media', 'baja');

DROP TYPE IF EXISTS public.tarea_estado CASCADE;
CREATE TYPE public.tarea_estado AS ENUM (
  'nueva', 'pendiente', 'en_proceso', 'bloqueada', 'en_revision',
  'vencida', 'escalada', 'completada', 'cancelada', 'rechazada'
);

DROP TYPE IF EXISTS public.tarea_riesgo CASCADE;
CREATE TYPE public.tarea_riesgo AS ENUM ('alto', 'medio', 'bajo');

-- 2. Core table
CREATE TABLE IF NOT EXISTS public.tareas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by          UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  assigned_to         UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  title               TEXT NOT NULL,
  description         TEXT,
  tipo                public.tarea_tipo NOT NULL,
  prioridad           public.tarea_prioridad NOT NULL DEFAULT 'media',
  estado              public.tarea_estado NOT NULL DEFAULT 'nueva',
  riesgo              public.tarea_riesgo NOT NULL DEFAULT 'bajo',
  due_date            TIMESTAMPTZ,
  sla                 TEXT,
  main_action         TEXT,
  document_name       TEXT,
  document_id         TEXT,
  expediente_id       TEXT,
  expediente_name     TEXT,
  responsible_name    TEXT,
  responsible_avatar  TEXT,
  creator_name        TEXT,
  is_overdue          BOOLEAN NOT NULL DEFAULT false,
  is_blocked          BOOLEAN NOT NULL DEFAULT false,
  is_critical         BOOLEAN NOT NULL DEFAULT false,
  tags                TEXT[] DEFAULT '{}',
  checklist           JSONB DEFAULT '[]',
  comments            JSONB DEFAULT '[]',
  activity            JSONB DEFAULT '[]',
  attachments         JSONB DEFAULT '[]',
  dependencies        JSONB DEFAULT '[]',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_tareas_workspace_id ON public.tareas(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tareas_assigned_to ON public.tareas(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tareas_created_by ON public.tareas(created_by);
CREATE INDEX IF NOT EXISTS idx_tareas_estado ON public.tareas(estado);
CREATE INDEX IF NOT EXISTS idx_tareas_due_date ON public.tareas(due_date);
CREATE INDEX IF NOT EXISTS idx_tareas_tipo ON public.tareas(tipo);

-- 4. updated_at trigger function
CREATE OR REPLACE FUNCTION public.set_tareas_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 5. Enable RLS
ALTER TABLE public.tareas ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies
DROP POLICY IF EXISTS "workspace_members_select_tareas" ON public.tareas;
CREATE POLICY "workspace_members_select_tareas"
ON public.tareas
FOR SELECT
TO authenticated
USING (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "workspace_members_insert_tareas" ON public.tareas;
CREATE POLICY "workspace_members_insert_tareas"
ON public.tareas
FOR INSERT
TO authenticated
WITH CHECK (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "workspace_members_update_tareas" ON public.tareas;
CREATE POLICY "workspace_members_update_tareas"
ON public.tareas
FOR UPDATE
TO authenticated
USING (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "workspace_members_delete_tareas" ON public.tareas;
CREATE POLICY "workspace_members_delete_tareas"
ON public.tareas
FOR DELETE
TO authenticated
USING (
  created_by = auth.uid()
);

-- 7. Trigger
DROP TRIGGER IF EXISTS tareas_updated_at ON public.tareas;
CREATE TRIGGER tareas_updated_at
  BEFORE UPDATE ON public.tareas
  FOR EACH ROW
  EXECUTE FUNCTION public.set_tareas_updated_at();

-- 8. Mock data
DO $$
DECLARE
  ws_id UUID;
  user_id UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'workspaces'
  ) THEN
    SELECT id INTO ws_id FROM public.workspaces LIMIT 1;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_profiles'
  ) THEN
    SELECT id INTO user_id FROM public.user_profiles LIMIT 1;
  END IF;

  IF ws_id IS NOT NULL AND user_id IS NOT NULL THEN
    INSERT INTO public.tareas (
      workspace_id, created_by, assigned_to, title, description, tipo, prioridad, estado, riesgo,
      due_date, sla, main_action, document_name, document_id, expediente_id, expediente_name,
      responsible_name, responsible_avatar, creator_name, is_overdue, is_blocked, is_critical,
      tags, checklist, comments, activity, attachments, dependencies
    ) VALUES
    (
      ws_id, user_id, user_id,
      'Firmar Contrato de Servicios Profesionales Q2',
      'Contrato de servicios profesionales para el segundo trimestre 2026 enviado por Corporativo Azteca S.A. Requiere firma con e.firma SAT y validacion NOM-151.',
      'firmar_documento', 'critica', 'pendiente', 'alto',
      now() + interval '1 day', '24h', 'Firmar con e.firma SAT',
      'Contrato_Servicios_Q2_2026.pdf', 'DOC-2026-0341', 'EXP-2026-089', 'Corporativo Azteca - Servicios Q2',
      'Lic. Maria Gonzalez', 'MG', 'Corporativo Azteca S.A.',
      false, false, true,
      ARRAY['e.firma SAT', 'NOM-151', 'Contrato'],
      '[{"id":"c1","text":"Revisar clausulas de confidencialidad","done":true},{"id":"c2","text":"Verificar monto y condiciones de pago","done":true},{"id":"c3","text":"Validar vigencia del contrato","done":false},{"id":"c4","text":"Confirmar datos fiscales del firmante","done":false},{"id":"c5","text":"Firmar con e.firma SAT","done":false}]'::jsonb,
      '[{"id":"cm1","author":"Lic. Maria Gonzalez","avatar":"MG","text":"El contrato fue revisado por el area legal. Pendiente de firma del representante legal.","date":"2026-05-21T10:30:00"}]'::jsonb,
      '[{"id":"a1","action":"Tarea creada por Corporativo Azteca S.A.","user":"Sistema","date":"2026-05-20T09:00:00","icon":"Plus","color":"text-blue-500"}]'::jsonb,
      '[{"id":"at1","name":"Contrato_Servicios_Q2_2026.pdf","size":"2.4 MB","type":"PDF"}]'::jsonb,
      '[]'::jsonb
    ),
    (
      ws_id, user_id, user_id,
      'Subir Acta Constitutiva - Expediente NDA StartupMX',
      'Falta el acta constitutiva de la empresa para completar el expediente de validacion de identidad. Sin este documento no se puede proceder a la firma del NDA.',
      'subir_anexo', 'alta', 'bloqueada', 'alto',
      now() - interval '1 day', '48h', 'Subir documento',
      'NDA_Colaboracion_StartupMX.pdf', 'DOC-2026-0298', 'EXP-2026-071', 'StartupMX - NDA Colaboracion',
      'Ing. Roberto Sanchez', 'RS', 'StartupMX Technologies',
      true, true, false,
      ARRAY['Anexo faltante', 'Bloqueada', 'NDA'],
      '[{"id":"c1","text":"Localizar acta constitutiva original","done":false},{"id":"c2","text":"Digitalizar en formato PDF/A","done":false},{"id":"c3","text":"Subir al expediente digital","done":false}]'::jsonb,
      '[{"id":"cm1","author":"Ing. Roberto Sanchez","avatar":"RS","text":"El area de administracion esta buscando el acta constitutiva en el archivo fisico.","date":"2026-05-20T11:00:00"}]'::jsonb,
      '[{"id":"a1","action":"Tarea creada automaticamente por falta de anexo","user":"Sistema","date":"2026-05-19T14:30:00","icon":"Zap","color":"text-amber-500"}]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb
    ),
    (
      ws_id, user_id, user_id,
      'Validar Identidad - Contrato Arrendamiento Polanco',
      'El participante Arq. Luis Herrera debe completar la validacion de identidad mediante reconocimiento facial y captura de INE antes de proceder a la firma del contrato de arrendamiento.',
      'validar_identidad', 'alta', 'en_proceso', 'medio',
      now() + interval '2 days', '72h', 'Iniciar validacion',
      'Contrato_Arrendamiento_Polanco_2026.pdf', 'DOC-2026-0312', 'EXP-2026-082', 'Inmobiliaria del Valle - Arrendamiento Polanco',
      'Arq. Luis Herrera', 'LH', 'Inmobiliaria del Valle S.A.',
      false, false, false,
      ARRAY['Validacion ID', 'Biometrico', 'Arrendamiento'],
      '[{"id":"c1","text":"Captura de INE (anverso y reverso)","done":true},{"id":"c2","text":"Reconocimiento facial con liveness check","done":false},{"id":"c3","text":"Validacion CURP en RENAPO","done":false}]'::jsonb,
      '[]'::jsonb,
      '[{"id":"a1","action":"Tarea creada - validacion de identidad requerida","user":"Sistema","date":"2026-05-21T08:00:00","icon":"UserCheck","color":"text-blue-500"}]'::jsonb,
      '[{"id":"at1","name":"INE_Anverso_LHerrera.jpg","size":"1.2 MB","type":"IMG"}]'::jsonb,
      '[]'::jsonb
    ),
    (
      ws_id, user_id, user_id,
      'Obtener Constancia NOM-151 - Pagare Comercial',
      'El pagare comercial por $450,000 MXN requiere constancia de conservacion de mensajes de datos bajo NOM-151 para tener plena validez legal ante autoridades fiscales.',
      'obtener_nom151', 'alta', 'pendiente', 'alto',
      now() + interval '1 day', '24h', 'Generar NOM-151',
      'Pagare_Comercial_2026-034.pdf', 'DOC-2026-0289', 'EXP-2026-067', 'Distribuidora Nacional - Pagare Q2',
      'Lic. Ana Torres', 'AT', 'Distribuidora Nacional S.A.',
      false, false, true,
      ARRAY['NOM-151', 'Pagare', 'Fiscal'],
      '[{"id":"c1","text":"Verificar hash SHA-256 del documento","done":true},{"id":"c2","text":"Solicitar sellado de tiempo a PSC","done":false},{"id":"c3","text":"Generar constancia NOM-151","done":false}]'::jsonb,
      '[{"id":"cm1","author":"Lic. Ana Torres","avatar":"AT","text":"El PSC confirmo disponibilidad para el sellado. Proceder con la solicitud.","date":"2026-05-22T09:00:00"}]'::jsonb,
      '[{"id":"a1","action":"Tarea generada tras firma exitosa del pagare","user":"Sistema","date":"2026-05-21T10:00:00","icon":"Zap","color":"text-amber-500"}]'::jsonb,
      '[{"id":"at1","name":"Pagare_Comercial_2026-034.pdf","size":"340 KB","type":"PDF"}]'::jsonb,
      '[]'::jsonb
    ),
    (
      ws_id, user_id, user_id,
      'Aprobar Poder Notarial - Representacion Fiscal',
      'Poder notarial general para representacion legal ante el SAT y autoridades fiscales. Requiere aprobacion del Consejo de Administracion antes de proceder a la firma.',
      'aprobar_documento', 'media', 'en_revision', 'medio',
      now() + interval '5 days', '5d', 'Aprobar documento',
      'Poder_Notarial_General_2026.pdf', 'DOC-2026-0301', 'EXP-2026-075', 'Notaria 42 - Poder Notarial Fiscal',
      'Dr. Fernando Vega', 'FV', 'Notaria Publica No. 42',
      false, false, false,
      ARRAY['Aprobacion', 'Poder Notarial', 'SAT'],
      '[{"id":"c1","text":"Revisar alcance del poder","done":true},{"id":"c2","text":"Validar datos del apoderado","done":true},{"id":"c3","text":"Consultar con area juridica","done":false}]'::jsonb,
      '[]'::jsonb,
      '[{"id":"a1","action":"Enviado a revision del Consejo","user":"Notaria 42","date":"2026-05-20T16:00:00","icon":"Send","color":"text-blue-500"}]'::jsonb,
      '[{"id":"at1","name":"Poder_Notarial_General_2026.pdf","size":"1.8 MB","type":"PDF"}]'::jsonb,
      '[]'::jsonb
    ),
    (
      ws_id, user_id, user_id,
      'Validar e.firma SAT - Contrato Laboral Senior Dev',
      'El nuevo colaborador debe validar su e.firma SAT (FIEL) para proceder con la firma del contrato individual de trabajo. El certificado debe estar vigente.',
      'validar_efirma', 'media', 'nueva', 'bajo',
      now() + interval '7 days', '7d', 'Validar e.firma',
      'Contrato_Trabajo_Dev_Senior.pdf', 'DOC-2026-0318', 'EXP-2026-088', 'RRHH - Contrato Dev Senior',
      'Ing. Sofia Mendoza', 'SM', 'RRHH FirmaMax',
      false, false, false,
      ARRAY['e.firma SAT', 'FIEL', 'Laboral'],
      '[{"id":"c1","text":"Cargar archivo .cer del certificado","done":false},{"id":"c2","text":"Cargar archivo .key de la llave privada","done":false},{"id":"c3","text":"Ingresar contrasena de la llave privada","done":false}]'::jsonb,
      '[]'::jsonb,
      '[{"id":"a1","action":"Tarea creada para nuevo colaborador","user":"RRHH FirmaMax","date":"2026-05-21T11:30:00","icon":"Plus","color":"text-blue-500"}]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb
    ),
    (
      ws_id, user_id, user_id,
      'Firmar Acta de Asamblea Ordinaria 2025',
      'Acta de asamblea ordinaria de accionistas del ejercicio fiscal 2025. Requiere firma autografa digitalizada de todos los miembros del Consejo de Administracion.',
      'firmar_documento', 'media', 'escalada', 'alto',
      now() - interval '2 days', '48h', 'Firmar ahora',
      'Acta_Asamblea_Ordinaria_2025.pdf', 'DOC-2026-0267', 'EXP-2026-058', 'Consejo Admin - Asamblea 2025',
      'Lic. Patricia Morales', 'PM', 'Consejo de Administracion',
      true, false, true,
      ARRAY['Escalada', 'Asamblea', 'Firma autografa'],
      '[{"id":"c1","text":"Verificar quorum de asistentes","done":true},{"id":"c2","text":"Revisar acuerdos del acta","done":true},{"id":"c3","text":"Firmar con firma autografa digital","done":false}]'::jsonb,
      '[{"id":"cm1","author":"Sistema","avatar":"SIS","text":"ALERTA: Tarea escalada automaticamente al supervisor por vencimiento de SLA.","date":"2026-05-23T08:00:00"}]'::jsonb,
      '[{"id":"a1","action":"SLA vencido - escalada automaticamente al supervisor","user":"Sistema","date":"2026-05-23T08:00:00","icon":"AlertTriangle","color":"text-red-500"}]'::jsonb,
      '[{"id":"at1","name":"Acta_Asamblea_Ordinaria_2025.pdf","size":"3.1 MB","type":"PDF"}]'::jsonb,
      '[]'::jsonb
    ),
    (
      ws_id, user_id, user_id,
      'Corregir Datos RFC - Convenio UNITEC',
      'Se detecto un error en el RFC del firmante principal del convenio de colaboracion con UNITEC. Debe corregirse antes de continuar con el proceso de firma.',
      'corregir_datos', 'alta', 'bloqueada', 'medio',
      now() + interval '3 days', '48h', 'Corregir datos',
      'Convenio_Colaboracion_UNITEC.pdf', 'DOC-2026-0325', 'EXP-2026-091', 'UNITEC - Convenio Colaboracion',
      'Lic. Jorge Castillo', 'JC', 'UNITEC',
      false, true, false,
      ARRAY['Correccion', 'RFC', 'Bloqueada'],
      '[{"id":"c1","text":"Identificar campo con RFC incorrecto","done":true},{"id":"c2","text":"Solicitar RFC correcto al firmante","done":false},{"id":"c3","text":"Actualizar datos en el sistema","done":false}]'::jsonb,
      '[{"id":"cm1","author":"Lic. Jorge Castillo","avatar":"JC","text":"El RFC capturado tiene un digito verificador incorrecto. Contactando al firmante.","date":"2026-05-21T14:00:00"}]'::jsonb,
      '[{"id":"a1","action":"Error de RFC detectado durante validacion","user":"Sistema","date":"2026-05-21T13:00:00","icon":"AlertCircle","color":"text-red-500"}]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb
    ),
    (
      ws_id, user_id, user_id,
      'Resolver Comentario - Clausula 8 Contrato Marco',
      'El area juridica dejo un comentario sobre la clausula 8 del contrato marco de distribucion. Se detecto un cambio critico en las condiciones de exclusividad que requiere revision.',
      'resolver_comentario', 'alta', 'nueva', 'alto',
      now() + interval '2 days', '48h', 'Resolver comentario',
      'Contrato_Marco_Distribucion_2026.pdf', 'DOC-2026-0335', 'EXP-2026-095', 'Distribucion Nacional - Contrato Marco',
      'Lic. Eduardo Flores', 'EF', 'Area Juridica',
      false, false, true,
      ARRAY['Comentario', 'Clausula critica', 'Juridico'],
      '[{"id":"c1","text":"Revisar comentario del area juridica","done":false},{"id":"c2","text":"Analizar impacto del cambio en clausula 8","done":false}]'::jsonb,
      '[{"id":"cm1","author":"Area Juridica","avatar":"AJ","text":"ALERTA: Cambio en clausula critica detectado. Se genero revision juridica automatica.","date":"2026-05-23T08:05:00"}]'::jsonb,
      '[{"id":"a1","action":"Cambio en clausula critica detectado - revision juridica generada","user":"Sistema","date":"2026-05-23T08:00:00","icon":"Zap","color":"text-amber-500"}]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb
    ),
    (
      ws_id, user_id, user_id,
      'Reintentar Firma e.firma - Contrato Suministro',
      'La firma con e.firma SAT fallo en el primer intento por error de conectividad con el SAT. Se genero esta tarea de reintento automaticamente.',
      'firmar_documento', 'alta', 'nueva', 'medio',
      now() + interval '1 day', '24h', 'Reintentar firma',
      'Contrato_Suministro_Industrial.pdf', 'DOC-2026-0339', 'EXP-2026-097', 'Suministro Industrial - Contrato 2026',
      'Lic. Valeria Reyes', 'VR', 'Sistema - Reintento automatico',
      false, false, false,
      ARRAY['Reintento', 'e.firma SAT', 'Error previo'],
      '[{"id":"c1","text":"Verificar conectividad con servicios SAT","done":false},{"id":"c2","text":"Validar vigencia del certificado e.firma","done":false},{"id":"c3","text":"Reintentar proceso de firma","done":false}]'::jsonb,
      '[{"id":"cm1","author":"Sistema","avatar":"SIS","text":"Firma fallida: Error de conexion con OCSP del SAT. Codigo: SAT-CONN-503","date":"2026-05-23T14:55:00"}]'::jsonb,
      '[{"id":"a1","action":"Firma e.firma fallida - tarea de reintento generada automaticamente","user":"Sistema","date":"2026-05-23T15:00:00","icon":"RefreshCw","color":"text-orange-500"}]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb
    )
    ON CONFLICT (id) DO NOTHING;
  ELSE
    RAISE NOTICE 'workspace_id or user_id not found. Skipping mock data.';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Mock data insertion failed: %', SQLERRM;
END $$;
