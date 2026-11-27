import type { ReactNode } from 'react';

export const sectionTabLinkClassName =
  'flex min-h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent px-2 py-1.5 text-[13px] font-medium text-slate-700 transition-colors hover:bg-card/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 sm:px-4 sm:text-sm motion-reduce:transition-none aria-[current=page]:border-border aria-[current=page]:bg-card aria-[current=page]:text-blue-700 aria-[current=page]:shadow-sm dark:text-slate-200 dark:aria-[current=page]:bg-accent dark:aria-[current=page]:text-blue-200';

export default function SectionTabs({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={`flex w-fit max-w-full shrink-0 gap-0.5 overflow-x-auto rounded-lg bg-[hsl(var(--secondary-btn))] p-1 sm:gap-1 ${className}`}
    >
      {children}
    </nav>
  );
}
