export type TrashCountdown = {
  state: 'RECOVERY' | 'DUE_FOR_EVALUATION' | 'UNSCHEDULED';
  label: string;
  scheduledFor: Date | null;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function getTrashCountdown(
  restoreUntil: string | null | undefined,
  now: Date = new Date()
): TrashCountdown {
  if (!restoreUntil) {
    return { state: 'UNSCHEDULED', label: 'Sin fecha programada', scheduledFor: null };
  }

  const scheduledFor = new Date(restoreUntil);
  if (Number.isNaN(scheduledFor.getTime())) {
    return { state: 'UNSCHEDULED', label: 'Sin fecha programada', scheduledFor: null };
  }

  const remaining = scheduledFor.getTime() - now.getTime();
  if (remaining <= 0) {
    return {
      state: 'DUE_FOR_EVALUATION',
      label: 'En evaluación para eliminación',
      scheduledFor,
    };
  }

  if (remaining >= DAY) {
    const days = Math.ceil(remaining / DAY);
    return {
      state: 'RECOVERY',
      label:
        days <= 7
          ? `Eliminación próxima · ${days} ${days === 1 ? 'día' : 'días'}`
          : `${days} ${days === 1 ? 'día' : 'días'} restantes`,
      scheduledFor,
    };
  }

  const hours = Math.floor(remaining / HOUR);
  const minutes = Math.max(1, Math.ceil((remaining % HOUR) / MINUTE));
  return {
    state: 'RECOVERY',
    label:
      hours > 0
        ? `Se elimina en ${hours} h${minutes > 0 ? ` ${minutes} min` : ''}`
        : `Se elimina en ${minutes} min`,
    scheduledFor,
  };
}
