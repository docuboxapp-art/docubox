'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle,
  FileSpreadsheet,
  Files,
  LayoutDashboard,
  PenTool,
  Settings2,
  Shapes,
} from 'lucide-react';
import {
  BULK_STATUS_META,
  campaignProgress,
  type BulkCampaignStatus,
  type BulkCampaignSummary,
} from '@/lib/bulk-signatures/schema';

const navItems = [
  { href: '/firmas-masivas', label: 'Campanas', icon: LayoutDashboard },
  { href: '/firmas-masivas/importaciones', label: 'Importaciones', icon: FileSpreadsheet },
  { href: '/firmas-masivas/firmar-lote', label: 'Firma por lote', icon: PenTool },
  { href: '/firmas-masivas/plantillas', label: 'Plantillas', icon: Shapes },
  { href: '/firmas-masivas/configuracion', label: 'Configuracion', icon: Settings2 },
];

export function BulkSignaturesWorkspace({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="-mx-4 -my-4 min-h-[calc(100vh-4rem)] bg-[#f6f8fb] dark:bg-background md:-my-6">
      <div className="mx-auto grid w-full max-w-[1720px] lg:grid-cols-[232px_minmax(0,1fr)]">
        <aside className="hidden min-h-[calc(100vh-4rem)] border-r border-slate-200 bg-white px-3 py-5 dark:border-border dark:bg-card lg:block">
          <div className="mb-4 flex items-center gap-3 px-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
              <Files size={18} />
            </span>
            <div>
              <p className="text-sm font-600 text-slate-950 dark:text-foreground">Firmas Masivas</p>
              <p className="text-[11px] text-slate-500">Orquestacion documental</p>
            </div>
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const active =
                item.href === '/firmas-masivas'
                  ? pathname === item.href
                  : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex h-10 items-center gap-3 rounded-md px-3 text-sm transition ${active ? 'bg-blue-50 font-600 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300' : 'font-500 text-slate-600 hover:bg-slate-50 hover:text-slate-950 dark:text-muted-foreground dark:hover:bg-muted'}`}
                >
                  <Icon size={17} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="mx-3 mt-6 border-t border-slate-200 pt-5 text-xs leading-5 text-slate-500 dark:border-border dark:text-muted-foreground">
            Cada elemento se convierte en un documento Docubox independiente con su propia firma y
            evidencia.
          </div>
        </aside>
        <main className="min-w-0 px-4 py-5 sm:px-5 md:py-6 lg:px-7">{children}</main>
      </div>
    </div>
  );
}

export function BulkSignaturesHeader({
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

export function BulkCampaignStatusBadge({ status }: { status: BulkCampaignStatus }) {
  const meta = BULK_STATUS_META[status] || BULK_STATUS_META.draft;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-600 ${tones[meta.tone]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {meta.label}
    </span>
  );
}

export function BulkCampaignProgress({
  campaign,
  compact = false,
}: {
  campaign: BulkCampaignSummary;
  compact?: boolean;
}) {
  const progress = campaignProgress(campaign);
  return (
    <div className={compact ? 'w-32' : 'w-full'}>
      <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
        <span>
          {campaign.completedItems} de {campaign.totalItems}
        </span>
        <span className="font-600 text-slate-700 dark:text-foreground">{progress}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

export function DemoNotice() {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-slate-600 dark:border-blue-900 dark:bg-blue-950/20 dark:text-muted-foreground">
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-blue-700" />
      Vista local de referencia. Al aplicar la migracion, las campanas quedaran aisladas por
      workspace y protegidas con RLS.
    </div>
  );
}
