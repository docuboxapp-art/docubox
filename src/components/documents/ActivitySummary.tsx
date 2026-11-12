'use client';

import { ChevronDown, ChevronUp, type LucideIcon } from 'lucide-react';
import { useState } from 'react';

type MetricTone = 'blue' | 'amber' | 'emerald' | 'indigo';

export interface ActivitySummaryMetric {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: MetricTone;
}

const metricTones: Record<MetricTone, string> = {
  blue: 'bg-blue-50 text-blue-600',
  amber: 'bg-amber-50 text-amber-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  indigo: 'bg-indigo-50 text-indigo-600',
};

export function ActivitySummary({
  id,
  title,
  description,
  metrics,
}: {
  id: string;
  title: string;
  description: string;
  metrics: ActivitySummaryMetric[];
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className={`flex items-center justify-between gap-3 px-5 py-4 ${expanded ? 'border-b border-slate-200' : ''}`}>
        <div>
          <span className="block text-sm font-600 text-slate-950">{title}</span>
          <span className="mt-0.5 block text-xs text-slate-500">{description}</span>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={id}
          aria-label={expanded ? `Contraer ${title.toLowerCase()}` : `Expandir ${title.toLowerCase()}`}
          title={expanded ? 'Contraer resumen' : 'Expandir resumen'}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {expanded ? <ChevronUp size={17} aria-hidden="true" /> : <ChevronDown size={17} aria-hidden="true" />}
        </button>
      </div>
      <div
        id={id}
        className={`${expanded ? 'grid' : 'hidden'} grid-cols-2 divide-x divide-y divide-slate-200 lg:grid-cols-4 lg:divide-y-0`}
      >
        {metrics.map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="flex min-h-24 min-w-0 items-center gap-3 px-5 py-4">
            <span
              className={'flex h-9 w-9 shrink-0 items-center justify-center rounded-md ' + metricTones[tone]}
            >
              <Icon size={17} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-xl font-600 tabular-nums text-slate-950">{value}</span>
              <span className="block text-xs text-slate-500">{label}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
