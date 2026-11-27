'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpDown, Check, ChevronDown, RefreshCw, X } from 'lucide-react';

export default function WorkspaceTableToolbarSelect({
  label,
  value,
  options,
  onChange,
  onClear,
  emptyValue = 'all',
  inline = false,
  placeholder,
  sortControl = false,
  onRefresh,
  refreshing = false,
}: {
  label: string;
  value: string | string[];
  options: { id: string; name: string }[];
  onChange: (value: string) => void;
  onClear?: () => void;
  emptyValue?: string;
  inline?: boolean;
  placeholder?: string;
  sortControl?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const [alignment, setAlignment] = useState<'left' | 'right' | null>(null);
  const open = alignment !== null;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const multiple = Array.isArray(value);
  const active = multiple ? value.length > 0 : Boolean(value && value !== emptyValue);
  const selected = multiple
    ? value.length === 1
      ? (options.find((option) => option.id === value[0])?.name ?? value[0])
      : `${value.length} seleccionados`
    : options.find((option) => option.id === value)?.name || placeholder || 'Seleccionar';
  const [search, setSearch] = useState('');
  const showSearch = !sortControl && !inline && options.length > 6;
  const matchingOptions = showSearch
    ? options.filter((option) =>
        option.name.toLocaleLowerCase('es-MX').includes(search.trim().toLocaleLowerCase('es-MX'))
      )
    : options;
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setAlignment(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div
      ref={root}
      className={inline ? '' : 'relative min-w-0 max-w-full'}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setAlignment(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setAlignment(null);
          trigger.current?.focus();
        }
        if (
          open &&
          !(event.target instanceof HTMLInputElement) &&
          ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
        ) {
          event.preventDefault();
          const choices = Array.from(
            root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') || []
          );
          const current = choices.indexOf(document.activeElement as HTMLButtonElement);
          const backward = event.key === 'ArrowUp';
          const from = current === -1 && backward ? 0 : current;
          const step = backward ? -1 : 1;
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? choices.length - 1
                : (from + step + choices.length) % choices.length;
          choices[next]?.focus();
        }
      }}
    >
      <div
        className={`group flex min-w-0 items-center ${!inline && !sortControl ? `rounded-md border ${active ? 'border-primary/25 bg-primary/5 text-primary' : 'border-border bg-card hover:bg-muted/50'}` : ''}`}
      >
        <button
          ref={trigger}
          type="button"
          aria-label={`${label}: ${selected}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          data-active={!sortControl && !inline ? active : undefined}
          onClick={(event) => {
            if (open) {
              setAlignment(null);
              return;
            }
            setSearch('');
            const { left, right } = event.currentTarget.getBoundingClientRect();
            const fitsOnRight = left + 320 <= window.innerWidth;
            const fitsOnLeft = right >= 320;
            const alignRight = fitsOnLeft && (sortControl || !fitsOnRight);
            setAlignment(alignRight ? 'right' : 'left');
          }}
          className={
            sortControl
              ? 'flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-card px-3 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-muted/50 dark:border-border dark:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/10'
              : inline
                ? 'custom-filter-value-trigger flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-left text-sm text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-border dark:bg-card dark:text-foreground'
                : 'workspace-filter-trigger flex min-h-8 min-w-0 items-center gap-1 rounded-md px-2.5 py-1 text-left font-normal focus-visible:outline-primary sm:max-w-[28rem]'
          }
        >
          {sortControl ? (
            <>
              <ArrowUpDown size={14} aria-hidden="true" />
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
                    {active && <span className="filter-selected-value">: {selected}</span>}
                  </>
                )}
              </span>
              <ChevronDown size={inline ? 15 : 13} className="shrink-0" aria-hidden="true" />
            </>
          )}
        </button>
        {onClear && active && !sortControl && !inline && (
          <button
            type="button"
            onClick={() => {
              setAlignment(null);
              trigger.current?.focus();
              onClear();
            }}
            aria-label={`Quitar filtro ${label}`}
            title={`Quitar filtro ${label}`}
            className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded opacity-0 transition-opacity hover:bg-primary/10 focus:opacity-100 group-hover:opacity-100"
          >
            <X size={12} aria-hidden="true" />
          </button>
        )}
      </div>
      {open && (
        <>
          {!inline && (
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Cerrar filtro ${label}`}
              className="fixed inset-0 z-[110] bg-slate-950/20 sm:hidden"
              onClick={() => setAlignment(null)}
            />
          )}
          <div
            className={`custom-filter-value-options ${sortControl ? 'max-h-80' : 'max-h-44'} overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-sm dark:border-border dark:bg-card ${inline ? 'mt-1' : 'absolute top-full z-40 mt-1 w-max min-w-56 max-w-80 shadow-[0_14px_35px_-20px_rgba(15,23,42,0.4)]'} ${!inline && alignment === 'right' ? 'right-0' : 'left-0'}`}
          >
            {sortControl && (
              <p className="px-3 py-2 text-[11px] font-semibold text-slate-500">Ordenar por</p>
            )}
            {showSearch && (
              <input
                type="search"
                aria-label={`Buscar opciones de ${label}`}
                placeholder="Buscar opciones..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="mb-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm focus-visible:outline-primary"
              />
            )}
            {multiple && (
              <button
                type="button"
                data-selected={!active}
                onClick={() => {
                  setAlignment(null);
                  trigger.current?.focus();
                  onClear?.();
                }}
                className="workspace-filter-option w-full rounded px-2 py-1.5 text-left hover:bg-muted"
              >
                Todos
              </button>
            )}
            <div
              id={id}
              role="listbox"
              aria-label={label}
              aria-multiselectable={multiple || undefined}
            >
              {matchingOptions.map((option) => {
                const chosen = multiple ? value.includes(option.id) : value === option.id;
                return (
                  <button
                    key={option.id}
                    role="option"
                    type="button"
                    aria-selected={chosen}
                    onClick={() => {
                      onChange(option.id);
                      if (!multiple) {
                        setAlignment(null);
                        trigger.current?.focus();
                      }
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left font-normal hover:bg-muted ${sortControl ? (chosen ? 'text-primary' : 'text-slate-700 dark:text-foreground') : 'workspace-filter-option'}`}
                  >
                    <span>{option.name}</span>
                    {chosen && <Check size={14} className="shrink-0" />}
                  </button>
                );
              })}
            </div>
            {matchingOptions.length === 0 && (
              <p className="p-2 text-sm text-muted-foreground">Sin opciones</p>
            )}
            {sortControl && onRefresh && (
              <button
                type="button"
                disabled={refreshing}
                onClick={() => {
                  onRefresh();
                  setAlignment(null);
                  trigger.current?.focus();
                }}
                className="mt-1 flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-slate-600 hover:bg-muted/50 disabled:opacity-50 dark:text-muted-foreground"
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
