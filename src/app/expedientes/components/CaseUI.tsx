'use client';

import type { ReactNode } from 'react';
import { Archive, type LucideIcon } from 'lucide-react';
import { CASE_STATUS_META, type CaseFileStatus, type TrafficLight } from '@/lib/case-files/schema';

const toneClasses: Record<TrafficLight, { badge: string; dot: string; bar: string }> = {
  green: { badge: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
  amber: { badge: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500', bar: 'bg-amber-500' },
  red: { badge: 'border-red-200 bg-red-50 text-red-700', dot: 'bg-red-500', bar: 'bg-red-500' },
  gray: { badge: 'border-slate-200 bg-slate-50 text-slate-600', dot: 'bg-slate-400', bar: 'bg-slate-400' },
};

export function CaseWorkspace({ children }: { children: ReactNode }) {
  return (
    <div className="app-page-bleed app-page-frame bg-[#f6f8fb] text-slate-950 dark:bg-background dark:text-foreground">
      <main className="app-page-width">
        {children}
      </main>
    </div>
  );
}

export function CaseStatusBadge({ status }: { status: CaseFileStatus }) {
  const meta = CASE_STATUS_META[status];
  return (
    <span className={`inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${toneClasses[meta.tone].badge}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneClasses[meta.tone].dot}`} />
      {meta.label}
    </span>
  );
}

export function TrafficBadge({ tone, children }: { tone: TrafficLight; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${toneClasses[tone].badge}`}><span className={`h-1.5 w-1.5 rounded-full ${toneClasses[tone].dot}`} />{children}</span>;
}

export function ProgressBar({ value, compact = false }: { value: number; compact?: boolean }) {
  const tone: TrafficLight = value >= 85 ? 'green' : value >= 45 ? 'amber' : 'red';
  return <div className={compact ? 'w-28' : 'w-full'}><div className="mb-1.5 flex items-center justify-between text-xs"><span className="font-semibold text-slate-700 dark:text-zinc-200">{value}%</span>{!compact && <span className="text-slate-500">completado</span>}</div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-zinc-800"><div className={`h-full rounded-full transition-all ${toneClasses[tone].bar}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div></div>;
}

export function SectionHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="mb-4 flex flex-col gap-3 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-end sm:justify-between dark:border-border"><div className="min-w-0"><h1 className="text-2xl font-600 text-slate-950 dark:text-foreground">{title}</h1><p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">{description}</p></div>{action && <div className="flex shrink-0 items-center gap-2">{action}</div>}</div>;
}

export function MetricCard({ label, value, detail, tone = 'gray', icon: Icon }: { label: string; value: string | number; detail: string; tone?: TrafficLight; icon: LucideIcon }) {
  const iconTone: Record<TrafficLight, string> = {
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-600',
    gray: 'bg-slate-100 text-slate-600',
  };
  return <div className="flex min-h-24 min-w-0 items-center gap-3 px-5 py-4"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${iconTone[tone]}`}><Icon size={17} aria-hidden="true" /></span><span className="min-w-0"><span className="block text-xl font-semibold tabular-nums text-slate-950 dark:text-foreground">{value}</span><span className="block text-xs text-slate-500 dark:text-muted-foreground">{label}</span><span className="mt-0.5 block text-[11px] text-slate-400">{detail}</span></span></div>;
}

export function HumanEmpty({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center"><span className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-primary"><Archive size={20} /></span><h3 className="text-sm font-semibold text-slate-950 dark:text-foreground">{title}</h3><p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">{message}</p>{action && <div className="mt-4">{action}</div>}</div>;
}
