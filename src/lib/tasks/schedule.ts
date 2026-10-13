const DAY_MS = 86_400_000;

export function isScheduledForLater(scheduledFor: string | null | undefined, now = Date.now()): boolean {
  return Boolean(scheduledFor && new Date(scheduledFor).getTime() > now);
}

export function scheduleValidationError(
  scheduledFor: string | null | undefined,
  dueDate: string | null | undefined,
  now = Date.now(),
): string | null {
  if (!scheduledFor) return null;
  const start = new Date(scheduledFor).getTime();
  if (!Number.isFinite(start) || start <= now) return 'El inicio programado debe ser una fecha futura.';
  if (dueDate && new Date(dueDate).getTime() <= start)
    return 'La fecha límite debe ser posterior al inicio programado.';
  return null;
}

export function toLocalDateTimeInput(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function dueCalendarLabel(dueDate: string, now = new Date()): string | null {
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return null;
  const dueDay = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((dueDay - today) / DAY_MS);
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  if (days > 1 && days <= 3) return `${days} días`;
  return null;
}
