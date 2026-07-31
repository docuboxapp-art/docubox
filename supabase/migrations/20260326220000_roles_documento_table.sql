-- Migration: Create roles_documento table with all document roles
-- Timestamp: 20260326220000

CREATE TABLE IF NOT EXISTS public.roles_documento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL UNIQUE,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_roles_documento_nombre ON public.roles_documento(nombre);
CREATE INDEX IF NOT EXISTS idx_roles_documento_activo ON public.roles_documento(activo);

ALTER TABLE public.roles_documento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_roles_documento" ON public.roles_documento;
CREATE POLICY "authenticated_read_roles_documento"
  ON public.roles_documento
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "authenticated_manage_roles_documento" ON public.roles_documento;
CREATE POLICY "authenticated_manage_roles_documento"
  ON public.roles_documento
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Seed data with all required roles
INSERT INTO public.roles_documento (nombre) VALUES
  ('Contratante'),
  ('Contratado'),
  ('Parte A'),
  ('Parte B'),
  ('Parte C'),
  ('Compareciente'),
  ('Interviniente'),
  ('Suscriptor'),
  ('Declarante'),
  ('Aceptante'),
  ('Beneficiario'),
  ('Obligado'),
  ('Garante'),
  ('Fiador'),
  ('Aval'),
  ('Cliente'),
  ('Proveedor'),
  ('Prestador de Servicios'),
  ('Consumidor'),
  ('Distribuidor'),
  ('Comisionista'),
  ('Mandante'),
  ('Mandatario'),
  ('Arrendador'),
  ('Arrendatario'),
  ('Cedente'),
  ('Cesionario'),
  ('Comprador'),
  ('Vendedor'),
  ('Inversionista'),
  ('Socio'),
  ('Accionista'),
  ('Propietario'),
  ('Desarrollador'),
  ('Contratista'),
  ('Subcontratista'),
  ('Supervisor de Obra'),
  ('Director Responsable de Obra'),
  ('Residente'),
  ('Usuario'),
  ('Licenciante'),
  ('Licenciatario'),
  ('Titular de Cuenta'),
  ('Administrador de Cuenta'),
  ('Afiliado'),
  ('Depositante'),
  ('Beneficiario del Pago'),
  ('Agente de Retención'),
  ('Administrador del Fondo'),
  ('Fideicomitente'),
  ('Fiduciario'),
  ('Fideicomisario'),
  ('Ordenante'),
  ('Patrón'),
  ('Trabajador'),
  ('Empleado'),
  ('Colaborador'),
  ('Prestador Independiente'),
  ('Representante Sindical'),
  ('Representante Legal'),
  ('Apoderado'),
  ('Oficial de Cumplimiento'),
  ('Testigo'),
  ('Validador'),
  ('Auditor')
ON CONFLICT (nombre) DO NOTHING;
