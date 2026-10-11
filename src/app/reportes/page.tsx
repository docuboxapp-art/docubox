'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BarChart3, ChevronDown, ChevronUp, FileText, LayoutGrid, List, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { BUILTIN_REPORTS, DATASETS, datasetIds, type DatasetId, type ReportDefinition } from '@/lib/reporting/catalog';
import { safeConfig } from '@/lib/reporting/engine';

export default function ReportesPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;
  const [saved, setSaved] = useState<ReportDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [summary, setSummary] = useState({ documents: 0, tasks: 0 });
  const [query, setQuery] = useState('');
  const [dataset, setDataset] = useState<DatasetId | 'all'>('all');
  const [origin, setOrigin] = useState<'all' | 'system' | 'user'>('all');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [view, setView] = useState<'grid' | 'list'>('grid');

  const load = useCallback(async () => {
    if (!workspaceId || !user) { setSaved([]); setSummary({ documents: 0, tasks: 0 }); setLoading(false); return; }
    setLoading(true);
    setSaved([]);
    setSummary({ documents: 0, tasks: 0 });
    const { data, error: loadError } = await supabase.from('report_definitions')
      .select('id,workspace_id,created_by,name,description,dataset,config,created_at,updated_at')
      .eq('workspace_id', workspaceId).order('updated_at', { ascending: false });
    if (loadError) setError('No se pudieron consultar los informes guardados.');
    else { setError(''); setSaved((data || []).filter(row => datasetIds.includes(row.dataset as DatasetId)).map(row => ({
      ...row, dataset: row.dataset as DatasetId, config: safeConfig(row.config, row.dataset as DatasetId), system: false,
    }))); }
    setLoading(false);
    const session = await supabase.auth.getSession();
    const jwt = session.data.session?.access_token;
    if (!jwt) return;
    const getCount = async (kind: DatasetId) => {
      const response = await fetch(`/api/reportes/datos?workspaceId=${workspaceId}&dataset=${kind}`,
        { headers: { Authorization: `Bearer ${jwt}` }, cache: 'no-store' });
      if (!response.ok) return 0;
      const result = await response.json();
      return kind === 'tareas' ? (result.rows || []).filter((row: { estado: string }) => !['completada','cancelada','rechazada'].includes(row.estado)).length : Number(result.total || 0);
    };
    const [documents, tasks] = await Promise.all([getCount('documentos'), getCount('tareas')]);
    setSummary({ documents, tasks });
  }, [workspaceId, user?.id, supabase]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const reports = useMemo(() => [...BUILTIN_REPORTS, ...saved].filter(report => {
    if (dataset !== 'all' && report.dataset !== dataset) return false;
    if (origin === 'system' && !report.system) return false;
    if (origin === 'user' && report.system) return false;
    const term = query.trim().toLocaleLowerCase('es');
    return !term || `${report.name} ${report.description} ${DATASETS[report.dataset].label}`.toLocaleLowerCase('es').includes(term);
  }).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'es')
    : a.system !== b.system ? Number(b.system) - Number(a.system)
      : (b.updated_at || '').localeCompare(a.updated_at || '')), [saved, dataset, origin, query, sort]);

  const remove = async (report: ReportDefinition) => {
    if (!user || report.system || report.created_by !== user.id) return;
    if (!window.confirm(`¿Eliminar el informe “${report.name}”?`)) return;
    const { error: removeError } = await supabase.from('report_definitions').delete().eq('id', report.id).eq('workspace_id', workspaceId);
    if (removeError) setError('No se pudo eliminar el informe.'); else void load();
  };

  return <AppLayout noPadding><main className="-mx-4 -my-4 min-h-[calc(100vh-4rem)] bg-[#f6f8fb] px-4 py-5 sm:px-6 md:-my-6">
    <div className="mx-auto max-w-[1600px] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4">
        <div><h1 className="text-2xl font-semibold text-slate-950">Reportes</h1><p className="mt-1 text-sm text-slate-500">Consulta informes del espacio y crea análisis con datos actualizados.</p></div>
        <Link href="/reportes/constructor" className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"><Plus size={16} />Crear informe</Link>
      </header>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <button type="button" onClick={() => setSummaryOpen(value => !value)} aria-expanded={summaryOpen} className="flex w-full items-center text-left"><span className="flex-1"><span className="block text-sm font-semibold text-slate-950">Resumen de reportes</span><span className="text-xs text-slate-500">Datos del espacio de trabajo actual.</span></span><span className="mr-3 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{BUILTIN_REPORTS.length + saved.length} informes</span>{summaryOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
        {summaryOpen && <div className="mt-4 grid gap-3 sm:grid-cols-3">{[
          { label: 'Informes disponibles', value: BUILTIN_REPORTS.length + saved.length, icon: BarChart3, color: 'text-blue-600 bg-blue-50' },
          { label: 'Documentos analizados', value: summary.documents, icon: FileText, color: 'text-indigo-600 bg-indigo-50' },
          { label: 'Tareas activas', value: summary.tasks, icon: List, color: 'text-amber-600 bg-amber-50' },
        ].map(item => { const Icon = item.icon; return <div key={item.label} className="flex items-center gap-3 rounded-md border border-slate-200 p-4"><span className={`flex h-10 w-10 items-center justify-center rounded-md ${item.color}`}><Icon size={18} /></span><span><strong className="block text-xl font-semibold text-slate-950">{item.value}</strong><span className="text-xs text-slate-500">{item.label}</span></span></div>; })}</div>}
      </section>
      <section className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="relative min-w-[220px] flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar informes..." aria-label="Buscar informes" className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none" /></div>
        <select aria-label="Filtrar módulo" value={dataset} onChange={event => setDataset(event.target.value as DatasetId | 'all')} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="all">Todos los módulos</option>{datasetIds.map(id => <option key={id} value={id}>{DATASETS[id].label}</option>)}</select>
        <select aria-label="Filtrar origen" value={origin} onChange={event => setOrigin(event.target.value as typeof origin)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="all">Todos los informes</option><option value="system">Creados por Docubox</option><option value="user">Personalizados</option></select>
        <select aria-label="Ordenar" value={sort} onChange={event => setSort(event.target.value as typeof sort)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="recent">Más recientes</option><option value="name">Nombre</option></select>
        <div className="flex h-9 items-center rounded-md border border-slate-200 p-1"><button onClick={() => setView('list')} aria-label="Vista de lista" aria-pressed={view === 'list'} className={`flex h-7 w-8 items-center justify-center rounded ${view === 'list' ? 'bg-slate-100 text-slate-900' : 'text-slate-400'}`}><List size={16} /></button><button onClick={() => setView('grid')} aria-label="Vista de cuadrícula" aria-pressed={view === 'grid'} className={`flex h-7 w-8 items-center justify-center rounded ${view === 'grid' ? 'bg-slate-100 text-slate-900' : 'text-slate-400'}`}><LayoutGrid size={16} /></button></div>
      </section>
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading ? <p className="rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500">Cargando informes...</p> : reports.length === 0 ? <p className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">No hay informes que coincidan con los filtros.</p> : <div className={view === 'grid' ? 'grid gap-3 md:grid-cols-2 xl:grid-cols-3' : 'space-y-2'}>{reports.map(report => <article key={report.id} className={`group rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-300 hover:shadow-md ${view === 'list' ? 'flex flex-wrap items-center gap-3' : ''}`}>
        <button onClick={() => router.push(`/reportes/ver/${report.id}`)} className={`flex min-w-0 flex-1 items-start gap-3 text-left ${view === 'grid' ? 'w-full' : ''}`}><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600"><BarChart3 size={19} /></span><span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><strong className="truncate text-sm font-semibold text-slate-950 group-hover:text-blue-700">{report.name}</strong><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${report.system ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'}`}>{report.system ? 'Creado por Docubox' : 'Personalizado'}</span></span><span className="mt-1 block line-clamp-2 text-xs leading-5 text-slate-500">{report.description || 'Informe personalizado del espacio.'}</span><span className="mt-2 block text-xs text-slate-400">{DATASETS[report.dataset].label} · {report.config.fields.length} campos</span></span></button>
        {!report.system && report.created_by === user?.id && <div className="flex items-center gap-1 self-end"><Link href={`/reportes/constructor?report=${report.id}`} aria-label={`Editar ${report.name}`} className="rounded-md p-2 text-slate-500 hover:bg-slate-100"><Pencil size={15} /></Link><button onClick={() => void remove(report)} aria-label={`Eliminar ${report.name}`} className="rounded-md p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button></div>}
      </article>)}</div>}
      {!loading && <p className="text-right text-xs text-slate-500">{reports.length} informes visibles</p>}
    </div>
  </main></AppLayout>;
}
