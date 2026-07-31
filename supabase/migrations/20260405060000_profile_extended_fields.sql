-- Migration: Add extended profile fields to user_profiles
-- Adds: nombre, apellido_paterno, apellido_materno, telefono, regimen_fiscal,
--       codigo_postal, estado, municipio, colonia, localidad, calle, num_exterior, num_interior

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS nombre TEXT,
  ADD COLUMN IF NOT EXISTS apellido_paterno TEXT,
  ADD COLUMN IF NOT EXISTS apellido_materno TEXT,
  ADD COLUMN IF NOT EXISTS telefono TEXT,
  ADD COLUMN IF NOT EXISTS regimen_fiscal TEXT,
  ADD COLUMN IF NOT EXISTS codigo_postal TEXT,
  ADD COLUMN IF NOT EXISTS estado TEXT,
  ADD COLUMN IF NOT EXISTS municipio TEXT,
  ADD COLUMN IF NOT EXISTS colonia TEXT,
  ADD COLUMN IF NOT EXISTS localidad TEXT,
  ADD COLUMN IF NOT EXISTS calle TEXT,
  ADD COLUMN IF NOT EXISTS num_exterior TEXT,
  ADD COLUMN IF NOT EXISTS num_interior TEXT;

-- Create avatars storage bucket if not exists (handled via Supabase dashboard or API)
-- RLS: allow authenticated users to upload/read their own avatar
-- Storage policies are managed via Supabase dashboard
