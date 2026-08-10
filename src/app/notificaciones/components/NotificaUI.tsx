'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Archive, BadgeCheck, FileClock, MailCheck, Plus, ScrollText } from 'lucide-react';
import type { EvidenceLevel, NotificationStatus } from '@/lib/notifica/schema';
import { EVIDENCE_META, NOTIFICATION_STATUS_META } from '@/lib/notifica/schema';

const navItems = [
  { href: '/notificaciones', label: 'Notificaciones', icon: MailCheck },
  { href: '/notificaciones/nueva', label: 'Nueva notificacion', icon: Plus },
  { href: '/notificaciones/constancias', label: 'Constancias', icon: BadgeCheck },
  { href: '/notificaciones/auditoria', label: 'Auditoria', icon: ScrollText },
];

export function NotificaWorkspace({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="-mx-4 -my-4 min-h-[calc(100vh-4rem)] bg-[#f6f8fb] dark:bg-background md:-my-6">
      <div className="mx-auto grid w-full max-w-[1680px] lg:grid-cols-[224px_minmax(0,1fr)]">
        <aside className="hidden min-h-[calc(100vh-4rem)] border-r border-slate-200 bg-white px-3 py-5 dark:border-border dark:bg-card lg:block">
          <p className="px-3 pb-3 text-[11px] font-600 uppercase tracking-[0.08em] text-slate-400">Docubox Notifica</p>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const active = item.href === '/notificaciones' ? pathname === item.href : pathname.startsWith(item.href);
              const Icon = item.icon;
              return <Link key={item.href} href={item.href} className={`flex h-10 items-center gap-3 rounded-md px-3 text-sm transition ${active ? 'bg-blue-50 font-600 text-primary dark:bg-primary/10' : 'font-500 text-slate-600 hover:bg-slate-50 hover:text-slate-950 dark:text-muted-foreground dark:hover:bg-muted'}`}><Icon size={17} />{item.label}</Link>;
            })}
          </nav>
          <div className="mx-3 mt-6 border-t border-slate-200 pt-5 dark:border-border">
            <div className="flex items-start gap-2.5 text-xs leading-5 text-slate-500 dark:text-muted-foreground"><FileClock size={15} className="mt-0.5 shrink-0 text-cyan-700" />Cada comunicacion conserva su documento canonico y una linea de evidencia independiente.</div>
          </div>
        </aside>
        <main className="min-w-0 px-4 py-5 sm:px-5 md:py-6 lg:px-7">{children}</main>
      </div>
    </div>
  );
}

export function NotificaHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <header className="mb-5 flex flex-col gap-4 border-b border-slate-200 pb-5 dark:border-border sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-600 text-slate-950 dark:text-foreground">{title}</h1><p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">{description}</p></div>{action}</header>;
}

const toneClasses = {
  gray: 'bg-slate-100 text-slate-600 dark:bg-muted dark:text-muted-foreground',
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
  green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
  red: 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300',
};

export function NotificationStatusBadge({ status }: { status: NotificationStatus }) {
  const meta = NOTIFICATION_STATUS_META[status] || NOTIFICATION_STATUS_META.draft;
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-600 ${toneClasses[meta.tone]}`}>{meta.label}</span>;
}

export function EvidenceBadge({ level }: { level: EvidenceLevel }) {
  return <span title={EVIDENCE_META[level].description} className="inline-flex items-center gap-1.5 rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs font-600 text-cyan-800 dark:border-cyan-900 dark:bg-cyan-950/30 dark:text-cyan-300"><span className="h-1.5 w-1.5 rounded-full bg-cyan-600" />{level} · {EVIDENCE_META[level].label}</span>;
}

export function Metric({ label, value, detail, tone = 'blue' }: { label: string; value: number; detail: string; tone?: 'blue' | 'green' | 'amber' | 'gray' }) {
  const colors = { blue: 'text-blue-700 bg-blue-50', green: 'text-emerald-700 bg-emerald-50', amber: 'text-amber-700 bg-amber-50', gray: 'text-slate-700 bg-slate-100' };
  return <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-border dark:bg-card"><div className={`inline-flex min-w-9 items-center justify-center rounded-md px-2 py-1 text-xl font-600 ${colors[tone]}`}>{value}</div><p className="mt-3 text-sm font-600 text-slate-950 dark:text-foreground">{label}</p><p className="mt-1 text-xs text-slate-500 dark:text-muted-foreground">{detail}</p></div>;
}
