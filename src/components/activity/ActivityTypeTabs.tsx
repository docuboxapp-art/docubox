'use client';
import Link from 'next/link';
import { ClipboardList, FileText, FolderKanban } from 'lucide-react';
import SectionTabs from '@/components/workspaces/SectionTabs';
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
    <SectionTabs
      label={mode === 'sent' ? 'Tipo de solicitudes enviadas' : 'Tipo de participaciones'}
      className="mb-4 h-14 rounded-lg border"
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
          className={`flex min-h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-3 py-2 text-xs font-medium transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 motion-reduce:transition-none sm:flex-none sm:px-4 sm:text-[13px] ${active === kind ? 'bg-primary text-white shadow-sm focus-visible:ring-white/70' : 'text-slate-600 hover:bg-white/80 hover:text-primary dark:text-slate-300 dark:hover:bg-primary/15 dark:hover:text-white'}`}
        >
          <Icon size={15} className="hidden shrink-0 sm:block" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </SectionTabs>
  );
}
