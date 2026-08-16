-- Completes deterministic ordering for protected room resources.
ALTER TABLE public.collaboration_room_resources
  ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0
  CHECK (position >= 0);

CREATE INDEX IF NOT EXISTS collaboration_room_resources_order_idx
  ON public.collaboration_room_resources(room_id, position, created_at);
