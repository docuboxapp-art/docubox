'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { FileText, FolderKanban } from 'lucide-react';
import { useAppModules } from '@/contexts/AppModulesContext';
import SectionTabs, { sectionTabLinkClassName } from './SectionTabs';

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
        <SectionTabs label="Contenido de Mi Espacio">
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
              className={sectionTabLinkClassName}
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
