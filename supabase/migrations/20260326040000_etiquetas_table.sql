-- Migration: Create etiquetas table with seed data
-- Timestamp: 20260326040000

CREATE TABLE IF NOT EXISTS public.etiquetas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#6B7280',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_etiquetas_nombre ON public.etiquetas(nombre);

ALTER TABLE public.etiquetas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_etiquetas" ON public.etiquetas;
CREATE POLICY "authenticated_read_etiquetas"
  ON public.etiquetas
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "authenticated_manage_etiquetas" ON public.etiquetas;
CREATE POLICY "authenticated_manage_etiquetas"
  ON public.etiquetas
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Seed data
INSERT INTO public.etiquetas (nombre, color) VALUES
  ('borrador',               '#9CA3AF'),
  ('en_revision',            '#F59E0B'),
  ('pendiente_firma',        '#3B82F6'),
  ('firmado',                '#10B981'),
  ('rechazado',              '#EF4444'),
  ('vencido',                '#DC2626'),
  ('expirado',               '#B91C1C'),
  ('archivado',              '#6B7280'),
  ('observado',              '#F97316'),
  ('reenviado',              '#8B5CF6'),
  ('reintento_firma',        '#7C3AED'),
  ('cerrado',                '#374151'),
  ('finalizado',             '#059669'),
  ('efirma_sat',             '#1D4ED8'),
  ('firma_autografa',        '#2563EB'),
  ('firma_mixta',            '#4F46E5'),
  ('firma_simple',           '#6366F1'),
  ('firma_avanzada',         '#7C3AED'),
  ('biometria_requerida',    '#EC4899'),
  ('selfie_requerida',       '#F472B6'),
  ('otp_sms',                '#0EA5E9'),
  ('otp_email',              '#38BDF8'),
  ('token_digital',          '#06B6D4'),
  ('testigos_requeridos',    '#14B8A6'),
  ('representante_legal',    '#0D9488'),
  ('persona_fisica',         '#10B981'),
  ('persona_moral',          '#059669'),
  ('apoderado_legal',        '#047857'),
  ('administrador_unico',    '#065F46'),
  ('socio',                  '#84CC16'),
  ('accionista',             '#65A30D'),
  ('empleado',               '#4D7C0F'),
  ('cliente',                '#A16207'),
  ('proveedor',              '#92400E'),
  ('autoridad',              '#7C2D12'),
  ('tercero_autorizado',     '#78350F'),
  ('urgente',                '#EF4444'),
  ('con_vigencia',           '#22C55E'),
  ('sin_vigencia',           '#F87171'),
  ('vigencia_anual',         '#16A34A'),
  ('vigencia_mensual',       '#15803D'),
  ('fecha_limite',           '#DC2626'),
  ('prorrogable',            '#2DD4BF'),
  ('renovable',              '#0891B2'),
  ('no_renovable',           '#9CA3AF'),
  ('historico',              '#6B7280'),
  ('critico',                '#DC2626'),
  ('alto_riesgo',            '#EF4444'),
  ('riesgo_medio',           '#F59E0B'),
  ('bajo_riesgo',            '#22C55E'),
  ('sensible',               '#F97316'),
  ('confidencial',           '#DC2626'),
  ('informacion_reservada',  '#B91C1C'),
  ('datos_personales',       '#7C3AED'),
  ('datos_fiscales',         '#4F46E5'),
  ('datos_bancarios',        '#1D4ED8'),
  ('cumplimiento_sat',       '#0369A1'),
  ('pl_d',                   '#0E7490'),
  ('kyc',                    '#0891B2'),
  ('kyb',                    '#06B6D4'),
  ('beneficiario_controlador','#0D9488'),
  ('auditoria',              '#374151'),
  ('sujeto_revision',        '#4B5563'),
  ('gobierno',               '#1E3A5F'),
  ('regulatorio',            '#1E40AF'),
  ('obligatorio',            '#DC2626'),
  ('retencion_legal',        '#7C2D12'),
  ('interno',                '#6B7280'),
  ('externo',                '#374151'),
  ('multientidad',           '#8B5CF6'),
  ('multirepresentante',     '#7C3AED'),
  ('flujo_escalonado',       '#6D28D9'),
  ('requiere_aprobacion',    '#F59E0B'),
  ('aprobado',               '#10B981'),
  ('rechazado_interno',      '#EF4444'),
  ('evidencia_probatoria',   '#0369A1'),
  ('peritaje_digital',       '#1D4ED8'),
  ('trazabilidad_completa',  '#2563EB'),
  ('integridad_probada',     '#059669'),
  ('no_repudio',             '#065F46'),
  ('fecha_cierta',           '#0D9488'),
  ('prueba_legal',           '#1E40AF'),
  ('fuerza_probatoria_alta', '#1E3A5F'),
  ('no_eliminable',          '#DC2626'),
  ('eliminable',             '#6B7280'),
  ('papelera',               '#9CA3AF'),
  ('retencion_5_anios',      '#78350F'),
  ('retencion_10_anios',     '#7C2D12'),
  ('eliminacion_programada', '#B91C1C'),
  ('baja_logica',            '#4B5563'),
  ('Otros',                  '#D1D5DB')
ON CONFLICT (nombre) DO NOTHING;
