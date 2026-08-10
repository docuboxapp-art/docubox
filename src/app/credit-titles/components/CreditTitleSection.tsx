'use client';

import { ArrowRight, type LucideIcon } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { CreditTitlesHeader, CreditTitlesWorkspace } from './CreditTitlesUI';

export function CreditTitleSection({
  title,
  description,
  icon: Icon,
  items,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  items: Array<{ title: string; detail: string; status: string }>;
}) {
  return (
    <AppLayout noPadding>
      <CreditTitlesWorkspace>
        <CreditTitlesHeader title={title} description={description} />
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card">
          <header className="border-b border-slate-200 px-5 py-4 dark:border-border">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-indigo-50 text-indigo-700">
                <Icon size={17} />
              </span>
              <div>
                <h2 className="text-sm font-600">Arquitectura preparada</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Las operaciones se habilitaran por fase y permiso.
                </p>
              </div>
            </div>
          </header>
          <div className="divide-y divide-slate-200 dark:divide-border">
            {items.map((item) => (
              <div key={item.title} className="flex items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-600">{item.title}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{item.detail}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-600 text-slate-600">
                  {item.status}
                </span>
                <ArrowRight size={15} className="text-slate-300" />
              </div>
            ))}
          </div>
        </section>
      </CreditTitlesWorkspace>
    </AppLayout>
  );
}
