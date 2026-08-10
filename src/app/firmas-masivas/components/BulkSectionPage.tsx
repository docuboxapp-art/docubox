'use client';

import { ArrowRight, type LucideIcon } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { BulkSignaturesHeader, BulkSignaturesWorkspace } from './BulkSignaturesUI';

export interface BulkSectionAction {
  title: string;
  description: string;
  icon: LucideIcon;
  status?: string;
}

export function BulkSectionPage({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions: BulkSectionAction[];
}) {
  return (
    <AppLayout noPadding>
      <BulkSignaturesWorkspace>
        <BulkSignaturesHeader title={title} description={description} />
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card">
          <div className="grid divide-y divide-slate-200 dark:divide-border">
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.title}
                  className="flex items-center gap-4 p-4 text-left transition hover:bg-slate-50 dark:hover:bg-muted/20 sm:p-5"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-blue-100 bg-blue-50 text-primary dark:border-blue-900 dark:bg-blue-950/30">
                    <Icon size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-600 text-slate-950 dark:text-foreground">
                        {action.title}
                      </span>
                      {action.status && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-600 text-slate-600">
                          {action.status}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-sm text-slate-500">{action.description}</span>
                  </span>
                  <ArrowRight size={16} className="shrink-0 text-slate-400" />
                </button>
              );
            })}
          </div>
        </section>
      </BulkSignaturesWorkspace>
    </AppLayout>
  );
}
