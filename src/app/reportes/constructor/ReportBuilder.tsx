'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, Check, Eye, Plus, Save, Trash2, X } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { BUILTIN_REPORTS, DATASETS, datasetIds, defaultConfig, type Condition, type DatasetId, type ReportConfig, type ReportField, type ReportRow } from '@/lib/reporting/catalog';
import { aggregate, displayValue, runReport, safeConfig } from '@/lib/reporting/engine';

const operators: { id: Condition['operator']; label: string }[] = [
  { id: 'eq', label: 'Es igual a' }, { id: 'neq', label: 'No es igual a' }, { id: 'contains', label: 'Contiene' },
  { id: 'gt', label: 'Mayor que' }, { id: 'gte', label: 'Mayor o igual' }, { id: 'lt', label: 'Menor que' },
  { id: 'lte', label: 'Menor o igual' }, { id: 'empty', label: 'Está vacío' }, { id: 'not_empty', label: 'Tiene valor' },
];
const control = 'h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none';

export default function ReportBuilder({ reportId, presetId }: { reportId: string | null; presetId: string | null }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;
  const preset = BUILTIN_REPORTS.find(item => item.id === presetId);
  const [name, setName] = useState(preset ? `${preset.name} · personalizado` : '');
  const [description, setDescription] = useState(preset?.description || '');
  const [dataset, setDataset] = useState<DatasetId>(preset?.dataset || 'documentos');
  const [config, setConfig] = useState<ReportConfig>(preset ? structuredClone(preset.config) : defaultConfig('documentos'));
  const [fields, setFields] = useState<ReportField[]>(DATASETS[preset?.dataset || 'documentos'].fields);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(Boolean(reportId));
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!reportId || !workspaceId) return;
    let cancelled = false;
    supabase.from('report_definitions').select('id,name,description,dataset,config,created_by')
      .eq('workspace_id', workspaceId).eq('id', reportId).single().then(({ data, error: loadError }) => {
        if (cancelled) return;
        if (loadError || !data || data.created_by !== user?.id || !datasetIds.includes(data.dataset as DatasetId)) setError('No puedes editar este informe.');
        else { const kind = data.dataset as DatasetId; setName(data.name); setDescription(data.description || ''); setDataset(kind); setConfig(safeConfig(data.config, kind)); }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [reportId, workspaceId, user?.id, supabase]);

  useEffect(() => {
    if (!workspaceId || !user) return;
    let cancelled = false;
    const load = async () => {
      setPreviewLoading(true);
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) { if (!cancelled) setError('Inicia sesión para consultar los datos.'); return; }
      const response = await fetch(`/api/reportes/datos?workspaceId=${workspaceId}&dataset=${dataset}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const result = await response.json();
      if (cancelled) return;
      if (!response.ok) { setError(result.error || 'No se pudieron cargar los datos.'); setRows([]); }
      else { setRows(result.rows || []); setFields(result.fields || DATASETS[dataset].fields); setError(''); }
      setPreviewLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [workspaceId, user?.id, dataset, supabase]);

  const result = useMemo(() => runReport(rows, config, fields), [rows, config, fields]);
  const selectedFields = fields.filter(field => config.fields.includes(field.id));
  const groups = config.groupBy ? aggregate(result, config.groupBy, config.metric) : [];
  const change = (patch: Partial<ReportConfig>) => setConfig(previous => ({ ...previous, ...patch }));
  const updateCondition = (index: number, patch: Partial<Condition>) => change({ conditions: config.conditions.map((item, position) => position === index ? { ...item, ...patch } : item) });
  const save = async () => {
    if (!workspaceId || !user || name.trim().length < 3 || !config.fields.length) { setError('Indica un nombre y al menos un campo.'); return; }
    setSaving(true); setError('');
    const payload = { workspace_id: workspaceId, created_by: user.id, name: name.trim(), description: description.trim(), dataset, config };
    const query = reportId ? supabase.from('report_definitions').update({ name: payload.name, description: payload.description, dataset, config }).eq('id', reportId).eq('workspace_id', workspaceId)
      : supabase.from('report_definitions').insert(payload);
    const { error: saveError } = await query;
    setSaving(false);
    if (saveError) { setError(saveError.message); return; }
    router.push('/reportes');
  };

  return <AppLayout noPadding><main className="-mx-4 -my-4 min-h-[calc(100vh-4rem)] bg-[#f6f8fb] md:-my-6">
    <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
      <div><h1 className="text-xl font-semibold text-slate-950">Constructor de informes</h1><p className="text-sm text-slate-500">Define datos, condiciones y visualización para este espacio.</p></div>
      <div className="flex gap-2"><button onClick={() => router.push('/reportes')} className="flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm"><X size={16} />Cerrar</button><button onClick={() => void save()} disabled={saving || loading || Boolean(reportId && error)} className="flex h-9 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50"><Save size={16} />{saving ? 'Guardando...' : 'Guardar y salir'}</button></div>
    </header>
    <div className="mx-auto grid max-w-[1600px] gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_minmax(350px,0.7fr)] sm:p-8">
      <div className="space-y-5">
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="mb-4 text-base font-semibold">1. Datos del informe</h2><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Nombre<input maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="Nombre del informe" className={`${control} mt-2`} /></label><label className="text-sm font-medium">Módulo<select value={dataset} onChange={event => { const next = event.target.value as DatasetId; setDataset(next); setConfig(defaultConfig(next)); setFields(DATASETS[next].fields); }} className={`${control} mt-2`}>{datasetIds.map(id => <option key={id} value={id}>{DATASETS[id].label}</option>)}</select></label></div><label className="mt-4 block text-sm font-medium">Descripción<textarea maxLength={500} rows={2} value={description} onChange={event => setDescription(event.target.value)} className="mt-2 w-full rounded-md border border-slate-200 p-3 text-sm" /></label><p className="mt-2 text-xs text-slate-500">{DATASETS[dataset].description}</p></section>
        <section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="text-base font-semibold">2. Campos visibles</h2><p className="mt-1 text-sm text-slate-500">Selecciona las columnas del informe. Las respuestas capturadas muestran sus campos disponibles.</p><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{fields.map(field => <label key={field.id} className={`flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm ${config.fields.includes(field.id) ? 'border-blue-300 bg-blue-50' : 'border-slate-200'}`}><input type="checkbox" checked={config.fields.includes(field.id)} onChange={() => change({ fields: config.fields.includes(field.id) ? config.fields.filter(id => id !== field.id) : [...config.fields, field.id] })} className="accent-blue-600" />{field.label}</label>)}</div></section>
        <section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="text-base font-semibold">3. Flujo y condiciones</h2><div className="mt-4 grid gap-3 sm:grid-cols-3"><label className="text-sm">Periodo<select value={config.period} onChange={event => change({ period: event.target.value as ReportConfig['period'] })} className={`${control} mt-1`}><option value="all">Todo el historial</option><option value="7d">7 días</option><option value="30d">30 días</option><option value="90d">90 días</option><option value="1y">1 año</option></select></label><label className="text-sm">Fecha de referencia<select value={config.dateField} onChange={event => change({ dateField: event.target.value })} className={`${control} mt-1`}><option value="">Sin fecha</option>{fields.filter(field => field.type === 'date').map(field => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label><label className="text-sm">Coincidencia<select value={config.match} onChange={event => change({ match: event.target.value as ReportConfig['match'] })} className={`${control} mt-1`}><option value="all">Todas las condiciones</option><option value="any">Cualquier condición</option></select></label></div>
          <div className="mt-4 space-y-2">{config.conditions.map((condition, index) => <div key={index} className="grid gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-[1fr_1fr_1fr_auto]"><select aria-label={`Campo de condición ${index + 1}`} value={condition.field} onChange={event => updateCondition(index, { field: event.target.value })} className={control}>{fields.map(field => <option key={field.id} value={field.id}>{field.label}</option>)}</select><select aria-label={`Operador ${index + 1}`} value={condition.operator} onChange={event => updateCondition(index, { operator: event.target.value as Condition['operator'] })} className={control}>{operators.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select><input aria-label={`Valor ${index + 1}`} value={condition.value} onChange={event => updateCondition(index, { value: event.target.value })} disabled={['empty','not_empty'].includes(condition.operator)} placeholder="Valor" className={control} /><button onClick={() => change({ conditions: config.conditions.filter((_, position) => position !== index) })} aria-label="Quitar condición" className="flex h-10 w-10 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={16} /></button></div>)}<button onClick={() => fields.length && change({ conditions: [...config.conditions, { field: fields[0].id, operator: 'eq', value: '' }] })} disabled={config.conditions.length >= 12} className="flex h-9 items-center gap-2 rounded-md border border-dashed border-blue-300 px-3 text-sm text-blue-700 disabled:opacity-40"><Plus size={15} />Añadir condición</button></div>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="text-base font-semibold">4. Presentación</h2><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm">Visualización<select value={config.visualization} onChange={event => change({ visualization: event.target.value as ReportConfig['visualization'] })} className={`${control} mt-1`}><option value="table">Tabla</option><option value="bar">Barras</option><option value="line">Líneas</option><option value="pie">Circular</option><option value="kpi">Indicadores</option></select></label><label className="text-sm">Agrupar por<select value={config.groupBy} onChange={event => change({ groupBy: event.target.value })} className={`${control} mt-1`}><option value="">Sin agrupar</option>{fields.filter(field => field.type !== 'number').map(field => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label><label className="text-sm">Medida<select value={config.metric} onChange={event => change({ metric: event.target.value })} className={`${control} mt-1`}><option value="__count">Número de registros</option>{fields.filter(field => field.type === 'number').map(field => <option key={field.id} value={field.id}>Suma de {field.label}</option>)}</select></label><label className="text-sm">Ordenar por<select value={config.sortBy} onChange={event => change({ sortBy: event.target.value })} className={`${control} mt-1`}><option value="">Orden original</option>{fields.map(field => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label><label className="text-sm">Dirección<select value={config.sortDirection} onChange={event => change({ sortDirection: event.target.value as ReportConfig['sortDirection'] })} className={`${control} mt-1`}><option value="desc">Descendente</option><option value="asc">Ascendente</option></select></label></div></section>
      </div>
      <aside className="h-fit rounded-lg border border-slate-200 bg-white p-5 xl:sticky xl:top-24"><h2 className="flex items-center gap-2 text-base font-semibold"><Eye size={18} className="text-blue-600" />Vista previa</h2><p className="mt-1 text-sm text-slate-500">{previewLoading ? 'Consultando datos...' : `${result.length} registros coinciden con las condiciones.`}</p><div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-md bg-blue-50 p-3"><strong className="block text-xl text-blue-700">{result.length}</strong><span className="text-xs text-blue-700">Registros</span></div><div className="rounded-md bg-slate-50 p-3"><strong className="block text-xl">{groups.length}</strong><span className="text-xs text-slate-500">Grupos</span></div></div>{groups.length > 0 && <div className="mt-4 space-y-1">{groups.slice(0, 5).map(item => <div key={item.label} className="flex justify-between border-b border-slate-100 py-1 text-xs"><span className="truncate">{item.label}</span><strong>{item.value}</strong></div>)}</div>}<div className="mt-4 overflow-auto rounded-md border border-slate-200"><table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{selectedFields.slice(0, 4).map(field => <th key={field.id} className="whitespace-nowrap px-3 py-2">{field.label}</th>)}</tr></thead><tbody>{result.slice(0, 5).map((row, index) => <tr key={index} className="border-t border-slate-100">{selectedFields.slice(0, 4).map(field => <td key={field.id} className="max-w-36 truncate px-3 py-2">{displayValue(row[field.id], field.type)}</td>)}</tr>)}</tbody></table>{result.length === 0 && <p className="p-4 text-sm text-slate-500">Sin datos para esta selección.</p>}</div><div className="mt-4 flex items-center gap-2 text-xs text-slate-500"><Check size={15} className="text-green-600" />La vista previa usa datos reales del espacio.</div></aside>
    </div>
  </main></AppLayout>;
}
