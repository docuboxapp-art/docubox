-- A due date is a deadline, not a start date. Keep the planned start separately.
ALTER TABLE public.tareas
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;

ALTER TABLE public.tareas
  ADD CONSTRAINT tareas_scheduled_before_due
  CHECK (scheduled_for IS NULL OR due_date IS NULL OR scheduled_for < due_date);

CREATE INDEX IF NOT EXISTS tareas_scheduled_for_idx
  ON public.tareas (workspace_id, scheduled_for)
  WHERE scheduled_for IS NOT NULL AND estado IN ('nueva', 'pendiente');
