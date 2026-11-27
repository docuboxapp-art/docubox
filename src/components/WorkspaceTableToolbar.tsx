'use client';

import { useId, useRef, type ReactNode } from 'react';
import { ChevronDown, Filter, LayoutGrid, LayoutList, Search, X } from 'lucide-react';
import ResponsiveFilterBar from './ResponsiveFilterBar';
import WorkspaceTableToolbarSelect from './WorkspaceTableToolbarSelect';

type FilterOption = { id: string; name: string };
type AppliedCriterion = { label: string; clear: () => void };

export type WorkspaceTableFilter = {
  label: string;
  value: string | string[];
  options: FilterOption[];
  change: (value: string) => void;
  clear: () => void;
};

export function tableFilter<T extends string>(
  label: string,
  value: T,
  options: { id: T; name: string }[],
  change: (value: T) => void,
  empty: T
): WorkspaceTableFilter {
  return { label, value, options, change: (id) => change(id as T), clear: () => change(empty) };
}

export default function WorkspaceTableToolbar({
  label,
  searchLabel,
  query,
  onQueryChange,
  controls,
  filters,
  filterDefinitions,
  applied = [],
  onClearFilters,
}: {
  label: string;
  searchLabel: string;
  query: string;
  onQueryChange: (query: string) => void;
  controls: ReactNode;
  filters?: ReactNode;
  filterDefinitions?: WorkspaceTableFilter[];
  applied?: AppliedCriterion[];
  onClearFilters?: () => void;
}) {
  const criteria = [
    ...applied,
    ...(filterDefinitions ?? []).flatMap(
      ({ label: filterLabel, value, options, change, clear }) => {
        const values = Array.isArray(value) ? value : value && value !== 'all' ? [value] : [];
        return values.map((id) => ({
          label: `${filterLabel}: ${options.find((option) => option.id === id)?.name ?? id}`,
          clear: Array.isArray(value) ? () => change(id) : clear,
        }));
      }
    ),
  ];

  return (
    <section
      aria-label={label}
      className="workspace-table-toolbar relative mb-3 rounded-lg border border-border bg-card shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-0 basis-full sm:min-w-40 sm:flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label={searchLabel}
            placeholder={`${searchLabel}...`}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="h-9 w-full rounded-md border border-border bg-slate-50/70 pl-9 pr-3 text-sm font-normal text-foreground outline-none transition-colors placeholder:text-slate-400 focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/10 dark:bg-background"
          />
        </div>
        {criteria.length > 0 && onClearFilters && (
          <AppliedFilters criteria={criteria} onClear={onClearFilters} />
        )}
        {controls}
      </div>
      {filters || filterDefinitions?.length ? (
        <ResponsiveFilterBar count={criteria.length}>
          <div className="mis-documentos-filters flex flex-wrap items-center gap-2 rounded-b-lg border-t border-border/70 bg-muted/40 px-3 py-2.5">
            {filterDefinitions?.map(({ label: filterLabel, value, options, change, clear }) => (
              <WorkspaceTableToolbarSelect
                key={filterLabel}
                label={filterLabel}
                value={value}
                options={options}
                onChange={change}
                onClear={clear}
              />
            ))}
            {filters}
          </div>
        </ResponsiveFilterBar>
      ) : null}
    </section>
  );
}

function AppliedFilters({
  criteria,
  onClear,
}: {
  criteria: AppliedCriterion[];
  onClear: () => void;
}) {
  const panel = useRef<HTMLDetailsElement>(null);
  const id = useId();

  return (
    <div className="relative flex h-9 items-center rounded-md border border-primary/25 bg-card text-primary">
      <details
        ref={panel}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            panel.current?.removeAttribute('open');
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            panel.current?.removeAttribute('open');
            panel.current?.querySelector('summary')?.focus();
          }
        }}
      >
        <summary
          aria-controls={id}
          aria-label={`Filtros aplicados: ${criteria.length}. Ver criterios`}
          data-active="true"
          className="workspace-filter-pill workspace-filter-trigger flex h-8 cursor-pointer list-none items-center gap-1.5 px-2.5 [&::-webkit-details-marker]:hidden"
        >
          <Filter size={13} aria-hidden="true" />
          <span>Filtros aplicados</span>
          <span className="filter-selected-value">({criteria.length})</span>
          <ChevronDown size={13} aria-hidden="true" />
        </summary>
        <div
          id={id}
          role="group"
          aria-label="Criterios aplicados"
          className="absolute left-0 top-full z-50 mt-1 max-h-72 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-border bg-card p-1.5 shadow-lg sm:left-auto sm:right-0"
        >
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Criterios aplicados</p>
          {criteria.map((criterion) => (
            <div
              key={criterion.label}
              className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground hover:bg-muted"
            >
              <span className="min-w-0 flex-1 break-words">{criterion.label}</span>
              <button
                type="button"
                aria-label={`Quitar ${criterion.label}`}
                onClick={() => {
                  panel.current?.querySelector('summary')?.focus();
                  criterion.clear();
                }}
                className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-background"
              >
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      </details>
      <button
        type="button"
        aria-label="Quitar todos los filtros"
        title="Quitar todos los filtros"
        onClick={() => {
          panel.current?.removeAttribute('open');
          onClear();
        }}
        className="grid h-7 w-7 shrink-0 place-items-center border-l border-primary/25 hover:bg-primary/5"
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

export function WorkspaceTableViewToggle({
  value,
  onChange,
}: {
  value: 'list' | 'grid';
  onChange: (value: 'list' | 'grid') => void;
}) {
  const options = [
    { id: 'list', label: 'Vista en lista', Icon: LayoutList },
    { id: 'grid', label: 'Vista en cuadrícula', Icon: LayoutGrid },
  ] as const;

  return (
    <div
      role="group"
      aria-label="Tipo de vista"
      className="flex h-9 shrink-0 items-center rounded-md border border-border bg-card p-0.5"
    >
      {options.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          aria-label={label}
          aria-pressed={value === id}
          title={label}
          onClick={() => onChange(id)}
          className={`flex h-7 w-8 items-center justify-center rounded transition-colors ${value === id ? 'bg-muted text-foreground' : 'text-slate-400 hover:bg-muted/60 hover:text-foreground'}`}
        >
          <Icon size={16} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
