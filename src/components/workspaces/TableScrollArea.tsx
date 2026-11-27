'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import TablePagination, { useTablePagination } from './TablePagination';

export default function TableScrollArea({
  children,
  label,
  className = '',
  footer,
}: {
  children: ReactNode;
  label: string;
  className?: string;
  footer?: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const viewportId = useId();
  const [scroll, setScroll] = useState({ left: 0, max: 0 });

  const sync = useCallback(() => {
    const area = viewport.current;
    if (!area) return;
    const max = Math.max(0, area.scrollWidth - area.clientWidth);
    const left = Math.max(0, Math.min(max, Math.round(area.scrollLeft)));
    setScroll((previous) =>
      previous.left === left && previous.max === max ? previous : { left, max }
    );
  }, []);

  useEffect(() => {
    const area = viewport.current;
    if (!area) return;
    const observer = new ResizeObserver(sync);
    observer.observe(area);
    if (area.firstElementChild) observer.observe(area.firstElementChild);
    return () => observer.disconnect();
  }, [sync]);

  function scrollTo(left: number) {
    if (!viewport.current) return;
    viewport.current.scrollLeft = left;
    sync();
  }

  return (
    <div className={`min-w-0 ${className}`}>
      <div
        id={viewportId}
        ref={viewport}
        role="region"
        aria-label={label}
        tabIndex={scroll.max > 0 ? 0 : undefined}
        onScroll={sync}
        className={`min-w-0 overflow-x-auto overscroll-x-contain focus-visible:outline-primary ${
          scroll.max > 0 ? '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden' : ''
        }`}
      >
        {children}
      </div>
      {scroll.max > 0 && (
        <label className="flex items-center gap-2.5 border-t border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          <ArrowLeftRight size={14} className="shrink-0" aria-hidden="true" />
          <span className="shrink-0">Desplazar columnas</span>
          <input
            type="range"
            min={0}
            max={scroll.max}
            value={scroll.left}
            aria-controls={viewportId}
            className="workspace-table-scroll-control h-5 min-w-0 flex-1 cursor-ew-resize rounded-sm accent-primary focus-visible:outline-1 focus-visible:outline-primary"
            onChange={(event) => scrollTo(event.currentTarget.valueAsNumber)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const direction = event.key === 'ArrowRight' ? 1 : -1;
              scrollTo((viewport.current?.scrollLeft ?? 0) + direction * 48);
            }}
          />
        </label>
      )}
      {footer}
    </div>
  );
}

export function PaginatedTableScrollArea<T>({
  items,
  children,
  label,
  className,
  resetKey,
}: {
  items: readonly T[];
  children: (pageItems: T[]) => ReactNode;
  label: string;
  className?: string;
  resetKey?: string;
}) {
  const pagination = useTablePagination(items.length, resetKey);
  return (
    <TableScrollArea
      label={label}
      className={className}
      footer={<TablePagination {...pagination} />}
    >
      {children(items.slice(pagination.start, pagination.end))}
    </TableScrollArea>
  );
}
