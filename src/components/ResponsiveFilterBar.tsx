'use client';

import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, Filter } from 'lucide-react';

export default function ResponsiveFilterBar({
  children,
  count = 0,
}: {
  children: ReactNode;
  count?: number;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="responsive-filter-group">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex min-h-12 w-full items-center justify-between border-t border-border px-3 text-sm text-muted-foreground lg:hidden"
      >
        <span className="flex items-center gap-2">
          <Filter size={16} />
          Filtros
          {count > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {count} activos
            </span>
          )}
        </span>
        <ChevronDown size={15} className={open ? 'rotate-180' : ''} />
      </button>
      <div id={id} className={open ? 'block lg:contents' : 'hidden lg:contents'}>
        {children}
      </div>
    </div>
  );
}
