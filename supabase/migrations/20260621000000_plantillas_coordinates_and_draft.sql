-- Plantillas: Add field coordinates, draft support, and approval contact
-- Adds coordinate tracking for fields, approval_contact, and margenes columns

ALTER TABLE public.plantillas
  ADD COLUMN IF NOT EXISTS margenes JSONB DEFAULT '{"top":2.54,"bottom":2.54,"left":3.17,"right":3.17}'::jsonb,
  ADD COLUMN IF NOT EXISTS show_header BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_footer BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS header_html TEXT,
  ADD COLUMN IF NOT EXISTS footer_html TEXT,
  ADD COLUMN IF NOT EXISTS approval_contact JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS campo_coordenadas JSONB DEFAULT '[]'::jsonb;

-- campo_coordenadas stores array of:
-- { fieldId, fieldType, label, pageIndex, x, y, width, height }

-- Ensure updated_at trigger exists
CREATE OR REPLACE FUNCTION public.update_plantillas_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS plantillas_updated_at ON public.plantillas;
CREATE TRIGGER plantillas_updated_at
  BEFORE UPDATE ON public.plantillas
  FOR EACH ROW EXECUTE FUNCTION public.update_plantillas_updated_at();

-- Ensure RLS
ALTER TABLE public.plantillas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_plantillas" ON public.plantillas;
CREATE POLICY "users_manage_own_plantillas"
ON public.plantillas
FOR ALL
TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());
