-- Folder-level trash state. Documents retain their own lifecycle and recovery period.
ALTER TABLE public.carpetas
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trashed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS restore_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trashed_root_folder_id UUID;

ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS trashed_folder_id UUID;

CREATE INDEX IF NOT EXISTS idx_carpetas_trash_recovery
  ON public.carpetas (restore_until)
  WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_carpetas_trashed_root
  ON public.carpetas (trashed_root_folder_id)
  WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documentos_trashed_folder
  ON public.documentos (trashed_folder_id)
  WHERE trashed_folder_id IS NOT NULL;

ALTER TABLE public.folder_deletion_tombstones
  DROP CONSTRAINT IF EXISTS folder_deletion_tombstones_reason_check;
ALTER TABLE public.folder_deletion_tombstones
  ADD CONSTRAINT folder_deletion_tombstones_reason_check
  CHECK (reason IN ('USER_REQUEST', 'ADMINISTRATIVE', 'AUTO_RECOVERY_EXPIRY'));

COMMENT ON COLUMN public.carpetas.trashed_root_folder_id IS
  'Root folder of a coordinated folder-to-trash operation. Used to restore only the documents and nested folders moved by that operation.';
COMMENT ON COLUMN public.documentos.trashed_folder_id IS
  'Root folder that moved this document to trash. It never bypasses document-level Legal Hold or retention rules.';
