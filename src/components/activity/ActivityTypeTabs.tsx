'use client';
import Link from 'next/link';
import { ClipboardList, FileText, FolderKanban } from 'lucide-react';
import SectionTabs, { sectionTabLinkClassName } from '@/components/workspaces/SectionTabs';
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
      className="mb-4"
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
          className={sectionTabLinkClassName}
        >
          <Icon size={15} className="hidden shrink-0 sm:block" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </SectionTabs>
  );
}
