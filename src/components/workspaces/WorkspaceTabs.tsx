'use client';

import Link from 'next/link';
import { FileText, FolderKanban } from 'lucide-react';
import { useAppModules } from '@/contexts/AppModulesContext';

export default function WorkspaceTabs({ active }: { active: 'documentos' | 'expedientes' }) {
  const { isModuleActive } = useAppModules();

  if (!isModuleActive('expedientes')) return null;

  return (
    <nav
      aria-label="Contenido de Mi Espacio"
      className="workspace-tabs mb-4 flex w-full gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-border dark:bg-card"
    >
      {(
        [
          ['documentos', 'Documentos', FileText, '/mis-documentos'],
          ['expedientes', 'Expedientes', FolderKanban, '/mis-documentos?pestana=expedientes'],
        ] as const
      ).map(([id, label, Icon, href]) => (
        <Link
          key={id}
          href={href}
          prefetch={false}
          aria-current={active === id ? 'page' : undefined}
          className={`inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-md px-2 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:flex-none sm:px-5 ${active === id ? 'bg-blue-50 text-primary dark:bg-primary/15' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:text-muted-foreground dark:hover:bg-muted'}`}
        >
          <Icon size={16} className="shrink-0" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
