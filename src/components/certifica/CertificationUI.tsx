'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity, Archive, BadgeCheck, Boxes, Code2, FileCheck2, Gauge,
  History, Layers3, Plus, Settings2, ShieldCheck,
} from 'lucide-react';
import { CERTIFICATION_STATUS, type CertificationStatus } from '@/lib/certifica/domain';

const links = [
  { href: '/certificaciones', label: 'Inicio', icon: Gauge, exact: true },
  { href: '/certificaciones/nueva', label: 'Nueva certificacion', icon: Plus },
  { href: '/certificaciones?view=all', label: 'Certificaciones', icon: BadgeCheck },
  { href: '/certificaciones/lotes', label: 'Lotes', icon: Layers3 },
  { href: '/certificaciones/conservados', label: 'Documentos conservados', icon: Archive },
  { href: '/certificaciones/verificaciones', label: 'Verificaciones', icon: ShieldCheck },
  { href: '/certificaciones/consumo', label: 'Consumo y folios', icon: Activity },
  { href: '/certificaciones/api', label: 'API y webhooks', icon: Code2 },
  { href: '/certificaciones/configuracion', label: 'Configuracion', icon: Settings2 },
];

export function CertificationWorkspace({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="-mx-4 -my-4 flex min-h-[calc(100vh-104px)] bg-[#f6f8fb] text-slate-950 dark:bg-background dark:text-foreground md:-my-6">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white dark:border-border dark:bg-card md:block 2xl:w-64">
        <nav className="sticky top-16 space-y-0.5 px-2.5 py-4" aria-label="Navegacion de Docubox Certifica">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Docubox Certifica</p>
          {links.map((item) => {
            const base = item.href.split('?')[0];
            const active = item.exact ? pathname === base : pathname === base || pathname.startsWith(`${base}/`);
            const Icon = item.icon;
            return <Link key={item.href} href={item.href} className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold transition ${active ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950 dark:text-muted-foreground dark:hover:bg-muted/40'}`}><Icon size={16} strokeWidth={1.8} /><span className="truncate">{item.label}</span></Link>;
          })}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto px-4 pb-6 pt-4 sm:px-5 lg:px-6 xl:px-7"><div className="mx-auto w-full max-w-[1600px]">{children}</div></main>
    </div>
  );
}

export function CertificationHeader({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) {
  return <header className="mb-5 flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between dark:border-border"><div><h1 className="text-2xl font-semibold text-slate-950 dark:text-foreground">{title}</h1><p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">{description}</p></div>{actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}</header>;
}

export function CertificationStatusBadge({ status }: { status: string }) {
  const meta = CERTIFICATION_STATUS[status as CertificationStatus] || { label: status, tone: 'gray' };
  const tones: Record<string, string> = { green: 'border-emerald-200 bg-emerald-50 text-emerald-700', blue: 'border-blue-200 bg-blue-50 text-primary', amber: 'border-amber-200 bg-amber-50 text-amber-700', red: 'border-red-200 bg-red-50 text-red-700', gray: 'border-slate-200 bg-slate-50 text-slate-600' };
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[meta.tone]}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{meta.label}</span>;
}

export function EmptyCertification({ title, message }: { title: string; message: string }) {
  return <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center"><span className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-primary"><FileCheck2 size={20} /></span><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 max-w-md text-sm leading-6 text-slate-500">{message}</p></div>;
}

export function SandboxNotice() {
  return <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><Boxes size={17} className="mt-0.5 shrink-0" /><div><p className="font-semibold">Entorno de demostracion</p><p className="mt-0.5 text-xs leading-5">Las evidencias PSC de sandbox llevan la marca NO VALIDO / DEMOSTRACION y no se presentan como constancias emitidas por un PSC acreditado.</p></div></div>;
}

