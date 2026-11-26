'use client';

import { ChevronDown, Loader2, Search } from 'lucide-react';
import type { SearchCriterion } from '@/lib/profile-privacy/model';

export type ParticipantSearchCriterion = Exclude<SearchCriterion, 'nombre'>;

const criteria = {
  correo: { label: 'Correo electrónico', placeholder: 'ejemplo@correo.com', length: 254 },
  telefono: { label: 'Teléfono', placeholder: '5512345678', length: 10 },
  rfc: { label: 'RFC', placeholder: 'AAAA000000AAA', length: 13 },
  curp: { label: 'CURP', placeholder: 'AAAA000000XXXXXXXX', length: 18 },
};

export function ParticipantSearchFields({
  criterion,
  value,
  searching,
  onCriterion,
  onValue,
  onSearch,
}: {
  criterion: ParticipantSearchCriterion;
  value: string;
  searching: boolean;
  onCriterion: (value: ParticipantSearchCriterion) => void;
  onValue: (value: string) => void;
  onSearch: () => void;
}) {
  const field = criteria[criterion];
  const submit = () => {
    if (!searching && value.trim()) onSearch();
  };
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(8rem,auto)_minmax(0,1fr)_auto]">
      <div className="relative col-span-2 min-w-0 sm:col-span-1">
        <select
          aria-label="Buscar por"
          value={criterion}
          onChange={(event) => onCriterion(event.target.value as ParticipantSearchCriterion)}
          className="h-10 w-full appearance-none rounded-lg border border-border bg-card pl-3 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/35"
        >
          {Object.entries(criteria).map(([id, option]) => (
            <option key={id} value={id}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={15}
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
      </div>
      <input
        aria-label={field.label}
        type={criterion === 'correo' ? 'email' : criterion === 'telefono' ? 'tel' : 'text'}
        value={value}
        maxLength={field.length}
        placeholder={field.placeholder}
        autoComplete="off"
        onChange={(event) => {
          const input = event.target.value;
          onValue(
            criterion === 'correo'
              ? input
              : criterion === 'telefono'
                ? input.replace(/\D/g, '').slice(0, field.length)
                : input
                    .toUpperCase()
                    .replace(/[^A-Z0-9Ñ&]/g, '')
                    .slice(0, field.length)
          );
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        }}
        className="h-10 w-full min-w-0 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/35"
      />
      <button
        type="button"
        title="Buscar"
        aria-label="Buscar"
        disabled={!value.trim() || searching}
        onClick={submit}
        className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:opacity-50"
      >
        {searching ? (
          <Loader2 size={17} className="animate-spin" aria-hidden="true" />
        ) : (
          <Search size={17} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
