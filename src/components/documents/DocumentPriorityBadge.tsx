import { Flag } from 'lucide-react';
import { isUrgentDocument, type DocumentPriority } from '@/lib/documents/priority';

export function DocumentPriorityBadge({
  priority,
  legacyUrgent = false,
  className = '',
}: {
  priority?: DocumentPriority | string | null;
  legacyUrgent?: boolean;
  className?: string;
}) {
  if (!isUrgentDocument(priority, legacyUrgent)) return null;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:border-rose-400/30 dark:bg-rose-500/15 dark:text-rose-200 ${className}`}
      title="Prioridad urgente"
    >
      <Flag aria-hidden="true" size={12} />
      Urgente
    </span>
  );
}
