export type TimelineEvent = {
  id: string;
  action: string;
  created_at: string;
  source?: string;
  actor_email?: string;
};

const orderAtSameInstant: Record<string, number> = {
  documento_creado: 0,
  participante_asignado: 1,
  firma_completada: 8,
  aprobacion_otorgada: 8,
  firma_rechazada: 8,
  documento_completado: 9,
  documento_cancelado: 9,
  documento_vencido: 9,
};

export function orderDocumentActivity<T extends TimelineEvent>(events: T[]): T[] {
  return [...events].sort((left, right) => {
    const difference = Date.parse(left.created_at) - Date.parse(right.created_at);
    if (difference) return difference;
    const priority =
      (orderAtSameInstant[left.action] ?? 5) - (orderAtSameInstant[right.action] ?? 5);
    return priority || left.id.localeCompare(right.id);
  });
}

export function removeDuplicateSynthesizedActivity<T extends TimelineEvent>(events: T[]): T[] {
  return events.filter((event) => {
    if (event.source !== 'synthesized') return true;
    return !events.some((recorded) => {
      if (recorded.source === 'synthesized' || recorded.action !== event.action) return false;
      if (Math.abs(Date.parse(recorded.created_at) - Date.parse(event.created_at)) > 2000)
        return false;
      const recordedEmail = recorded.actor_email?.trim().toLowerCase();
      const syntheticEmail = event.actor_email?.trim().toLowerCase();
      return !recordedEmail || !syntheticEmail || recordedEmail === syntheticEmail;
    });
  });
}
