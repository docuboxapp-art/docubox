-- ============================================================
-- Recreate access_logs table (ensure it exists in schema cache)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.access_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    email TEXT,
    ip_address TEXT,
    access_date DATE NOT NULL DEFAULT CURRENT_DATE,
    access_time TIME NOT NULL DEFAULT CURRENT_TIME,
    accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Geolocalización basada en IP
    country TEXT,
    country_code TEXT,
    region TEXT,
    city TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    timezone TEXT,
    isp TEXT,
    -- Información del cliente
    browser TEXT,
    browser_version TEXT,
    operating_system TEXT,
    os_version TEXT,
    device_type TEXT,
    user_agent TEXT,
    -- Metadatos adicionales
    login_success BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_access_logs_user_id ON public.access_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_accessed_at ON public.access_logs(accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_ip_address ON public.access_logs(ip_address);
CREATE INDEX IF NOT EXISTS idx_access_logs_email ON public.access_logs(email);

-- Habilitar RLS
ALTER TABLE public.access_logs ENABLE ROW LEVEL SECURITY;

-- Política: cada usuario puede ver sus propios logs
DROP POLICY IF EXISTS "users_view_own_access_logs" ON public.access_logs;
CREATE POLICY "users_view_own_access_logs"
ON public.access_logs
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Política: inserción permitida para usuarios autenticados (desde API route con service role)
DROP POLICY IF EXISTS "service_role_insert_access_logs" ON public.access_logs;
CREATE POLICY "service_role_insert_access_logs"
ON public.access_logs
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Política para service_role (sin restricciones)
DROP POLICY IF EXISTS "service_role_all_access_logs" ON public.access_logs;
CREATE POLICY "service_role_all_access_logs"
ON public.access_logs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
