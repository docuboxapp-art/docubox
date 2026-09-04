-- Folders are organizational containers and are deleted immediately when empty.
-- This minimal tombstone keeps an auditable record without preserving the folder.

CREATE TABLE IF NOT EXISTS public.folder_deletion_tombstones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  folder_name text NOT NULL,
  folder_created_at timestamptz,
  reason text NOT NULL DEFAULT 'USER_REQUEST' CHECK (reason IN ('USER_REQUEST', 'ADMINISTRATIVE')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  failure_code text,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_folder_deletion_tombstones_owner_requested
  ON public.folder_deletion_tombstones (owner_id, requested_at DESC);

ALTER TABLE public.folder_deletion_tombstones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.folder_deletion_tombstones FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.folder_deletion_tombstones TO service_role;

COMMENT ON TABLE public.folder_deletion_tombstones IS
  'Minimal permanent-deletion history for empty folders. It intentionally has no foreign key to carpetas.';
