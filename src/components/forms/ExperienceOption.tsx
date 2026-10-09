'use client';

import { useId } from 'react';
import { Info } from 'lucide-react';

export function InfoTooltip({ label, description }: { label: string; description: string }) {
  const tooltipId = useId();

  return (
    <span className="group relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={`Información sobre ${label}`}
        aria-describedby={tooltipId}
        className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:text-foreground"
      >
        <Info size={14} aria-hidden="true" />
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full right-0 z-30 mb-2 w-56 rounded-md bg-slate-900 px-3 py-2 text-left text-xs leading-5 text-white opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 dark:bg-slate-700"
      >
        {description}
      </span>
    </span>
  );
}

export function ExperienceOption({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const inputId = useId();

  return (
    <div className="flex min-h-12 items-center gap-1 py-2.5 first:pt-0">
      <label htmlFor={inputId} className="min-w-0 flex-1 cursor-pointer text-sm font-medium text-slate-700 dark:text-foreground">
        {title}
      </label>
      {description && <InfoTooltip label={title} description={description} />}
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="ml-1 h-4 w-4 shrink-0 cursor-pointer accent-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      />
    </div>
  );
}
