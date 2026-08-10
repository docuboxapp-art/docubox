'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  CalendarClock,
  CircleAlert,
  Clock3,
  FilePlus2,
  Landmark,
  Plus,
  ReceiptText,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  DEMO_PROMISSORY_NOTES,
  formatMoney,
  mapPromissoryNoteRow,
  type PromissoryNoteSummary,
} from '@/lib/credit-titles/schema';
import {
  AmountSummary,
  CreditTitlesHeader,
  CreditTitlesWorkspace,
  PromissoryNoteStatusBadge,
} from './components/CreditTitlesUI';

export default function CreditTitlesDashboardPage() {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const [items, setItems] = useState<PromissoryNoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data, error } = await createClient()
        .from('credit_titles')
        .select('*, promissory_notes(*), title_parties(role,display_name,tax_id_masked)')
        .eq('workspace_id', activeWorkspace.id)
        .eq('title_type', 'promissory_note')
        .order('updated_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        const local = readLocal();
        setItems(local.length ? local : DEMO_PROMISSORY_NOTES);
        setDemoMode(true);
      } else {
        setItems((data || []).map(mapPromissoryNoteRow));
        setDemoMode(false);
      }
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace?.id]);

  const metrics = useMemo(
    () => ({
      nominal: items.reduce((sum, item) => sum + item.amount, 0),
      balance: items.reduce((sum, item) => sum + item.balance, 0),
      collected: items.reduce((sum, item) => sum + Math.max(0, item.amount - item.balance), 0),
      overdue: items
        .filter((item) => item.status === 'overdue')
        .reduce((sum, item) => sum + item.balance, 0),
    }),
    [items]
  );
  const dueSoon = items
    .filter((item) => ['active', 'partially_paid'].includes(item.status))
    .sort((a, b) => a.maturityDate.localeCompare(b.maturityDate))
    .slice(0, 4);

  return (
    <AppLayout noPadding>
      <CreditTitlesWorkspace>
        <CreditTitlesHeader
          title="Titulos de Credito Digitales"
          description="Emite y administra pagares electronicos con registro unico, tenencia controlada y evidencia verificable."
          action={
            <button
              onClick={() => router.push('/credit-titles/promissory-notes/new')}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-600 text-white shadow-sm transition hover:bg-primary/90"
            >
              <Plus size={16} /> Crear pagare
            </button>
          }
        />

        {demoMode && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs leading-5 text-slate-600 dark:border-indigo-900 dark:bg-indigo-950/20">
            <Landmark size={14} className="mt-0.5 shrink-0 text-indigo-700" />
            Vista local de referencia. Al aplicar la migracion, cada titulo quedara aislado por
            espacio de trabajo y protegido con RLS.
          </div>
        )}

        <section className="grid overflow-hidden rounded-lg border border-slate-200 bg-white sm:grid-cols-2 lg:grid-cols-4 dark:border-border dark:bg-card">
          <AmountSummary
            label="Valor nominal"
            value={formatMoney(metrics.nominal)}
            detail={`${items.length} titulos registrados`}
          />
          <div className="border-t border-slate-200 sm:border-l sm:border-t-0 dark:border-border">
            <AmountSummary
              label="Saldo vigente"
              value={formatMoney(metrics.balance)}
              detail="Capital pendiente"
            />
          </div>
          <div className="border-t border-slate-200 lg:border-l lg:border-t-0 dark:border-border">
            <AmountSummary
              label="Cobrado"
              value={formatMoney(metrics.collected)}
              detail="Pagos acumulados"
              tone="green"
            />
          </div>
          <div className="border-t border-slate-200 sm:border-l lg:border-t-0 dark:border-border">
            <AmountSummary
              label="Vencido"
              value={formatMoney(metrics.overdue)}
              detail="Requiere seguimiento"
              tone="red"
            />
          </div>
        </section>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card">
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-4 dark:border-border">
              <div>
                <h2 className="text-sm font-600">Actividad de la cartera</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Ultimos movimientos del registro digital
                </p>
              </div>
              <button
                onClick={() => router.push('/credit-titles/promissory-notes')}
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-600 text-primary hover:bg-blue-50"
              >
                Ver todos <ArrowRight size={14} />
              </button>
            </header>
            {loading ? (
              <div className="flex min-h-64 items-center justify-center">
                <span className="h-7 w-7 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-border">
                {items.slice(0, 5).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => router.push(`/credit-titles/promissory-notes/${item.id}`)}
                    className="grid w-full gap-3 px-4 py-4 text-left transition hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center dark:hover:bg-muted/30"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-indigo-100 bg-indigo-50 text-indigo-700">
                        <ReceiptText size={18} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-600">
                          {item.subscriberName}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {item.folio} · vence {formatDate(item.maturityDate)}
                        </span>
                      </span>
                    </div>
                    <PromissoryNoteStatusBadge status={item.status} />
                    <span className="text-sm font-600">
                      {formatMoney(item.balance, item.currency)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="space-y-4">
            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card">
              <header className="border-b border-slate-200 px-4 py-4 dark:border-border">
                <h2 className="text-sm font-600">Proximos vencimientos</h2>
              </header>
              <div className="divide-y divide-slate-200 dark:divide-border">
                {dueSoon.length ? (
                  dueSoon.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                      <CalendarClock size={17} className="text-amber-600" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-600">{item.folio}</p>
                        <p className="text-xs text-slate-500">
                          {formatDate(item.maturityDate)} · {item.subscriberName}
                        </p>
                      </div>
                      <p className="text-xs font-600">{formatMoney(item.balance)}</p>
                    </div>
                  ))
                ) : (
                  <p className="px-4 py-8 text-center text-sm text-slate-500">
                    Sin vencimientos proximos.
                  </p>
                )}
              </div>
            </section>
            <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-border dark:bg-card">
              <h2 className="text-sm font-600">Acciones rapidas</h2>
              <div className="mt-3 grid gap-2">
                <QuickAction
                  icon={FilePlus2}
                  label="Crear desde plantilla"
                  onClick={() => router.push('/credit-titles/promissory-notes/new')}
                />
                <QuickAction
                  icon={Clock3}
                  label="Revisar titulos por vencer"
                  onClick={() => router.push('/credit-titles/promissory-notes?status=active')}
                />
                <QuickAction
                  icon={CircleAlert}
                  label="Atender cartera vencida"
                  onClick={() => router.push('/credit-titles/promissory-notes?status=overdue')}
                />
              </div>
            </section>
          </div>
        </div>
      </CreditTitlesWorkspace>
    </AppLayout>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex h-10 items-center gap-3 rounded-md border border-slate-200 px-3 text-left text-sm font-500 text-slate-700 hover:border-indigo-200 hover:bg-indigo-50/50 dark:border-border dark:text-foreground"
    >
      <Icon size={16} className="text-indigo-700" />
      {label}
      <ArrowRight size={14} className="ml-auto text-slate-400" />
    </button>
  );
}
function formatDate(value: string) {
  return value
    ? new Date(`${value}T12:00:00`).toLocaleDateString('es-MX', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : 'Sin fecha';
}
function readLocal(): PromissoryNoteSummary[] {
  try {
    return JSON.parse(localStorage.getItem('docubox_credit_titles_drafts') || '[]');
  } catch {
    return [];
  }
}
