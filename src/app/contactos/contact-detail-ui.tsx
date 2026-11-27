'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export const contactCard = 'rounded-lg border border-border bg-card shadow-sm';
export const contactControl =
  'min-h-9 rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15';
export const contactButton =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:border-primary/35 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50';
export const contactPrimaryButton =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:opacity-50';

export function ContactPanelHeading({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border px-4 py-3">
      <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
        <Icon size={17} className="shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 [overflow-wrap:anywhere]">{title}</span>
      </h2>
      {children}
    </div>
  );
}

export { EditorDialog as ContactEditorDialog } from '@/components/ui/EditorDialog';
