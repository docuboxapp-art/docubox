-- ============================================================
-- WORKSPACES MODULE
-- ============================================================

-- 1. TYPES
DROP TYPE IF EXISTS public.workspace_type CASCADE;
CREATE TYPE public.workspace_type AS ENUM ('personal', 'business');

DROP TYPE IF EXISTS public.workspace_member_role CASCADE;
CREATE TYPE public.workspace_member_role AS ENUM ('owner', 'admin', 'member');

-- 2. TABLES

-- user_profiles (base table required by workspaces)
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- workspaces
CREATE TABLE IF NOT EXISTS public.workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    workspace_type public.workspace_type NOT NULL DEFAULT 'personal'::public.workspace_type,
    owner_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    logo_url TEXT,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- workspace_members (junction table)
CREATE TABLE IF NOT EXISTS public.workspace_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    role public.workspace_member_role NOT NULL DEFAULT 'member'::public.workspace_member_role,
    joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(workspace_id, user_id)
);

-- 3. INDEXES
CREATE INDEX IF NOT EXISTS idx_workspaces_owner_id ON public.workspaces(owner_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_type ON public.workspaces(workspace_type);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id ON public.workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON public.workspace_members(user_id);

-- 4. FUNCTIONS (must be before RLS policies)

-- Function: handle new user → create user_profile + personal workspace
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    new_workspace_id UUID;
BEGIN
    -- Create user profile
    INSERT INTO public.user_profiles (id, email, full_name, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')
    )
    ON CONFLICT (id) DO NOTHING;

    -- Create personal workspace
    INSERT INTO public.workspaces (id, name, workspace_type, owner_id)
    VALUES (
        gen_random_uuid(),
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)) || '''s Workspace',
        'personal'::public.workspace_type,
        NEW.id
    )
    RETURNING id INTO new_workspace_id;

    -- Add user as owner member of their personal workspace
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (new_workspace_id, NEW.id, 'owner'::public.workspace_member_role)
    ON CONFLICT (workspace_id, user_id) DO NOTHING;

    RETURN NEW;
END;
$$;

-- Function: check if user is workspace member (for RLS)
CREATE OR REPLACE FUNCTION public.is_workspace_member(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
SELECT EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = ws_id AND wm.user_id = auth.uid()
)
$$;

-- Function: check if user is workspace owner or admin
CREATE OR REPLACE FUNCTION public.is_workspace_admin(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
SELECT EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = ws_id
      AND wm.user_id = auth.uid()
      AND wm.role IN ('owner', 'admin')
)
$$;

-- 5. ENABLE RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

-- 6. RLS POLICIES

-- user_profiles
DROP POLICY IF EXISTS "users_manage_own_user_profiles" ON public.user_profiles;
CREATE POLICY "users_manage_own_user_profiles"
ON public.user_profiles
FOR ALL
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- workspaces: members can view, admins can update, owners can delete
DROP POLICY IF EXISTS "workspace_members_can_view" ON public.workspaces;
CREATE POLICY "workspace_members_can_view"
ON public.workspaces
FOR SELECT
TO authenticated
USING (public.is_workspace_member(id));

DROP POLICY IF EXISTS "workspace_owner_can_insert" ON public.workspaces;
CREATE POLICY "workspace_owner_can_insert"
ON public.workspaces
FOR INSERT
TO authenticated
WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "workspace_admin_can_update" ON public.workspaces;
CREATE POLICY "workspace_admin_can_update"
ON public.workspaces
FOR UPDATE
TO authenticated
USING (public.is_workspace_admin(id))
WITH CHECK (public.is_workspace_admin(id));

DROP POLICY IF EXISTS "workspace_owner_can_delete" ON public.workspaces;
CREATE POLICY "workspace_owner_can_delete"
ON public.workspaces
FOR DELETE
TO authenticated
USING (owner_id = auth.uid());

-- workspace_members: members can view their own memberships
DROP POLICY IF EXISTS "users_view_own_memberships" ON public.workspace_members;
CREATE POLICY "users_view_own_memberships"
ON public.workspace_members
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "workspace_admin_manage_members" ON public.workspace_members;
CREATE POLICY "workspace_admin_manage_members"
ON public.workspace_members
FOR INSERT
TO authenticated
WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "workspace_admin_update_members" ON public.workspace_members;
CREATE POLICY "workspace_admin_update_members"
ON public.workspace_members
FOR UPDATE
TO authenticated
USING (public.is_workspace_admin(workspace_id))
WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "workspace_admin_delete_members" ON public.workspace_members;
CREATE POLICY "workspace_admin_delete_members"
ON public.workspace_members
FOR DELETE
TO authenticated
USING (user_id = auth.uid() OR public.is_workspace_admin(workspace_id));

-- 7. TRIGGERS
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();
