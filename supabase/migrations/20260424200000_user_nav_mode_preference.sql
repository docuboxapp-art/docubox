-- Add nav_mode preference column to user_profiles
-- Values: 'topbar' (default) | 'sidebar'
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS nav_mode text NOT NULL DEFAULT 'topbar'
    CHECK (nav_mode IN ('topbar', 'sidebar'));
