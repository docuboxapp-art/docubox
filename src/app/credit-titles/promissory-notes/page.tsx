'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, FileText, MoreHorizontal, Plus, Search } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  DEMO_PROMISSORY_NOTES,
  formatMoney,
  mapPromissoryNoteRow,
  STATUS_META,
  type PromissoryNoteSummary,
} from '@/lib/credit-titles/schema';
import {
  CreditTitlesHeader,
  CreditTitlesWorkspace,
  PromissoryNoteStatusBadge,
} from '../components/CreditTitlesUI';

export default function PromissoryNotesPage() {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const [items, setItems] = useState<PromissoryNoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');

  useEffect(() => {
    const requestedStatus = new URLSearchParams(window.location.search).get('status');
    if (requestedStatus) setStatus(requestedStatus);
  }, []);

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    let cancelled = false;
    const load = async () => {
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
      } else setItems((data || []).map(mapPromissoryNoteRow));
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace?.id]);

  const filtered = useMemo(
    () =>
      items.filter((item) => {
        const searchable =
          `${item.folio} ${item.subscriberName} ${item.subscriberRfc} ${item.beneficiaryName} ${item.currentHolderName}`.toLowerCase();
        return (
          searchable.includes(query.trim().toLowerCase()) &&
          (status === 'all' || item.status === status)
        );
      }),
    [items, query, status]
  );

  return (
    <AppLayout noPadding>
      <CreditTitlesWorkspace>
        <CreditTitlesHeader
          title="Pagares electronicos"
          description="Consulta el registro, estado juridico-operativo, saldo y tenencia actual de cada titulo."
          action={
            <button
              onClick={() => router.push('/credit-titles/promissory-notes/new')}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-600 text-white"
            >
              <Plus size={16} /> Crear pagare
            </button>
          }
        />
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card">
          <header className="border-b border-slate-200 p-4 dark:border-border">
            <div className="flex flex-col gap-3 lg:flex-row">
              <div className="relative flex-1">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar por folio, UUID, RFC, nombre o razon social"
                  className="h-10 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-border dark:bg-background"
                />
              </div>
              <div className="relative">
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  className="h-10 min-w-52 appearance-none rounded-md border border-slate-200 bg-white px-3 pr-9 text-sm outline-none dark:border-border dark:bg-card"
                >
                  <option value="all">Todos los estados</option>
                  {Object.entries(STATUS_META).map(([value, meta]) => (
                    <option key={value} value={value}>
                      {meta.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                />
              </div>
            </div>
          </header>
          {loading ? (
            <div className="flex min-h-72 items-center justify-center">
              <span className="h-7 w-7 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
              <FileText size={28} className="text-slate-400" />
              <h2 className="mt-3 text-sm font-600">No hay pagares con estos filtros</h2>
              <p className="mt-1 text-sm text-slate-500">Crea un titulo o ajusta la busqueda.</p>
            </div>
          ) : (
            <>
              <div className="divide-y divide-slate-200 md:hidden dark:divide-border">
                {filtered.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => router.push(`/credit-titles/promissory-notes/${item.id}`)}
                    className="w-full p-4 text-left"
                  >
                    <div className="flex justify-between gap-3">
                      <div>
                        <p className="text-sm font-600">{item.folio}</p>
                        <p className="mt-1 text-xs text-slate-500">{item.subscriberName}</p>
                      </div>
                      <PromissoryNoteStatusBadge status={item.status} />
                    </div>
                    <div className="mt-3 flex justify-between text-xs">
                      <span>{formatMoney(item.balance, item.currency)} pendiente</span>
                      <span className="text-slate-500">Vence {formatDate(item.maturityDate)}</span>
                    </div>
                  </button>
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[1160px] border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-border dark:bg-muted/40">
                      <Heading>Folio</Heading>
                      <Heading>Suscriptor</Heading>
                      <Heading>Beneficiario</Heading>
                      <Heading>Importe / saldo</Heading>
                      <Heading>Vencimiento</Heading>
                      <Heading>Tenedor actual</Heading>
                      <Heading>Estado</Heading>
                      <Heading align="right">Acciones</Heading>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-border">
                    {filtered.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/80 dark:hover:bg-muted/30">
                        <td className="px-4 py-4">
                          <button
                            onClick={() =>
                              router.push(`/credit-titles/promissory-notes/${item.id}`)
                            }
                            className="flex items-center gap-3 text-left"
                          >
                            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-indigo-100 bg-indigo-50 text-indigo-700">
                              <FileText size={17} />
                            </span>
                            <span>
                              <span className="block text-sm font-600 text-primary">
                                {item.folio}
                              </span>
                              <span className="mt-0.5 block text-xs text-slate-500">
                                {item.kindLabel || kindLabel(item.kind)}
                              </span>
                            </span>
                          </button>
                        </td>
                        <td className="px-4 py-4">
                          <p className="max-w-52 truncate text-sm font-500">
                            {item.subscriberName}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">{item.subscriberRfc}</p>
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-600">{item.beneficiaryName}</td>
                        <td className="px-4 py-4">
                          <p className="text-sm font-600">
                            {formatMoney(item.amount, item.currency)}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            Saldo {formatMoney(item.balance, item.currency)}
                          </p>
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-600">
                          {formatDate(item.maturityDate)}
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-600">
                          {item.currentHolderName}
                        </td>
                        <td className="px-4 py-4">
                          <PromissoryNoteStatusBadge status={item.status} />
                        </td>
                        <td className="px-4 py-4 text-right">
                          <button
                            aria-label="Abrir pagare"
                            onClick={() =>
                              router.push(`/credit-titles/promissory-notes/${item.id}`)
                            }
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-border"
                          >
                            <MoreHorizontal size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </CreditTitlesWorkspace>
    </AppLayout>
  );
}

function Heading({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      className={`px-4 py-3 text-xs font-600 text-slate-500 ${align === 'right' ? 'text-right' : ''}`}
    >
      {children}
    </th>
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
function kindLabel(kind: string) {
  return (
    (
      {
        simple: 'Pagare simple',
        interest: 'Con intereses',
        guaranteed: 'Con aval',
        installments: 'En parcialidades',
        series: 'Serie de pagares',
        contract: 'Asociado a contrato',
      } as Record<string, string>
    )[kind] || 'Pagare electronico'
  );
}
function readLocal(): PromissoryNoteSummary[] {
  try {
    return JSON.parse(localStorage.getItem('docubox_credit_titles_drafts') || '[]');
  } catch {
    return [];
  }
}
