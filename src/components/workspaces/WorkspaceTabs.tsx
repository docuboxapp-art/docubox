'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { FileText, FolderKanban } from 'lucide-react';
import { useAppModules } from '@/contexts/AppModulesContext';
import SectionTabs from './SectionTabs';

export default function WorkspaceTabs({
  active,
  heading,
}: {
  active: 'documentos' | 'expedientes';
  heading?: ReactNode;
}) {
  const { isModuleActive } = useAppModules();
  const showTabs = isModuleActive('expedientes');

  if (!heading && !showTabs) return null;

  return (
    <div
      className={`app-page-top xl:col-span-full xl:row-start-1 ${showTabs ? 'pb-2 xl:pb-0' : ''}`}
    >
      {heading}
      {showTabs && (
        <SectionTabs label="Contenido de Mi Espacio" className="h-14 rounded-lg border">
          {(
            [
              ['documentos', 'Documentos', FileText, '/mi-espacio'],
              ['expedientes', 'Expedientes', FolderKanban, '/mi-espacio?pestana=expedientes'],
            ] as const
          ).map(([id, label, Icon, href]) => (
            <Link
              key={id}
              href={href}
              prefetch={false}
              aria-current={active === id ? 'page' : undefined}
              className={`flex min-h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-3 py-2 text-xs font-medium transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 motion-reduce:transition-none sm:flex-none sm:px-4 sm:text-[13px] ${active === id ? 'bg-primary text-white shadow-sm focus-visible:ring-white/70' : 'text-slate-600 hover:bg-white/80 hover:text-primary dark:text-slate-300 dark:hover:bg-primary/15 dark:hover:text-white'}`}
            >
              <Icon size={15} className="shrink-0" aria-hidden="true" />
              {label}
            </Link>
          ))}
        </SectionTabs>
      )}
    </div>
  );
}
