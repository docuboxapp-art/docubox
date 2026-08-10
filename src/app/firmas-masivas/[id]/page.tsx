'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileText,
  Filter,
  Mail,
  MoreHorizontal,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createClient } from '@/lib/supabase/client';
import {
  BULK_TYPE_LABELS,
  createDemoItems,
  findBulkCampaign,
  mapBulkCampaignRow,
  type BulkCampaignItem,
  type BulkCampaignSummary,
} from '@/lib/bulk-signatures/schema';
import {
  BulkCampaignProgress,
  BulkCampaignStatusBadge,
  BulkSignaturesWorkspace,
} from '../components/BulkSignaturesUI';

type Tab = 'documents' | 'participants' | 'incidents' | 'evidence' | 'reports';

export default function BulkCampaignMonitorPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { activeWorkspace } = useWorkspace();
  const [campaign, setCampaign] = useState<BulkCampaignSummary | null>(null);
  const [items, setItems] = useState<BulkCampaignItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('documents');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    if (!params.id) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data, error } = await createClient()
        .from('bulk_signature_campaigns')
        .select('*, bulk_campaign_items(*)')
        .eq('id', params.id)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        const local = findBulkCampaign(params.id);
        if (local) {
          setCampaign(local);
          setItems(createDemoItems(local));
        }
      } else {
        const mapped = mapBulkCampaignRow(data);
        setCampaign(mapped);
        setItems((data.bulk_campaign_items || []).map(mapItem));
      }
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [params.id, activeWorkspace?.id]);

  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        const matchesQuery = `${item.documentName} ${item.participantName} ${item.participantEmail}`
          .toLowerCase()
          .includes(query.toLowerCase());
        return matchesQuery && (statusFilter === 'all' || item.status === statusFilter);
      }),
    [items, query, statusFilter]
  );

  if (loading)
    return (
      <AppLayout noPadding>
        <div className="flex min-h-[70vh] items-center justify-center">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        </div>
      </AppLayout>
    );
  if (!campaign)
    return (
      <AppLayout noPadding>
        <div className="flex min-h-[70vh] flex-col items-center justify-center">
          <h1 className="text-lg font-600">Campana no encontrada</h1>
          <button
            onClick={() => router.push('/firmas-masivas')}
            className="mt-4 text-sm font-600 text-primary"
          >
            Volver a Firmas Masivas
          </button>
        </div>
      </AppLayout>
    );

  const incidents = items.filter((item) => item.status === 'failed');
  return (
    <AppLayout noPadding>
      <BulkSignaturesWorkspace>
        <header className="mb-4 border-b border-slate-200 pb-5 dark:border-border">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <button
                onClick={() => router.push('/firmas-masivas')}
                className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-border dark:bg-card"
              >
                <ArrowLeft size={17} />
              </button>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-xl font-600 text-slate-950 dark:text-foreground">
                    {campaign.name}
                  </h1>
                  <BulkCampaignStatusBadge status={campaign.status} />
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {BULK_TYPE_LABELS[campaign.campaignType]} · {campaign.ownerName}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-600 text-slate-700 dark:border-border dark:bg-card">
                <Mail size={15} /> Recordatorio
              </button>
              <button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-600 text-slate-700 dark:border-border dark:bg-card">
                {campaign.status === 'paused' ? <Play size={15} /> : <Pause size={15} />}
                {campaign.status === 'paused' ? 'Reanudar' : 'Pausar'}
              </button>
              <button className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-600 text-white">
                <Download size={15} /> Descargar
              </button>
            </div>
          </div>
        </header>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.7fr)]">
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-border dark:bg-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-600 uppercase text-slate-400">Avance general</p>
                <p className="mt-1 text-sm text-slate-600">
                  Cada resultado se procesa y conserva de forma independiente.
                </p>
              </div>
              <span className="text-2xl font-600">
                {campaign.totalItems
                  ? Math.round((campaign.completedItems / campaign.totalItems) * 100)
                  : 0}
                %
              </span>
            </div>
            <div className="mt-4">
              <BulkCampaignProgress campaign={campaign} />
            </div>
            <div className="mt-4 grid grid-cols-4 divide-x divide-slate-200 border-t border-slate-200 pt-4 dark:divide-border dark:border-border">
              <MiniMetric label="Total" value={campaign.totalItems} />
              <MiniMetric label="Firmados" value={campaign.completedItems} tone="green" />
              <MiniMetric label="Pendientes" value={campaign.pendingItems} tone="blue" />
              <MiniMetric label="Incidencias" value={campaign.failedItems} tone="red" />
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-border dark:bg-card">
            <p className="text-xs font-600 uppercase text-slate-400">Control de operacion</p>
            <div className="mt-3 space-y-3 text-sm">
              <InfoRow label="Creada" value={formatDate(campaign.createdAt)} />
              <InfoRow
                label="Vencimiento"
                value={campaign.expiresAt ? formatDate(campaign.expiresAt) : 'Sin fecha'}
              />
              <InfoRow
                label="Participantes"
                value={campaign.participantCount.toLocaleString('es-MX')}
              />
              <InfoRow label="Aislamiento" value="Workspace + RLS" />
            </div>
          </div>
        </section>

        <section className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card">
          <nav className="flex overflow-x-auto border-b border-slate-200 px-3 dark:border-border">
            {(
              [
                {
                  id: 'documents',
                  label: 'Documentos',
                  icon: FileText,
                  count: campaign.totalItems,
                },
                {
                  id: 'participants',
                  label: 'Participantes',
                  icon: Users,
                  count: campaign.participantCount,
                },
                {
                  id: 'incidents',
                  label: 'Incidencias',
                  icon: AlertTriangle,
                  count: campaign.failedItems,
                },
                { id: 'evidence', label: 'Evidencia', icon: ShieldCheck },
                { id: 'reports', label: 'Reportes', icon: Download },
              ] as Array<{ id: Tab; label: string; icon: React.ElementType; count?: number }>
            ).map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id)}
                  className={`flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-500 ${tab === item.id ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-900'}`}
                >
                  <Icon size={15} />
                  {item.label}
                  {item.count !== undefined && (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px]">
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {tab === 'documents' && (
            <>
              <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row dark:border-border">
                <label className="flex h-9 flex-1 items-center gap-2 rounded-md border border-slate-200 px-3 dark:border-border">
                  <Search size={15} className="text-slate-400" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar documento o participante..."
                    className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none"
                  />
                </label>
                <label className="flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm dark:border-border">
                  <Filter size={15} />
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="border-0 bg-transparent outline-none"
                  >
                    <option value="all">Todos los estados</option>
                    <option value="signed">Firmados</option>
                    <option value="sent">Enviados</option>
                    <option value="viewed">Vistos</option>
                    <option value="failed">Con error</option>
                  </select>
                </label>
              </div>
              <ItemsTable items={filteredItems} />
            </>
          )}
          {tab === 'participants' && <ParticipantsSummary items={items} />}
          {tab === 'incidents' && <IncidentsPanel items={incidents} />}
          {tab === 'evidence' && <EvidencePanel campaign={campaign} />}
          {tab === 'reports' && <ReportsPanel campaign={campaign} />}
        </section>
      </BulkSignaturesWorkspace>
    </AppLayout>
  );
}

function ItemsTable({ items }: { items: BulkCampaignItem[] }) {
  return items.length ? (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left">
        <thead className="bg-slate-50 text-[11px] font-600 uppercase text-slate-500 dark:bg-muted/30">
          <tr>
            <th className="px-4 py-3">Documento</th>
            <th className="px-4 py-3">Participante</th>
            <th className="px-4 py-3">Estado</th>
            <th className="px-4 py-3">Progreso</th>
            <th className="px-4 py-3">Ultima actividad</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-border">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-muted/20">
              <td className="px-4 py-3">
                <p className="text-sm font-600">{item.documentName}</p>
                <p className="text-xs text-slate-500">
                  {item.documentId || 'Documento por generar'}
                </p>
              </td>
              <td className="px-4 py-3">
                <p className="text-sm">{item.participantName}</p>
                <p className="text-xs text-slate-500">{item.participantEmail}</p>
              </td>
              <td className="px-4 py-3">
                <ItemStatus status={item.status} />
              </td>
              <td className="px-4 py-3">
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${item.status === 'failed' ? 'bg-red-500' : 'bg-primary'}`}
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
              </td>
              <td className="px-4 py-3 text-xs text-slate-500">{formatDate(item.updatedAt)}</td>
              <td className="px-3">
                <MoreHorizontal size={16} className="text-slate-400" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <EmptyState
      title="Sin resultados"
      description="No hay documentos que coincidan con los filtros actuales."
    />
  );
}
function ParticipantsSummary({ items }: { items: BulkCampaignItem[] }) {
  const unique = new Map(items.map((item) => [item.participantEmail, item]));
  return (
    <div className="grid gap-px bg-slate-200 sm:grid-cols-2 xl:grid-cols-3 dark:bg-border">
      {Array.from(unique.values()).map((item) => (
        <div
          key={item.participantEmail}
          className="flex items-center gap-3 bg-white p-4 dark:bg-card"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-50 text-sm font-600 text-primary">
            {item.participantName
              .split(' ')
              .map((part) => part[0])
              .slice(0, 2)
              .join('')}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-600">{item.participantName}</p>
            <p className="truncate text-xs text-slate-500">{item.participantEmail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
function IncidentsPanel({ items }: { items: BulkCampaignItem[] }) {
  return items.length ? (
    <div className="divide-y divide-slate-200 dark:divide-border">
      {items.map((item) => (
        <div key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-600">
            <AlertTriangle size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-600">{item.documentName}</p>
            <p className="mt-0.5 text-xs text-slate-500">{item.errorMessage}</p>
          </div>
          <button className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-600">
            <RefreshCw size={13} /> Reintentar
          </button>
        </div>
      ))}
    </div>
  ) : (
    <EmptyState
      title="Sin incidencias abiertas"
      description="Los errores individuales apareceran aqui sin detener el resto de la campana."
      icon={CheckCircle2}
    />
  );
}
function EvidencePanel({ campaign }: { campaign: BulkCampaignSummary }) {
  return (
    <div className="grid gap-4 p-4 md:grid-cols-3">
      <EvidenceCard
        title="Evidencia individual"
        detail={`${campaign.completedItems} documentos con hash, firma y bitacora propia.`}
      />
      <EvidenceCard
        title="Manifest consolidado"
        detail="Inventario verificable de resultados y excepciones de la campana."
      />
      <EvidenceCard
        title="Constancia de campana"
        detail={
          campaign.status === 'completed'
            ? 'Lista para generar al cerrar hermeticamente.'
            : 'Disponible cuando finalice el procesamiento.'
        }
      />
    </div>
  );
}
function ReportsPanel({ campaign }: { campaign: BulkCampaignSummary }) {
  return (
    <div className="grid gap-4 p-4 sm:grid-cols-3">
      <ReportButton title="Reporte operativo" detail="Excel con estados e incidencias" />
      <ReportButton
        title="Documentos firmados"
        detail={`ZIP con ${campaign.completedItems} archivos`}
      />
      <ReportButton title="Resumen ejecutivo" detail="PDF de avance y resultados" />
    </div>
  );
}
function EvidenceCard({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-md border border-slate-200 p-4 dark:border-border">
      <ShieldCheck size={18} className="text-emerald-600" />
      <h3 className="mt-3 text-sm font-600">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  );
}
function ReportButton({ title, detail }: { title: string; detail: string }) {
  return (
    <button className="flex items-start gap-3 rounded-md border border-slate-200 p-4 text-left hover:border-blue-200 hover:bg-blue-50/30 dark:border-border">
      <Download size={17} className="mt-0.5 text-primary" />
      <span>
        <span className="block text-sm font-600">{title}</span>
        <span className="mt-1 block text-xs text-slate-500">{detail}</span>
      </span>
    </button>
  );
}
function EmptyState({
  title,
  description,
  icon: Icon = FileText,
}: {
  title: string;
  description: string;
  icon?: React.ElementType;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-md bg-slate-100 text-slate-500">
        <Icon size={20} />
      </span>
      <h3 className="mt-3 text-sm font-600">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>
    </div>
  );
}
function ItemStatus({ status }: { status: BulkCampaignItem['status'] }) {
  const labels: Record<BulkCampaignItem['status'], string> = {
    pending: 'Pendiente',
    generating: 'Generando',
    sent: 'Enviado',
    viewed: 'Visto',
    signed: 'Firmado',
    rejected: 'Rechazado',
    expired: 'Vencido',
    failed: 'Error',
  };
  const tone =
    status === 'signed'
      ? 'bg-emerald-50 text-emerald-700'
      : status === 'failed' || status === 'rejected'
        ? 'bg-red-50 text-red-700'
        : status === 'viewed'
          ? 'bg-blue-50 text-blue-700'
          : 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-600 ${tone}`}>
      {labels[status]}
    </span>
  );
}
function MiniMetric({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: number;
  tone?: 'slate' | 'green' | 'blue' | 'red';
}) {
  const colors = {
    slate: 'text-slate-950',
    green: 'text-emerald-700',
    blue: 'text-blue-700',
    red: 'text-red-700',
  };
  return (
    <div className="px-3 first:pl-0">
      <p className={`text-xl font-600 ${colors[tone]}`}>{value.toLocaleString('es-MX')}</p>
      <p className="mt-0.5 text-xs text-slate-500">{label}</p>
    </div>
  );
}
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-600 text-slate-800 dark:text-foreground">{value}</span>
    </div>
  );
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
function mapItem(row: any): BulkCampaignItem {
  return {
    id: row.id,
    documentId: row.document_id || undefined,
    documentName: row.source_payload?.documentName || row.source_row_id || 'Documento',
    participantName: row.source_payload?.participantName || 'Participante',
    participantEmail: row.source_payload?.participantEmail || '',
    status: row.status || 'pending',
    progress: Number(row.progress || 0),
    errorMessage: row.error_message || undefined,
    updatedAt: row.updated_at || new Date().toISOString(),
  };
}
