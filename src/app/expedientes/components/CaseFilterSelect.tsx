'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpDown, Check, ChevronDown, RefreshCw } from 'lucide-react';

export default function CaseFilterSelect({
  label,
  value,
  options,
  onChange,
  inline = false,
  placeholder,
  sortControl = false,
  onRefresh,
  refreshing = false,
}: {
  label: string;
  value: string;
  options: { id: string; name: string }[];
  onChange: (value: string) => void;
  inline?: boolean;
  placeholder?: string;
  sortControl?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const selected =
    options.find((option) => option.id === value)?.name || placeholder || 'Seleccionar';
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div
      ref={root}
      className={inline ? '' : 'relative'}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
        if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const choices = Array.from(
            root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') || []
          );
          const current = choices.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? choices.length - 1
                : (current + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) %
                  choices.length;
          choices[next]?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={`${label}: ${selected}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        className={
          sortControl
            ? 'flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-600 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/10'
            : inline
              ? 'custom-filter-value-trigger flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-left text-sm text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-border dark:bg-card dark:text-foreground'
              : `flex min-h-8 max-w-full items-center gap-1 rounded-md border px-2.5 py-1 text-left text-xs font-normal outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/10 sm:max-w-[28rem] ${value && value !== 'all' ? 'border-primary/25 bg-primary/5 text-primary' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-border dark:bg-card dark:text-foreground'}`
        }
      >
        {sortControl ? (
          <>
            <ArrowUpDown size={14} />
            <span>Ordenar</span>
          </>
        ) : (
          <>
            <span className="min-w-0 whitespace-normal break-words">
              {inline ? (
                selected
              ) : (
                <>
                  {label}
                  {value && value !== 'all' && (
                    <span className="filter-selected-value">: {selected}</span>
                  )}
                </>
              )}
            </span>
            <ChevronDown size={inline ? 15 : 13} className="shrink-0" aria-hidden="true" />
          </>
        )}
      </button>
      {open && (
        <>
          {!inline && (
            <button
              type="button"
              aria-label={`Cerrar filtro ${label}`}
              className="fixed inset-0 z-[110] bg-slate-950/20 sm:hidden"
              onClick={() => setOpen(false)}
            />
          )}
          <div
            className={`custom-filter-value-options max-h-44 overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-sm dark:border-border dark:bg-card ${inline ? 'mt-1' : 'absolute left-0 top-full z-30 mt-1 min-w-56 max-w-80 shadow-[0_14px_35px_-20px_rgba(15,23,42,0.4)]'}`}
          >
            {sortControl && (
              <p className="px-3 py-2 text-[11px] font-semibold text-slate-500">Ordenar por</p>
            )}
            <div id={id} role="listbox" aria-label={label}>
              {options.map((option) => (
                <button
                  key={option.id}
                  role="option"
                  type="button"
                  aria-selected={value === option.id}
                  onClick={() => {
                    onChange(option.id);
                    setOpen(false);
                    trigger.current?.focus();
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm font-normal hover:bg-slate-50 dark:hover:bg-muted ${value === option.id ? 'text-primary' : 'text-slate-700 dark:text-foreground'}`}
                >
                  <span>{option.name}</span>
                  {value === option.id && <Check size={14} className="shrink-0" />}
                </button>
              ))}
            </div>
            {sortControl && onRefresh && (
              <button
                type="button"
                disabled={refreshing}
                onClick={() => {
                  onRefresh();
                  setOpen(false);
                  trigger.current?.focus();
                }}
                className="mt-1 flex w-full items-center gap-2 border-t border-slate-200 px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                Actualizar expedientes
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

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
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) root.current?.removeAttribute('open');
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return (
    <details
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          root.current?.removeAttribute('open');
          root.current?.querySelector('summary')?.focus();
        }
      }}
    >
      <summary
        aria-label={label}
        className={`flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-md border px-2.5 py-1 text-sm font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 [&::-webkit-details-marker]:hidden ${from || to ? 'border-primary/25 bg-primary/5 text-primary' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-border dark:bg-card dark:text-foreground'}`}
      >
        {label}
        {(from || to) && (
          <span className="filter-selected-value">
            : {from || 'Inicio'} – {to || 'Actual'}
          </span>
        )}
        <ChevronDown size={13} className="shrink-0" aria-hidden="true" />
      </summary>
      <div className="absolute left-0 top-full z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-lg sm:left-auto sm:right-0 dark:border-border dark:bg-card">
        <label className="block text-xs text-slate-500">
          Desde
          <input
            aria-label={`${label}: Desde`}
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => onChange(event.target.value, to)}
            className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2.5 text-sm dark:bg-card"
          />
        </label>
        <label className="block text-xs text-slate-500">
          Hasta
          <input
            aria-label={`${label}: Hasta`}
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => onChange(from, event.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2.5 text-sm dark:bg-card"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            onChange('', '');
            root.current?.removeAttribute('open');
          }}
          className="text-xs text-primary"
        >
          Limpiar fechas
        </button>
      </div>
    </details>
  );
}
