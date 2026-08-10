'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Archive, ClipboardCheck, FileCheck2, FolderKanban, History, LayoutTemplate } from 'lucide-react';
import { CASE_STATUS_META, type CaseFileStatus, type TrafficLight } from '@/lib/case-files/schema';

const toneClasses: Record<TrafficLight, { badge: string; dot: string; bar: string }> = {
  green: { badge: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
  amber: { badge: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500', bar: 'bg-amber-500' },
  red: { badge: 'border-red-200 bg-red-50 text-red-700', dot: 'bg-red-500', bar: 'bg-red-500' },
  gray: { badge: 'border-slate-200 bg-slate-50 text-slate-600', dot: 'bg-slate-400', bar: 'bg-slate-400' },
};

export function CaseWorkspace({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-4 -my-4 flex min-h-[calc(100vh-104px)] bg-[#f6f8fb] text-slate-950 dark:bg-background dark:text-foreground md:-my-6">
      <CaseModuleNav />
      <main className="min-w-0 flex-1 overflow-auto px-4 pb-5 pt-4 sm:px-5 lg:px-6 xl:px-7">
        <div className="mx-auto w-full max-w-[1600px]">{children}</div>
      </main>
    </div>
  );
}

export function CaseStatusBadge({ status }: { status: CaseFileStatus }) {
  const meta = CASE_STATUS_META[status];
  return <span className={`inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium ${toneClasses[meta.tone].badge}`}><span className={`h-1.5 w-1.5 rounded-full ${toneClasses[meta.tone].dot}`} />{meta.label}</span>;
}

export function TrafficBadge({ tone, children }: { tone: TrafficLight; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${toneClasses[tone].badge}`}><span className={`h-1.5 w-1.5 rounded-full ${toneClasses[tone].dot}`} />{children}</span>;
}

export function ProgressBar({ value, compact = false }: { value: number; compact?: boolean }) {
  const tone: TrafficLight = value >= 85 ? 'green' : value >= 45 ? 'amber' : 'red';
  return <div className={compact ? 'w-28' : 'w-full'}><div className="mb-1.5 flex items-center justify-between text-xs"><span className="font-semibold text-slate-700 dark:text-zinc-200">{value}%</span>{!compact && <span className="text-slate-500">completado</span>}</div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-zinc-800"><div className={`h-full rounded-full transition-all ${toneClasses[tone].bar}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div></div>;
}

const moduleLinks = [
  { href: '/expedientes', label: 'Expedientes', icon: FolderKanban },
  { href: '/expedientes/revision', label: 'Revisión documental', icon: ClipboardCheck },
  { href: '/expedientes/plantillas', label: 'Plantillas', icon: LayoutTemplate },
  { href: '/expedientes/constancias', label: 'Constancias', icon: FileCheck2 },
  { href: '/expedientes/auditoria', label: 'Auditoría', icon: History },
];

export function CaseModuleNav() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200/90 bg-white dark:border-border dark:bg-card md:flex 2xl:w-64">
      <nav aria-label="Navegación de expedientes" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-4 pt-4">
        <div className="mb-1 px-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Expedientes</p>
        </div>
        {moduleLinks.map((item) => {
          const active = item.href === '/expedientes' ? pathname === item.href : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${active ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950 dark:text-muted-foreground dark:hover:bg-muted/40 dark:hover:text-foreground'}`}>
              <Icon size={16} strokeWidth={1.8} className="shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

export function SectionHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="mb-4 flex flex-col gap-3 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-end sm:justify-between dark:border-border"><div className="min-w-0"><h1 className="text-2xl font-700 text-slate-950 dark:text-foreground">{title}</h1><p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">{description}</p></div>{action && <div className="flex shrink-0 items-center gap-2">{action}</div>}</div>;
}

export function MetricCard({ label, value, detail, tone = 'gray' }: { label: string; value: string | number; detail: string; tone?: TrafficLight }) {
  return <div className="min-h-[112px] rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/30 dark:border-border dark:bg-card"><div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-muted-foreground"><span className={`h-2 w-2 rounded-full ${toneClasses[tone].dot}`} />{label}</div><p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-foreground">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>;
}

export function HumanEmpty({ title, message, action }: { title: string; message: string; action?: React.ReactNode }) {
  return <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center"><span className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-primary"><Archive size={20} /></span><h3 className="text-sm font-semibold text-slate-950 dark:text-foreground">{title}</h3><p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">{message}</p>{action && <div className="mt-4">{action}</div>}</div>;
}
