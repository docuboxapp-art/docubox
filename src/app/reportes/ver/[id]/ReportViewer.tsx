'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, Columns3, Download, FileJson, FileSpreadsheet, FileText, LayoutDashboard, LineChart as LineIcon, PieChart as PieIcon, RefreshCw, Search, Table2, X } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { BUILTIN_REPORTS, DATASETS, type DatasetId, type ReportDefinition, type ReportField, type ReportRow, type Visualization } from '@/lib/reporting/catalog';
import { aggregate, displayValue, runReport, safeConfig } from '@/lib/reporting/engine';
import { exportReport } from '@/lib/reporting/export';

const colors = ['#2467ec','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4'];
const visualizations: { id: Visualization; label: string; icon: typeof Table2 }[] = [
  { id: 'table', label: 'Tabla', icon: Table2 }, { id: 'bar', label: 'Barras', icon: BarChart3 },
  { id: 'line', label: 'Líneas', icon: LineIcon }, { id: 'pie', label: 'Circular', icon: PieIcon },
  { id: 'kpi', label: 'Indicadores', icon: LayoutDashboard },
];

export default function ReportViewer({ reportId }: { reportId: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;
  const [report, setReport] = useState<ReportDefinition | null>(BUILTIN_REPORTS.find(item => item.id === reportId) || null);
  const [fields, setFields] = useState<ReportField[]>([]);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [generatedAt, setGeneratedAt] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[] | null>(null);
  const [visualization, setVisualization] = useState<Visualization | null>(null);
  const [periodOverride, setPeriodOverride] = useState<string>('configured');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (report || !workspaceId || !user) return;
    let cancelled = false;
    supabase.from('report_definitions').select('id,name,description,dataset,config,created_by,updated_at')
      .eq('workspace_id', workspaceId).eq('id', reportId).single().then(({ data, error: loadError }) => {
        if (cancelled) return;
        if (loadError || !data || !DATASETS[data.dataset as DatasetId]) { setError('No se encontró el informe en este espacio.'); setLoading(false); return; }
        const dataset = data.dataset as DatasetId;
        setReport({ ...data, dataset, config: safeConfig(data.config, dataset), system: false });
      });
    return () => { cancelled = true; };
  }, [report, reportId, workspaceId, user?.id, supabase]);

  const loadData = useCallback(async () => {
    if (!report || !workspaceId || !user) return;
    setRefreshing(true);
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) { setError('Inicia sesión para consultar el informe.'); setLoading(false); setRefreshing(false); return; }
    try {
      const response = await fetch(`/api/reportes/datos?workspaceId=${workspaceId}&dataset=${report.dataset}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudieron cargar los datos.');
      setRows(result.rows || []); setFields(result.fields || DATASETS[report.dataset].fields);
      setTruncated(Boolean(result.truncated)); setGeneratedAt(result.generatedAt || ''); setError('');
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar los datos.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [report, workspaceId, user?.id, supabase]);
  useEffect(() => { const timer = window.setTimeout(() => { void loadData(); }, 0); return () => window.clearTimeout(timer); }, [loadData]);

  const effective = useMemo(() => report ? { ...report.config,
    period: periodOverride === 'configured' ? report.config.period : periodOverride as ReportDefinition['config']['period'] } : null,
  [report, periodOverride]);
  const configuredRows = useMemo(() => effective ? runReport(rows, effective, fields) : [], [rows, effective, fields]);
  const selectedFields = useMemo(() => fields.filter(field => report?.config.fields.includes(field.id)), [fields, report]);
  const tableFields = selectedFields.filter(field => !visibleColumns || visibleColumns.includes(field.id));
  const searched = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es');
    return !term ? configuredRows : configuredRows.filter(row => selectedFields.some(field => displayValue(row[field.id], field.type).toLocaleLowerCase('es').includes(term)));
  }, [configuredRows, search, selectedFields]);
  const chartData = effective?.groupBy ? aggregate(searched, effective.groupBy, effective.metric) : [];
  const currentView = visualization || report?.config.visualization || 'table';
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(searched.length / pageSize));
  const shown = searched.slice((Math.min(page, pageCount) - 1) * pageSize, Math.min(page, pageCount) * pageSize);
  const exportAs = async (format: 'pdf' | 'xlsx' | 'csv' | 'json') => {
    if (!report || !selectedFields.length) return;
    setExporting(true); setError('');
    try { await exportReport(report.name, selectedFields, searched, format); }
    catch (exportError) { setError(exportError instanceof Error ? exportError.message : 'No se pudo exportar el informe.'); }
    finally { setExporting(false); }
  };

  return <AppLayout noPadding><main className="-mx-4 -my-4 min-h-[calc(100vh-4rem)] bg-[#f6f8fb] md:-my-6">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 sm:px-8"><div><p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Visualización de informe</p><h1 className="text-xl font-semibold text-slate-950">{report?.name || 'Informe'}</h1><p className="mt-1 text-sm text-slate-500">{report?.description}</p></div><button onClick={() => router.push('/reportes')} className="flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm text-slate-700"><X size={16} />Cerrar</button></header>
    <div className="mx-auto max-w-[1600px] space-y-4 p-5 sm:p-8">
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {report && <><div className="flex flex-wrap items-center gap-2 text-xs text-slate-500"><span className="rounded-full bg-blue-50 px-2.5 py-1 font-semibold text-blue-700">{report.system ? 'Creado por Docubox' : 'Personalizado'}</span><span>{DATASETS[report.dataset].label}</span><span>·</span><span>{searched.length} registros accesibles para ti</span>{generatedAt && <span>· Actualizado {new Date(generatedAt).toLocaleString('es-MX')}</span>}</div>
      <section className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"><div className="relative min-w-[210px] flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input aria-label="Buscar dentro del informe" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Buscar en resultados..." className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm" /></div><select aria-label="Periodo de visualización" value={periodOverride} onChange={event => { setPeriodOverride(event.target.value); setPage(1); }} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="configured">Periodo configurado</option><option value="all">Todo</option><option value="7d">7 días</option><option value="30d">30 días</option><option value="90d">90 días</option><option value="1y">1 año</option></select><button onClick={() => void loadData()} disabled={refreshing} className="flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm disabled:opacity-50"><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />Actualizar</button><button onClick={() => setColumnsOpen(value => !value)} className="flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm"><Columns3 size={15} />Columnas</button></section>
      {columnsOpen && <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-3">{selectedFields.map(field => <label key={field.id} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs"><input type="checkbox" checked={!visibleColumns || visibleColumns.includes(field.id)} onChange={() => setVisibleColumns(current => { const next = current || selectedFields.map(item => item.id); return next.includes(field.id) ? next.filter(id => id !== field.id) : [...next, field.id]; })} />{field.label}</label>)}</div>}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"><div className="flex flex-wrap gap-1">{visualizations.map(item => { const Icon = item.icon; return <button key={item.id} onClick={() => setVisualization(item.id)} aria-pressed={currentView === item.id} className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold ${currentView === item.id ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50'}`}><Icon size={14} />{item.label}</button>; })}</div><div className="flex flex-wrap gap-1">{([['pdf',FileText],['xlsx',FileSpreadsheet],['csv',Download],['json',FileJson]] as const).map(([format, Icon]) => <button key={format} onClick={() => void exportAs(format)} disabled={exporting || loading || truncated} className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-700 disabled:opacity-50"><Icon size={14} />{format === 'xlsx' ? 'Excel' : format.toUpperCase()}</button>)}</div></section>
      {truncated && <p role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Hay más de 10 000 registros. Ajusta las condiciones antes de exportar para obtener un conjunto completo.</p>}
      {loading ? <p className="rounded-lg border border-slate-200 bg-white p-10 text-sm text-slate-500">Preparando informe...</p> : <section className="min-h-[340px] rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        {currentView === 'table' ? <><div className="overflow-auto"><table className="min-w-full text-left text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{tableFields.map(field => <th key={field.id} className="whitespace-nowrap px-3 py-3">{field.label}</th>)}</tr></thead><tbody>{shown.map((row, index) => <tr key={index} className="border-b border-slate-100 hover:bg-slate-50">{tableFields.map(field => <td key={field.id} className="max-w-[300px] truncate px-3 py-3" title={displayValue(row[field.id], field.type)}>{displayValue(row[field.id], field.type)}</td>)}</tr>)}</tbody></table></div>{searched.length === 0 && <p className="py-16 text-center text-sm text-slate-500">No hay datos que coincidan con esta configuración.</p>}<div className="mt-4 flex items-center justify-between text-xs text-slate-500"><span>{searched.length} resultados · página {Math.min(page, pageCount)} de {pageCount}</span><div className="flex gap-2"><button disabled={page <= 1} onClick={() => setPage(value => value - 1)} className="h-8 rounded-md border border-slate-200 px-3 disabled:opacity-40">Anterior</button><button disabled={page >= pageCount} onClick={() => setPage(value => value + 1)} className="h-8 rounded-md border border-slate-200 px-3 disabled:opacity-40">Siguiente</button></div></div></>
          : !effective?.groupBy ? <div className="flex min-h-[280px] items-center justify-center text-center text-sm text-slate-500">Este informe no tiene un campo de agrupación. Configura uno para usar gráficas o indicadores.</div>
          : currentView === 'kpi' ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{chartData.map(item => <div key={item.label} className="rounded-lg border border-blue-100 bg-blue-50 p-5"><strong className="block text-2xl text-blue-700">{item.value.toLocaleString('es-MX')}</strong><span className="mt-2 block text-sm text-slate-700">{item.label}</span></div>)}</div>
          : chartData.length === 0 ? <p className="py-16 text-center text-sm text-slate-500">No hay datos para la gráfica.</p>
          : <div className="h-[460px] w-full"><ResponsiveContainer width="100%" height="100%">{currentView === 'bar' ? <BarChart data={chartData} margin={{ top: 20, right: 20, left: 10, bottom: 70 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" angle={-30} textAnchor="end" interval={0} height={80} fontSize={11} /><YAxis /><Tooltip /><Bar dataKey="value" name="Valor" fill="#2467ec" radius={[5,5,0,0]} /></BarChart> : currentView === 'line' ? <LineChart data={chartData} margin={{ top: 20, right: 20, left: 10, bottom: 70 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" angle={-30} textAnchor="end" interval={0} height={80} fontSize={11} /><YAxis /><Tooltip /><Line dataKey="value" stroke="#2467ec" strokeWidth={2} /></LineChart> : <PieChart><Pie data={chartData} dataKey="value" nameKey="label" cx="50%" cy="45%" outerRadius={150} label>{chartData.map((entry, index) => <Cell key={entry.label} fill={colors[index % colors.length]} />)}</Pie><Tooltip /><Legend /></PieChart>}</ResponsiveContainer></div>}
      </section>}
      <div className="flex flex-wrap justify-end gap-2">{report.system ? <button onClick={() => router.push(`/reportes/constructor?preset=${report.id}`)} className="h-9 rounded-md border border-slate-200 bg-white px-4 text-sm text-slate-700">Personalizar copia</button> : report.created_by === user?.id ? <button onClick={() => router.push(`/reportes/constructor?report=${report.id}`)} className="h-9 rounded-md border border-slate-200 bg-white px-4 text-sm text-slate-700">Editar configuración</button> : null}</div>
      </>}
    </div>
  </main></AppLayout>;
}
