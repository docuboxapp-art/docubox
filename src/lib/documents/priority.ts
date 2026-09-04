export const DOCUMENT_PRIORITIES = ['normal', 'high', 'urgent'] as const;

export type DocumentPriority = (typeof DOCUMENT_PRIORITIES)[number];

export function normalizeDocumentPriority(value: unknown, legacyUrgent = false): DocumentPriority {
  if (value === 'normal' || value === 'high' || value === 'urgent') return value;
  return legacyUrgent ? 'urgent' : 'normal';
}

export function isUrgentDocument(value: unknown, legacyUrgent = false) {
  return normalizeDocumentPriority(value, legacyUrgent) === 'urgent';
}

export function operationalPriorityRank(input: {
  priority?: unknown;
  legacyUrgent?: boolean;
  expiresAt?: string | null;
}) {
  const urgent = isUrgentDocument(input.priority, input.legacyUrgent);
  const expiresAt = input.expiresAt ? new Date(input.expiresAt).getTime() : Number.NaN;
  const isUpcoming = Number.isFinite(expiresAt) && expiresAt > Date.now();

  if (urgent && isUpcoming) return 0;
  if (urgent) return 1;
  if (isUpcoming) return 2;
  return 3;
}
