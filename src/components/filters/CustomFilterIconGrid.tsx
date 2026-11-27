import { useEffect, useRef } from 'react';
import { CUSTOM_FILTER_ICON_OPTIONS } from '@/lib/filters/custom-filter-icons';

export function CustomFilterIconGrid({
  value,
  onSelect,
}: {
  value: string;
  onSelect: (icon: (typeof CUSTOM_FILTER_ICON_OPTIONS)[number]) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const grid = ref.current;
      const selected = grid?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
      if (grid && selected) {
        grid.scrollTop = Math.max(
          0,
          selected.offsetTop + selected.offsetHeight - grid.clientHeight
        );
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      ref={ref}
      role="group"
      aria-label="Iconos disponibles"
      className="custom-filter-icon-picker relative grid max-h-60 grid-cols-8 gap-2 overflow-y-auto pr-1 sm:grid-cols-10"
    >
      {CUSTOM_FILTER_ICON_OPTIONS.map((icon) => (
        <button
          key={icon}
          type="button"
          aria-label={`Usar ícono ${icon}`}
          aria-pressed={value === icon}
          onClick={() => onSelect(icon)}
          className={`custom-filter-icon-option flex aspect-square w-full items-center justify-center rounded-md border transition-colors focus-visible:outline-primary ${value === icon ? 'border-primary bg-primary/10' : 'border-slate-200 hover:border-primary/40 hover:bg-slate-50 dark:border-border dark:hover:bg-muted'}`}
        >
          <span aria-hidden="true">{icon}</span>
        </button>
      ))}
    </div>
  );
}
