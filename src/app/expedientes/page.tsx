'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, ChevronDown, Clock3, Filter, FolderKanban, MoreHorizontal, Plus, Search, ShieldCheck, UserRound } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { CASE_STATUS_META, DEMO_CASE_FILES, type CaseFileSummary } from '@/lib/case-files/schema';
import { CaseStatusBadge, CaseWorkspace, HumanEmpty, MetricCard, ProgressBar, SectionHeader, TrafficBadge } from './components/CaseUI';

export default function ExpedientesPage() {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const [items, setItems] = useState<CaseFileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('all');
  const [onlyMine, setOnlyMine] = useState(false);

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data, error } = await createClient().from('case_files').select('*').eq('workspace_id', activeWorkspace.id).order('updated_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        setItems(DEMO_CASE_FILES);
        setDemoMode(true);
      } else {
        setItems((data || []).map(mapCaseRow));
        setDemoMode(false);
      }
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [activeWorkspace?.id]);

  const filtered = useMemo(() => items.filter((item) => {
    const haystack = `${item.folio} ${item.title} ${item.participant} ${item.responsible}`.toLowerCase();
    return haystack.includes(query.toLowerCase()) && (status === 'all' || item.status === status) && (type === 'all' || item.caseType === type) && (!onlyMine || item.responsible.includes('Luis'));
  }), [items, onlyMine, query, status, type]);

  const metrics = useMemo(() => ({
    active: items.filter((item) => !['sealed', 'cancelled'].includes(item.status)).length,
    review: items.filter((item) => item.status === 'in_review').length,
    observed: items.filter((item) => item.status === 'observed').length,
    closing: items.filter((item) => item.status === 'ready_to_close').length,
  }), [items]);

  const types = Array.from(new Set(items.map((item) => item.caseType)));

  return (
    <AppLayout noPadding>
      <CaseWorkspace>
        <SectionHeader
          title="Expedientes"
          description="Gestiona expedientes digitales verificables en tu espacio de trabajo."
          action={<button onClick={() => router.push('/expedientes/nuevo')} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-600 text-primary-foreground shadow-[0_8px_18px_-12px_rgba(30, 107, 255,0.85)] transition hover:bg-primary/90"><Plus size={16} /> Nuevo expediente</button>}
        />

        <div className="grid grid-cols-2 gap-3 pb-5 lg:grid-cols-4">
          <MetricCard label="Expedientes activos" value={metrics.active} detail="En integración, revisión o firma" tone="amber" />
          <MetricCard label="En revisión" value={metrics.review} detail="Información enviada por validar" tone="amber" />
          <MetricCard label="Con observaciones" value={metrics.observed} detail="Requieren una corrección clara" tone="red" />
          <MetricCard label="Listos para cierre" value={metrics.closing} detail="Cumplen las reglas configuradas" tone="green" />
        </div>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-200/30 dark:border-border dark:bg-card">
          <header className="border-b border-slate-200 p-4 dark:border-border">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por folio, expediente, participante o responsable" className="h-10 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-border dark:bg-background" />
              </div>
              <FilterSelect value={status} onChange={setStatus} label="Todos los estados" options={Object.entries(CASE_STATUS_META).map(([value, meta]) => ({ value, label: meta.label }))} />
              <FilterSelect value={type} onChange={setType} label="Todos los tipos" options={types.map((value) => ({ value, label: value }))} />
              <button onClick={() => setOnlyMine(!onlyMine)} className={`inline-flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium transition ${onlyMine ? 'border-primary bg-blue-50 text-primary' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-border dark:text-muted-foreground'}`}><UserRound size={15} /> Mis expedientes</button>
            </div>
            {demoMode && <div className="mt-3 flex items-center gap-2 rounded-md bg-blue-50 px-3 py-2 text-xs text-slate-600"><ShieldCheck size={14} className="text-primary" />Vista local de referencia. La información persistente se activará con la migración del módulo.</div>}
          </header>

          {loading ? <div className="flex min-h-80 items-center justify-center"><span className="h-7 w-7 animate-spin rounded-full border-2 border-primary/20 border-t-primary" /></div> : filtered.length === 0 ? <HumanEmpty title="No hay expedientes con estos filtros" message="Ajusta los filtros o abre un expediente nuevo con el wizard guiado." action={<button onClick={() => router.push('/expedientes/nuevo')} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Nuevo expediente</button>} /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] border-collapse">
                <thead><tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-border dark:bg-muted/40"><Heading>Expediente</Heading><Heading>Participante</Heading><Heading>Progreso</Heading><Heading>Estado</Heading><Heading>Pendientes</Heading><Heading>Fecha objetivo</Heading><Heading>Responsable</Heading><Heading align="right">Acciones</Heading></tr></thead>
                <tbody className="divide-y divide-slate-200 dark:divide-border">{filtered.map((item) => (
                  <tr key={item.id} className="group transition hover:bg-slate-50/80 dark:hover:bg-muted/30">
                    <td className="px-4 py-4"><button onClick={() => router.push(`/expedientes/${item.id}`)} className="flex items-center gap-3 text-left"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-blue-100 bg-blue-50 text-primary"><FolderKanban size={18} /></span><span><span className="block max-w-[330px] truncate text-sm font-semibold text-slate-950 dark:text-foreground">{item.title}</span><span className="mt-0.5 flex items-center gap-2 text-xs text-slate-500"><span className="font-medium text-primary">{item.folio}</span><span>·</span><span>{item.caseType}</span></span></span></button></td>
                    <td className="px-4 py-4"><p className="max-w-52 truncate text-sm text-slate-700 dark:text-foreground">{item.participant}</p><p className="mt-0.5 text-xs text-slate-500">{item.caseSubtype || 'Expediente general'}</p></td>
                    <td className="px-4 py-4"><ProgressBar value={item.progress} compact /></td>
                    <td className="px-4 py-4"><CaseStatusBadge status={item.status} /></td>
                    <td className="px-4 py-4">{item.openObservations > 0 ? <TrafficBadge tone="red">{item.openObservations} {item.openObservations === 1 ? 'observación' : 'observaciones'}</TrafficBadge> : item.pendingItems > 0 ? <TrafficBadge tone="amber">{item.pendingItems} {item.pendingItems === 1 ? 'pendiente' : 'pendientes'}</TrafficBadge> : <TrafficBadge tone="green">Completo</TrafficBadge>}</td>
                    <td className="px-4 py-4"><p className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-foreground"><CalendarDays size={14} className="text-slate-500" />{formatDate(item.targetCloseAt)}</p><p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Clock3 size={12} />Actividad {relativeDate(item.lastActivityAt)}</p></td>
                    <td className="px-4 py-4 text-sm text-slate-700 dark:text-foreground">{item.responsible}</td>
                    <td className="px-4 py-4"><div className="flex justify-end gap-1.5"><button onClick={() => router.push(`/expedientes/${item.id}`)} className="h-8 rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-border dark:text-foreground">Abrir</button>{item.status === 'in_review' && <button onClick={() => router.push(`/expedientes/${item.id}?tab=documentos`)} className="h-8 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground">Revisar</button>}<button aria-label={`Más acciones para ${item.folio}`} className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-border"><MoreHorizontal size={15} /></button></div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
      </CaseWorkspace>
    </AppLayout>
  );
}

function mapCaseRow(row: any): CaseFileSummary {
  return { id: row.id, folio: row.folio, title: row.title, caseType: row.case_type, caseSubtype: row.case_subtype, participant: row.subject_name || 'Sin participante', responsible: row.responsible_area || 'Sin asignar', status: row.status, progress: row.progress || 0, priority: row.priority, sensitivity: row.sensitivity_level, pendingItems: row.pending_items || 0, openObservations: row.open_observations || 0, targetCloseAt: row.target_close_at, lastActivityAt: row.updated_at };
}

function FilterSelect({ value, onChange, label, options }: { value: string; onChange: (value: string) => void; label: string; options: { value: string; label: string }[] }) {
  return <div className="relative"><Filter size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 min-w-48 appearance-none rounded-md border border-slate-200 bg-white pl-8 pr-9 text-sm text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-border dark:bg-card dark:text-foreground"><option value="all">{label}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" /></div>;
}

function Heading({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`px-4 py-3 text-xs font-semibold text-slate-500 ${align === 'right' ? 'text-right' : 'text-left'}`}>{children}</th>;
}

function formatDate(value?: string) { if (!value) return 'Sin fecha'; const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value; return new Date(normalized).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }); }
function relativeDate(value: string) { const days = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 86400000)); return days === 0 ? 'hoy' : `hace ${days} día${days === 1 ? '' : 's'}`; }
