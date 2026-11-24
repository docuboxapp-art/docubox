import type { ReactNode } from 'react';

export default function SectionTabs({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className: string;
}) {
  return (
    <div
      className={`flex w-full shrink-0 items-center justify-center border-slate-200 bg-white px-4 sm:px-5 lg:px-6 dark:border-border dark:bg-card ${className}`}
    >
      <nav
        aria-label={label}
        className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-blue-100 bg-blue-50/80 p-1 dark:border-primary/20 dark:bg-primary/10"
      >
        {children}
      </nav>
    </div>
  );
}
