-- Add invite_code column to workspaces table
ALTER TABLE public.workspaces
ADD COLUMN IF NOT EXISTS invite_code TEXT;

-- Create unique index on invite_code (partial, only for non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_invite_code
ON public.workspaces (invite_code)
WHERE invite_code IS NOT NULL;

-- Create personal workspace for luishb.mzt@gmail.com
DO $$
DECLARE
    target_user_id UUID;
    workspace_uuid UUID;
    existing_workspace_id UUID;
BEGIN
    -- Find the user by email
    SELECT id INTO target_user_id
    FROM public.user_profiles
    WHERE email = 'luishb.mzt@gmail.com'
    LIMIT 1;

    IF target_user_id IS NULL THEN
        RAISE NOTICE 'User luishb.mzt@gmail.com not found in user_profiles. Skipping workspace creation.';
        RETURN;
    END IF;

    -- Check if personal workspace already exists for this user
    SELECT id INTO existing_workspace_id
    FROM public.workspaces
    WHERE owner_id = target_user_id
      AND workspace_type = 'personal'
    LIMIT 1;

    IF existing_workspace_id IS NOT NULL THEN
        RAISE NOTICE 'Personal workspace already exists for luishb.mzt@gmail.com (id: %)', existing_workspace_id;
        RETURN;
    END IF;

    -- Create the personal workspace
    workspace_uuid := gen_random_uuid();

    INSERT INTO public.workspaces (id, name, workspace_type, owner_id, description, created_at, updated_at)
    VALUES (
        workspace_uuid,
        'Espacio Personal',
        'personal',
        target_user_id,
        'Espacio de trabajo personal',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    )
    ON CONFLICT (id) DO NOTHING;

    -- Add owner as member with 'owner' role
    INSERT INTO public.workspace_members (id, workspace_id, user_id, role, joined_at)
    VALUES (
        gen_random_uuid(),
        workspace_uuid,
        target_user_id,
        'owner',
        CURRENT_TIMESTAMP
    )
    ON CONFLICT (id) DO NOTHING;

    RAISE NOTICE 'Personal workspace created for luishb.mzt@gmail.com (workspace_id: %)', workspace_uuid;

EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Error creating personal workspace: %', SQLERRM;
END $$;
