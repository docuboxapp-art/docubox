'use client';

import React from 'react';
import { ChevronDown } from 'lucide-react';

export const inputClass =
  'h-9 w-full rounded-md border border-[#E2E8F0] bg-white px-3 text-xs text-[#0F172A] outline-none transition focus:border-[#1E6BFF] focus:ring-2 focus:ring-[#1E6BFF]/10 dark:border-border dark:bg-background dark:text-foreground';

export function PanelSection({
  title,
  icon: Icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon?: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const contentId = React.useId();
  return (
    <section>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((current) => !current)}
          className={`form-property-section-trigger flex w-full items-center gap-2 border-b border-[#E2E8F0] pb-2 text-left font-semibold uppercase text-[#64748B] transition-colors hover:text-[#1E6BFF] focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1E6BFF] dark:border-border ${open ? 'mb-3' : ''}`}
        >
          {Icon && <Icon size={13} />}
          <span className="flex-1">{title}</span>
          <ChevronDown size={14} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
      </h3>
      <div id={contentId} hidden={!open} className="space-y-3">{children}</div>
    </section>
  );
}

export function Input({
  label,
  value,
  onChange,
  multiline,
  mono,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  mono?: boolean;
  maxLength?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium text-[#475569] dark:text-muted-foreground">
        {label}
      </span>
      {multiline ? (
        <textarea
          rows={3}
          value={value}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
          className={`${inputClass} h-auto resize-none py-2 ${mono ? 'font-mono' : ''}`}
        />
      ) : (
        <input
          value={value}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
          className={`${inputClass} ${mono ? 'font-mono' : ''}`}
        />
      )}
    </label>
  );
}

export function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: number;
  onChange: (value?: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium text-[#475569] dark:text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : undefined)}
        className={inputClass}
      />
    </label>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium text-[#475569] dark:text-muted-foreground">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      >
        <option value="">Seleccionar</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-0.5">
      <span className="text-xs text-[#334155] dark:text-foreground">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span className="relative h-5 w-9 flex-shrink-0 rounded-full bg-[#CBD5E1] transition peer-checked:bg-[#1E6BFF] after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition peer-checked:after:translate-x-4" />
    </label>
  );
}

export function ReadOnlyValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="mb-1 block text-[11px] font-medium text-[#475569] dark:text-muted-foreground">
        {label}
      </span>
      <div className="rounded-md border border-[#E2E8F0] bg-[#F6F8FB] px-3 py-2 text-xs text-[#475569] dark:border-border dark:bg-muted dark:text-muted-foreground">
        {value}
      </div>
    </div>
  );
}
