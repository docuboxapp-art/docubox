-- Add etiqueta_rol column to contacts table for CRM labeling
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS etiqueta_rol TEXT;

COMMENT ON COLUMN public.contacts.etiqueta_rol IS 'Etiqueta/rol del contacto (cliente, proveedor, trabajador, etc.) tomado de la tabla rol';
