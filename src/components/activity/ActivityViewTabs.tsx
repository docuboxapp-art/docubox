'use client';

import { CalendarDays, LayoutGrid, LayoutList } from 'lucide-react';

type ActivityView = 'lista' | 'tablero' | 'calendario';

export default function ActivityViewTabs({
  value,
  onChange,
}: {
  value: ActivityView;
  onChange: (view: ActivityView) => void;
}) {
  return (
    <nav
      aria-label="Vista del listado"
      className="flex max-w-full shrink-0 gap-1 overflow-x-auto border-b border-slate-200/80 dark:border-border"
    >
      {(
        [
          ['lista', 'Lista', LayoutList],
          ['tablero', 'Tablero', LayoutGrid],
          ['calendario', 'Calendario', CalendarDays],
        ] as const
      ).map(([id, label, Icon]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={value === id}
          className={`group relative flex min-h-10 shrink-0 items-center px-0.5 py-1.5 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 ${value === id ? 'text-slate-950 after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary dark:text-foreground' : 'text-slate-500 dark:text-muted-foreground'}`}
        >
          <span
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1.5 transition-colors ${value === id ? 'border-slate-200/80 bg-white shadow-sm dark:border-border dark:bg-muted/60' : 'border-transparent group-hover:bg-slate-50 group-hover:text-slate-900 dark:group-hover:bg-muted dark:group-hover:text-foreground'}`}
          >
            <Icon size={14} className="shrink-0" aria-hidden="true" />
            {label}
          </span>
        </button>
      ))}
    </nav>
  );
}
