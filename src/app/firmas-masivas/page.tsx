'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Files,
  MoreHorizontal,
  Plus,
  Search,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createClient } from '@/lib/supabase/client';
import {
  BULK_TYPE_LABELS,
  DEMO_BULK_CAMPAIGNS,
  mapBulkCampaignRow,
  readLocalBulkCampaigns,
  type BulkCampaignSummary,
} from '@/lib/bulk-signatures/schema';
import {
  BulkCampaignProgress,
  BulkCampaignStatusBadge,
  BulkSignaturesHeader,
  BulkSignaturesWorkspace,
  DemoNotice,
} from './components/BulkSignaturesUI';

export default function BulkSignaturesPage() {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const [campaigns, setCampaigns] = useState<BulkCampaignSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data, error } = await createClient()
        .from('bulk_signature_campaigns')
        .select('*')
        .eq('workspace_id', activeWorkspace.id)
        .order('updated_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        const local = readLocalBulkCampaigns();
        setCampaigns(local.length ? [...local, ...DEMO_BULK_CAMPAIGNS] : DEMO_BULK_CAMPAIGNS);
        setDemoMode(true);
      } else {
        setCampaigns((data || []).map(mapBulkCampaignRow));
        setDemoMode(false);
      }
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace?.id]);

  const filtered = campaigns.filter((campaign) =>
    `${campaign.name} ${campaign.description}`.toLowerCase().includes(query.toLowerCase())
  );
  const metrics = useMemo(() => {
    const total = campaigns.reduce((sum, item) => sum + item.totalItems, 0);
    const signed = campaigns.reduce((sum, item) => sum + item.completedItems, 0);
    const failed = campaigns.reduce((sum, item) => sum + item.failedItems, 0);
    return {
      active: campaigns.filter((item) =>
        ['active', 'processing', 'scheduled'].includes(item.status)
      ).length,
      total,
      signed,
      pending: Math.max(0, total - signed - failed),
      failed,
      completion: total ? Math.round((signed / total) * 100) : 0,
    };
  }, [campaigns]);

  return (
    <AppLayout noPadding>
      <BulkSignaturesWorkspace>
        <BulkSignaturesHeader
          title="Firmas Masivas"
          description="Genera, envia y supervisa cientos de documentos sin perder la trazabilidad individual de cada firma."
          action={
            <button
              onClick={() => router.push('/firmas-masivas/nueva')}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-600 text-white shadow-sm hover:bg-primary/90"
            >
              <Plus size={16} /> Nueva firma masiva
            </button>
          }
        />
        {demoMode && <DemoNotice />}

        <section className="grid overflow-hidden rounded-lg border border-slate-200 bg-white sm:grid-cols-2 xl:grid-cols-5 dark:border-border dark:bg-card">
          <Metric
            icon={Files}
            label="Campanas activas"
            value={metrics.active}
            detail={`${campaigns.length} en total`}
          />
          <Metric
            icon={CheckCircle2}
            label="Documentos firmados"
            value={metrics.signed}
            detail={`${metrics.completion}% completado`}
            tone="green"
          />
          <Metric
            icon={Clock3}
            label="Pendientes"
            value={metrics.pending}
            detail="En flujo de firma"
            tone="blue"
          />
          <Metric
            icon={AlertCircle}
            label="Incidencias"
            value={metrics.failed}
            detail="Sin detener el lote"
            tone="red"
          />
          <Metric
            icon={CalendarClock}
            label="Procesados"
            value={metrics.total}
            detail="Documentos individuales"
            tone="indigo"
          />
        </section>

        <section className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card">
          <header className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-border sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-600 text-slate-950 dark:text-foreground">Campanas</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Progreso e incidencias en una sola vista operativa.
              </p>
            </div>
            <label className="flex h-9 w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-3 sm:w-72 dark:border-border dark:bg-background">
              <Search size={15} className="text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar campana..."
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none ring-0"
              />
            </label>
          </header>
          {loading ? (
            <div className="flex min-h-72 items-center justify-center">
              <span className="h-7 w-7 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
            </div>
          ) : filtered.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left">
                <thead className="bg-slate-50 text-[11px] font-600 uppercase text-slate-500 dark:bg-muted/30">
                  <tr>
                    <th className="px-4 py-3">Campana</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Progreso</th>
                    <th className="px-4 py-3">Incidencias</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3">Actualizada</th>
                    <th className="w-12 px-3 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-border">
                  {filtered.map((campaign) => (
                    <tr
                      key={campaign.id}
                      onClick={() => router.push(`/firmas-masivas/${campaign.id}`)}
                      className="cursor-pointer hover:bg-slate-50 dark:hover:bg-muted/20"
                    >
                      <td className="px-4 py-4">
                        <p className="max-w-xs truncate text-sm font-600 text-slate-950 dark:text-foreground">
                          {campaign.name}
                        </p>
                        <p className="mt-0.5 max-w-xs truncate text-xs text-slate-500">
                          {campaign.ownerName} · {campaign.participantCount} participantes
                        </p>
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600 dark:text-muted-foreground">
                        {BULK_TYPE_LABELS[campaign.campaignType]}
                      </td>
                      <td className="px-4 py-4">
                        <BulkCampaignProgress campaign={campaign} compact />
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={`text-sm font-600 ${campaign.failedItems ? 'text-red-600' : 'text-slate-500'}`}
                        >
                          {campaign.failedItems}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <BulkCampaignStatusBadge status={campaign.status} />
                      </td>
                      <td className="px-4 py-4 text-xs text-slate-500">
                        {formatDate(campaign.updatedAt)}
                      </td>
                      <td className="px-3 py-4">
                        <MoreHorizontal size={17} className="text-slate-400" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-md bg-blue-50 text-primary">
                <Files size={22} />
              </span>
              <h3 className="mt-4 text-sm font-600">Crea tu primera campana</h3>
              <p className="mt-1 max-w-sm text-sm text-slate-500">
                Organiza documentos independientes dentro de una operacion masiva trazable.
              </p>
              <button
                onClick={() => router.push('/firmas-masivas/nueva')}
                className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-600 text-white"
              >
                Comenzar <ArrowRight size={15} />
              </button>
            </div>
          )}
        </section>
      </BulkSignaturesWorkspace>
    </AppLayout>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'slate',
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  detail: string;
  tone?: 'slate' | 'blue' | 'green' | 'red' | 'indigo';
}) {
  const colors = {
    slate: 'bg-slate-100 text-slate-600',
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    red: 'bg-red-50 text-red-700',
    indigo: 'bg-indigo-50 text-indigo-700',
  };
  return (
    <div className="border-t border-slate-200 p-4 first:border-t-0 sm:border-l sm:first:border-l-0 sm:[&:nth-child(2)]:border-t-0 xl:border-t-0 dark:border-border">
      <span className={`flex h-8 w-8 items-center justify-center rounded-md ${colors[tone]}`}>
        <Icon size={16} />
      </span>
      <p className="mt-3 text-2xl font-600 text-slate-950 dark:text-foreground">
        {value.toLocaleString('es-MX')}
      </p>
      <p className="mt-1 text-sm font-500 text-slate-700 dark:text-foreground">{label}</p>
      <p className="mt-0.5 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}
