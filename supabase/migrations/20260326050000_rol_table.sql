-- Migration: Create rol table with seed data
-- Timestamp: 20260326050000

CREATE TABLE IF NOT EXISTS public.rol (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rol_nombre ON public.rol(nombre);

ALTER TABLE public.rol ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_rol" ON public.rol;
CREATE POLICY "authenticated_read_rol"
  ON public.rol
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "authenticated_manage_rol" ON public.rol;
CREATE POLICY "authenticated_manage_rol"
  ON public.rol
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Seed data
INSERT INTO public.rol (nombre) VALUES
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
  ('Proveedor de Materiales'),
  ('Usuario'),
  ('Licenciante'),
  ('Licenciatario'),
  ('Titular de Cuenta'),
  ('Administrador de Cuenta'),
  ('Afiliado'),
  ('Partner'),
  ('Proveedor de Servicios Tecnológicos'),
  ('Proveedor de Infraestructura'),
  ('Custodio Digital'),
  ('Depositante'),
  ('Beneficiario del Pago'),
  ('Agente de Retención'),
  ('Administrador del Fondo'),
  ('Fideicomitente'),
  ('Fiduciario'),
  ('Fideicomisario'),
  ('Ordenante'),
  ('Receptor de Fondos'),
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
