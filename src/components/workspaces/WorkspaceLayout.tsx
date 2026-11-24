import type { ReactNode } from 'react';

export default function WorkspaceLayout({
  children,
  standaloneClassName,
}: {
  children: ReactNode;
  standaloneClassName?: string;
}) {
  return (
    <div
      className={
        standaloneClassName
          ? undefined
          : 'app-page-bleed app-page-gutters bg-[#f6f8fb] dark:bg-background'
      }
    >
      <div
        className={
          standaloneClassName ??
          'workspace-layout app-page-width flex min-h-[calc(100dvh-var(--app-header-height))] flex-col xl:grid xl:grid-cols-[auto_minmax(0,1fr)] xl:grid-rows-[auto_1fr] xl:gap-x-7'
        }
      >
        {children}
      </div>
    </div>
  );
}
