'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BriefcaseBusiness,
  FilePlus2,
  FileText,
  Landmark,
  LayoutDashboard,
  Settings2,
  SlidersHorizontal,
} from 'lucide-react';
import { STATUS_META, type PromissoryNoteStatus } from '@/lib/credit-titles/schema';

const navItems = [
  { href: '/credit-titles', label: 'Resumen', icon: LayoutDashboard },
  { href: '/credit-titles/promissory-notes', label: 'Pagares', icon: FileText },
  { href: '/credit-titles/portfolios', label: 'Carteras', icon: BriefcaseBusiness },
  { href: '/credit-titles/operations', label: 'Operaciones', icon: SlidersHorizontal },
  { href: '/credit-titles/templates', label: 'Plantillas', icon: FilePlus2 },
  { href: '/credit-titles/settings', label: 'Configuracion', icon: Settings2 },
];

export function CreditTitlesWorkspace({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="-mx-4 -my-4 min-h-[calc(100vh-4rem)] bg-[#f6f8fb] dark:bg-background md:-my-6">
      <div className="mx-auto grid w-full max-w-[1720px] lg:grid-cols-[232px_minmax(0,1fr)]">
        <aside className="hidden min-h-[calc(100vh-4rem)] border-r border-slate-200 bg-white px-3 py-5 dark:border-border dark:bg-card lg:block">
          <div className="mb-4 flex items-center gap-3 px-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700">
              <Landmark size={18} />
            </span>
            <div>
              <p className="text-sm font-600 text-slate-950 dark:text-foreground">
                Titulos de Credito
              </p>
              <p className="text-[11px] text-slate-500">Registro digital</p>
            </div>
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const active =
                item.href === '/credit-titles'
                  ? pathname === item.href
                  : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex h-10 items-center gap-3 rounded-md px-3 text-sm transition ${active ? 'bg-indigo-50 font-600 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300' : 'font-500 text-slate-600 hover:bg-slate-50 hover:text-slate-950 dark:text-muted-foreground dark:hover:bg-muted'}`}
                >
                  <Icon size={17} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="mx-3 mt-6 border-t border-slate-200 pt-5 text-xs leading-5 text-slate-500 dark:border-border dark:text-muted-foreground">
            El registro electronico es la fuente de verdad. El PDF es su representacion verificable.
          </div>
        </aside>
        <main className="min-w-0 px-4 py-5 sm:px-5 md:py-6 lg:px-7">{children}</main>
      </div>
    </div>
  );
}

export function CreditTitlesHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-col gap-4 border-b border-slate-200 pb-5 dark:border-border sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-600 text-slate-950 dark:text-foreground">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500 dark:text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </header>
  );
}

const tones = {
  gray: 'bg-slate-100 text-slate-600 dark:bg-muted dark:text-muted-foreground',
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
  green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
  red: 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300',
  indigo: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300',
};

export function PromissoryNoteStatusBadge({ status }: { status: PromissoryNoteStatus }) {
  const meta = STATUS_META[status] || STATUS_META.draft;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-600 ${tones[meta.tone]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {meta.label}
    </span>
  );
}

export function AmountSummary({
  label,
  value,
  detail,
  tone = 'indigo',
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'indigo' | 'green' | 'amber' | 'red';
}) {
  const color = {
    indigo: 'text-indigo-700',
    green: 'text-emerald-700',
    amber: 'text-amber-700',
    red: 'text-red-700',
  }[tone];
  return (
    <div className="min-w-0 px-4 py-4 sm:px-5">
      <p className="text-xs font-600 uppercase tracking-[0.06em] text-slate-400">{label}</p>
      <p className={`mt-2 truncate text-2xl font-600 ${color}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}
