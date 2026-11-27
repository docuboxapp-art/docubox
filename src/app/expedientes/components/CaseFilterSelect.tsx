'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

export { default } from '@/components/WorkspaceTableToolbarSelect';

export function CaseDateRangeFilter({
  label,
  from,
  to,
  onChange,
}: {
  label: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const root = useRef<HTMLDetailsElement>(null);
  const [draft, setDraft] = useState({ from, to });
  const active = Boolean(from || to);
  const close = () => {
    root.current?.removeAttribute('open');
    root.current?.querySelector('summary')?.focus();
  };
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) root.current?.removeAttribute('open');
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return (
    <div
      className={`group relative flex min-h-[34px] items-center rounded-md border ${active ? 'border-primary/25 bg-primary/5 text-primary' : 'border-border bg-card hover:bg-muted/50'}`}
    >
      <details
        ref={root}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            close();
          }
        }}
      >
        <summary
          aria-label={label}
          data-active={active}
          onClick={() => {
            if (!root.current?.open) setDraft({ from, to });
          }}
          className="workspace-filter-trigger flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-md px-2.5 py-1 focus-visible:outline-primary [&::-webkit-details-marker]:hidden"
        >
          {label}
          {active && (
            <span className="filter-selected-value">
              : {from || 'Inicio'} – {to || 'Actual'}
            </span>
          )}
          <ChevronDown size={13} className="shrink-0" aria-hidden="true" />
        </summary>
        <div className="absolute left-0 top-full z-40 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-3 shadow-lg sm:left-auto sm:right-0">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              onChange(draft.from, draft.to);
              close();
            }}
          >
            <label className="block text-xs text-muted-foreground">
              Desde
              <input
                aria-label={`${label}: Desde`}
                type="date"
                value={draft.from}
                max={draft.to || undefined}
                onChange={(event) => setDraft({ ...draft, from: event.target.value })}
                className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2.5 text-sm text-foreground"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              Hasta
              <input
                aria-label={`${label}: Hasta`}
                type="date"
                value={draft.to}
                min={draft.from || undefined}
                onChange={(event) => setDraft({ ...draft, to: event.target.value })}
                className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2.5 text-sm text-foreground"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="h-8 rounded-md border border-border px-2 text-foreground"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="h-8 rounded-md bg-primary px-2 text-primary-foreground"
              >
                Aplicar
              </button>
            </div>
          </form>
        </div>
      </details>
      {active && (
        <button
          type="button"
          aria-label={`Quitar filtro ${label}`}
          onClick={() => {
            onChange('', '');
            close();
          }}
          className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded opacity-0 hover:bg-primary/10 focus:opacity-100 group-hover:opacity-100"
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
