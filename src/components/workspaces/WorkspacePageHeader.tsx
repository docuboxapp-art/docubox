'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';

export default function WorkspacePageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const personalName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Mi Espacio';
  const workspaceName =
    !activeWorkspace || activeWorkspace.workspaceType === 'personal'
      ? personalName
      : activeWorkspace.name || personalName;

  return (
    <header className="mb-4 flex flex-col gap-3 border-b border-slate-200/80 pb-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-600 leading-tight text-slate-950 dark:text-foreground">
          {title}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {description ?? (
            <>
              Espacio de trabajo de <span className="font-600 text-slate-700">{workspaceName}</span>
            </>
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}
