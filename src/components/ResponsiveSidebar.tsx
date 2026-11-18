'use client';

import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';

/** One content tree: saved filters and folders keep their state when the panel collapses. */
export default function ResponsiveSidebar({
  children,
  label,
  className = '',
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <aside aria-label={label} className={`responsive-sidebar ${className}`}>
      <button
        type="button"
        className="responsive-sidebar-trigger"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <span className="flex items-center gap-2.5">
          <SlidersHorizontal size={18} className="text-primary" />
          {label}
        </span>
        <ChevronDown size={17} className={open ? 'rotate-180' : ''} />
      </button>
      <div id={id} className={`responsive-sidebar-content ${open ? 'is-open' : ''}`}>
        {children}
      </div>
    </aside>
  );
}
