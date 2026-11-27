'use client';

import { Check } from 'lucide-react';
import { catalogColors, validCatalogColor } from '@/lib/catalog/classification';

export function CatalogColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Color de la etiqueta</legend>
      <div className="flex flex-wrap items-center gap-2">
        {catalogColors.map(([color, name]) => (
          <button
            key={color}
            type="button"
            aria-pressed={color === value}
            aria-label={name}
            title={name}
            onClick={() => onChange(color)}
            style={{ backgroundColor: color }}
            className="grid size-8 place-items-center rounded-full text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {color === value && <Check size={16} aria-hidden="true" />}
          </button>
        ))}
        <input
          type="color"
          aria-label="Elegir otro color"
          value={validCatalogColor(value)}
          onChange={(event) => onChange(event.target.value)}
          className="size-8 cursor-pointer rounded-md border border-border bg-card p-0.5"
        />
      </div>
    </fieldset>
  );
}
