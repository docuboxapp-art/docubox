'use client';
import Link from 'next/link';
import { ClipboardList, FileText, FolderKanban } from 'lucide-react';
import type { ActivityMode } from '@/lib/activity/model';
export default function ActivityTypeTabs({
  mode,
  active,
}: {
  mode: ActivityMode;
  active: 'documentos' | 'formularios' | 'expedientes';
}) {
  const path = mode === 'sent' ? '/mis-solicitudes' : '/mis-participaciones';
  return (
    <nav
      aria-label={mode === 'sent' ? 'Tipo de solicitudes enviadas' : 'Tipo de participaciones'}
      className="mb-4 flex w-full flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-border dark:bg-card"
    >
      {(
        [
          ['documentos', 'Documentos', FileText],
          ['formularios', 'Formularios', ClipboardList],
          ['expedientes', 'Expedientes', FolderKanban],
        ] as const
      ).map(([kind, label, Icon]) => (
        <Link
          key={kind}
          href={kind === 'documentos' ? path : `${path}?tipo=${kind}`}
          prefetch={false}
          onClick={(event) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey ||
              window.location.pathname !== path
            )
              return;
            event.preventDefault();
            if (active !== kind)
              window.history.pushState(
                null,
                '',
                kind === 'documentos' ? path : `${path}?tipo=${kind}`
              );
          }}
          aria-current={active === kind ? 'page' : undefined}
          className={`inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-md px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:flex-none sm:px-5 sm:text-sm ${active === kind ? 'bg-blue-50 text-primary dark:bg-primary/15' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:text-muted-foreground dark:hover:bg-muted'}`}
        >
          <Icon size={16} className="hidden shrink-0 sm:block" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
