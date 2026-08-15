'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AreaChart as AreaChartIcon,
  ArrowLeft,
  BarChart3,
  Calendar,
  Check,
  ChevronDown,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  LineChart as LineChartIcon,
  ListFilter,
  PieChart as PieChartIcon,
  Plus,
  RefreshCw,
  Save,
  Search,
  Star,
  Table2,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface ReportDocument {
  id: string;
  nombre: string;
  estado: string;
  created_at: string;
  tipo_documento_id: string | null;
  participantes?: unknown;
  es_urgente?: boolean | null;
}

export interface ReportMonthlyData {
  mes: string;
  creados: number;
  completados: number;
  cancelados: number;
}

export interface ReportParticipant {
  nombre: string;
  email: string;
  total: number;
  firmados: number;
}

export interface ReportAuditEntry {
  id: string;
  action: string;
  documento_nombre: string | null;
  created_at: string;
}

export interface ReportStats {
  total: number;
  borrador: number;
  en_proceso: number;
  completado: number;
  cancelado: number;
  vencido: number;
}

type DatasetId = 'documentos' | 'participantes' | 'actividad' | 'auditoria';
type Visualization = 'table' | 'bar' | 'line' | 'area' | 'pie' | 'kpi';
type Period = '7d' | '30d' | '90d' | '1y';
type ReportCategory = 'Todos' | 'Documentos' | 'Firmas' | 'Actividad' | 'Auditoría' | 'Personalizados';

interface FieldDefinition {
  id: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'boolean';
}

interface ReportConfig {
  id: string;
  name: string;
  description: string;
  category: Exclude<ReportCategory, 'Todos'>;
  dataset: DatasetId;
  visualization: Visualization;
  fields: string[];
  groupBy: string;
  metric: string;
  createdAt?: string;
  custom?: boolean;
}

interface ReportsWorkspaceProps {
  loading: boolean;
  isLive: boolean;
  period: Period;
  onPeriodChange: (period: Period) => void;
  onRefresh: () => void;
  stats: ReportStats;
  documents: ReportDocument[];
  monthlyData: ReportMonthlyData[];
  participants: ReportParticipant[];
  auditEntries: ReportAuditEntry[];
  typeNames: Record<string, string>;
}

const PERIOD_LABELS: Record<Period, string> = {
  '7d': 'Últimos 7 días',
  '30d': 'Últimos 30 días',
  '90d': 'Últimos 90 días',
  '1y': 'Último año',
};

const STATUS_LABELS: Record<string, string> = {
  borrador: 'Borrador',
  en_proceso: 'En progreso',
  enviado: 'En progreso',
  completado: 'Completado',
  cancelado: 'Cancelado',
  vencido: 'Vencido',
};

const DATASET_LABELS: Record<DatasetId, string> = {
  documentos: 'Documentos',
  participantes: 'Participantes y firmas',
  actividad: 'Actividad por periodo',
  auditoria: 'Auditoría',
};

const DATASET_FIELDS: Record<DatasetId, FieldDefinition[]> = {
  documentos: [
    { id: 'nombre', label: 'Documento', type: 'text' },
    { id: 'estado', label: 'Estado', type: 'text' },
    { id: 'tipo', label: 'Tipo documental', type: 'text' },
    { id: 'fecha', label: 'Fecha de creación', type: 'date' },
    { id: 'mes', label: 'Mes', type: 'text' },
    { id: 'participantes', label: 'Participantes', type: 'number' },
    { id: 'urgente', label: 'Urgente', type: 'boolean' },
  ],
  participantes: [
    { id: 'nombre', label: 'Participante', type: 'text' },
    { id: 'email', label: 'Correo', type: 'text' },
    { id: 'total', label: 'Participaciones', type: 'number' },
    { id: 'firmados', label: 'Firmados', type: 'number' },
    { id: 'tasa', label: 'Tasa de firma', type: 'number' },
  ],
  actividad: [
    { id: 'mes', label: 'Periodo', type: 'text' },
    { id: 'creados', label: 'Creados', type: 'number' },
    { id: 'completados', label: 'Completados', type: 'number' },
    { id: 'cancelados', label: 'Cancelados', type: 'number' },
  ],
  auditoria: [
    { id: 'accion', label: 'Acción', type: 'text' },
    { id: 'documento', label: 'Documento', type: 'text' },
    { id: 'fecha', label: 'Fecha', type: 'date' },
    { id: 'mes', label: 'Mes', type: 'text' },
  ],
};

const VISUALIZATIONS: Array<{ id: Visualization; label: string; icon: React.ElementType }> = [
  { id: 'table', label: 'Tabla', icon: Table2 },
  { id: 'bar', label: 'Barras', icon: BarChart3 },
  { id: 'line', label: 'Líneas', icon: LineChartIcon },
  { id: 'area', label: 'Área', icon: AreaChartIcon },
  { id: 'pie', label: 'Pastel', icon: PieChartIcon },
  { id: 'kpi', label: 'Indicadores', icon: LayoutDashboard },
];

const REPORT_PRESETS: ReportConfig[] = [
  {
    id: 'resumen-ejecutivo',
    name: 'Resumen ejecutivo de documentos',
    description: 'Indicadores generales del volumen y estado de tus documentos.',
    category: 'Documentos',
    dataset: 'documentos',
    visualization: 'kpi',
    fields: ['nombre', 'estado', 'tipo', 'fecha'],
    groupBy: 'estado',
    metric: '__count',
  },
  {
    id: 'estado-documentos',
    name: 'Estado de los documentos',
    description: 'Distribución de documentos por etapa del proceso.',
    category: 'Documentos',
    dataset: 'documentos',
    visualization: 'pie',
    fields: ['nombre', 'estado', 'tipo', 'fecha', 'participantes'],
    groupBy: 'estado',
    metric: '__count',
  },
  {
    id: 'actividad-documental',
    name: 'Actividad documental por periodo',
    description: 'Documentos creados, completados y cancelados a través del tiempo.',
    category: 'Actividad',
    dataset: 'actividad',
    visualization: 'bar',
    fields: ['mes', 'creados', 'completados', 'cancelados'],
    groupBy: 'mes',
    metric: 'creados',
  },
  {
    id: 'tipos-documento',
    name: 'Documentos por tipo',
    description: 'Comparativo del uso de cada tipo documental.',
    category: 'Documentos',
    dataset: 'documentos',
    visualization: 'bar',
    fields: ['nombre', 'tipo', 'estado', 'fecha'],
    groupBy: 'tipo',
    metric: '__count',
  },
  {
    id: 'participacion-firmas',
    name: 'Participación y firmas',
    description: 'Actividad y tasa de firma de cada participante.',
    category: 'Firmas',
    dataset: 'participantes',
    visualization: 'table',
    fields: ['nombre', 'email', 'total', 'firmados', 'tasa'],
    groupBy: 'nombre',
    metric: 'firmados',
  },
  {
    id: 'auditoria-actividad',
    name: 'Registro de auditoría',
    description: 'Detalle cronológico de acciones y eventos registrados.',
    category: 'Auditoría',
    dataset: 'auditoria',
    visualization: 'table',
    fields: ['accion', 'documento', 'fecha'],
    groupBy: 'accion',
    metric: '__count',
  },
];

const CHART_COLORS = ['#1E6BFF', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

function cloneConfig(config: ReportConfig): ReportConfig {
  return { ...config, fields: [...config.fields] };
}

function createBlankReport(): ReportConfig {
  return {
    id: `custom-${Date.now()}`,
    name: 'Nuevo informe',
    description: 'Informe personalizado de Docubox.',
    category: 'Personalizados',
    dataset: 'documentos',
    visualization: 'table',
    fields: ['nombre', 'estado', 'tipo', 'fecha'],
    groupBy: 'estado',
    metric: '__count',
    custom: true,
  };
}

function monthLabel(dateValue: string) {
  const date = new Date(dateValue);
  return date.toLocaleDateString('es-MX', { month: 'short', year: 'numeric' });
}

function formatDate(value: unknown) {
  if (!value) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function escapeCsv(value: unknown) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadFile(contents: string, type: string, filename: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function ReportsWorkspace({
  loading,
  isLive,
  period,
  onPeriodChange,
  onRefresh,
  stats,
  documents,
  monthlyData,
  participants,
  auditEntries,
  typeNames,
}: ReportsWorkspaceProps) {
  const [activeReport, setActiveReport] = useState<ReportConfig | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<ReportCategory>('Todos');
  const [periodOpen, setPeriodOpen] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [savedReports, setSavedReports] = useState<ReportConfig[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    try {
      const storedReports = JSON.parse(localStorage.getItem('docubox_saved_reports') || '[]');
      const storedFavorites = JSON.parse(localStorage.getItem('docubox_report_favorites') || '[]');
      if (Array.isArray(storedReports)) setSavedReports(storedReports);
      if (Array.isArray(storedFavorites)) setFavorites(new Set(storedFavorites));
    } catch {}
  }, []);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  };

  const allReports = useMemo(() => [...REPORT_PRESETS, ...savedReports], [savedReports]);
  const filteredReports = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allReports.filter((report) => {
      const matchesCategory = category === 'Todos' || report.category === category;
      const matchesSearch = !query || `${report.name} ${report.description}`.toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [allReports, category, search]);

  const rows = useMemo<Array<Record<string, string | number | boolean>>>(() => {
    if (!activeReport) return [];
    if (activeReport.dataset === 'documentos') {
      return documents.map((doc) => ({
        nombre: doc.nombre || 'Sin nombre',
        estado: STATUS_LABELS[doc.estado] || doc.estado || 'Sin estado',
        tipo: doc.tipo_documento_id ? typeNames[doc.tipo_documento_id] || 'Sin clasificar' : 'Sin clasificar',
        fecha: doc.created_at,
        mes: monthLabel(doc.created_at),
        participantes: Array.isArray(doc.participantes) ? doc.participantes.length : 0,
        urgente: Boolean(doc.es_urgente),
      }));
    }
    if (activeReport.dataset === 'participantes') {
      return participants.map((participant) => ({
        nombre: participant.nombre,
        email: participant.email,
        total: participant.total,
        firmados: participant.firmados,
        tasa: participant.total ? Math.round((participant.firmados / participant.total) * 100) : 0,
      }));
    }
    if (activeReport.dataset === 'actividad') {
      return monthlyData.map((item) => ({ ...item }));
    }
    return auditEntries.map((entry) => ({
      accion: (entry.action || 'evento').replace(/_/g, ' '),
      documento: entry.documento_nombre || '—',
      fecha: entry.created_at,
      mes: monthLabel(entry.created_at),
    }));
  }, [activeReport, auditEntries, documents, monthlyData, participants, typeNames]);

  const availableFields = activeReport ? DATASET_FIELDS[activeReport.dataset] : [];
  const selectedFields = activeReport
    ? availableFields.filter((field) => activeReport.fields.includes(field.id))
    : [];
  const groupFields = availableFields.filter((field) => field.type === 'text' || field.type === 'date' || field.type === 'boolean');
  const metricFields = availableFields.filter((field) => field.type === 'number');

  const chartData = useMemo(() => {
    if (!activeReport) return [];
    const grouped = new Map<string, number>();
    rows.forEach((row) => {
      const groupValue = row[activeReport.groupBy];
      const label = groupValue == null || groupValue === '' ? 'Sin dato' : String(groupValue);
      const value = activeReport.metric === '__count' ? 1 : Number(row[activeReport.metric] || 0);
      grouped.set(label, (grouped.get(label) || 0) + value);
    });
    const groupedRows = Array.from(grouped.entries()).map(([name, value]) => ({ name, value }));
    if (activeReport.dataset === 'actividad' || activeReport.groupBy === 'mes') {
      return groupedRows.slice(0, 12);
    }
    return groupedRows.sort((a, b) => b.value - a.value).slice(0, 12);
  }, [activeReport, rows]);

  const updateReport = (changes: Partial<ReportConfig>) => {
    setActiveReport((current) => (current ? { ...current, ...changes } : current));
  };

  const changeDataset = (dataset: DatasetId) => {
    const fields = DATASET_FIELDS[dataset];
    const firstGroup = fields.find((field) => field.type !== 'number')?.id || fields[0].id;
    const firstMetric = fields.find((field) => field.type === 'number')?.id || '__count';
    updateReport({
      dataset,
      fields: fields.slice(0, 5).map((field) => field.id),
      groupBy: firstGroup,
      metric: dataset === 'actividad' ? firstMetric : '__count',
    });
  };

  const toggleField = (fieldId: string) => {
    if (!activeReport) return;
    const exists = activeReport.fields.includes(fieldId);
    if (exists && activeReport.fields.length === 1) return;
    updateReport({
      fields: exists
        ? activeReport.fields.filter((id) => id !== fieldId)
        : [...activeReport.fields, fieldId],
    });
  };

  const toggleFavorite = (reportId: string) => {
    const next = new Set(favorites);
    if (next.has(reportId)) next.delete(reportId);
    else next.add(reportId);
    setFavorites(next);
    localStorage.setItem('docubox_report_favorites', JSON.stringify(Array.from(next)));
  };

  const saveReport = () => {
    if (!activeReport) return;
    const saved: ReportConfig = {
      ...activeReport,
      id: activeReport.custom ? activeReport.id : `custom-${Date.now()}`,
      category: 'Personalizados',
      custom: true,
      createdAt: new Date().toISOString(),
    };
    const next = [saved, ...savedReports.filter((report) => report.id !== saved.id)];
    setSavedReports(next);
    setActiveReport(saved);
    localStorage.setItem('docubox_saved_reports', JSON.stringify(next));
    showToast('Informe guardado en Mis informes');
  };

  const exportCsv = () => {
    if (!activeReport) return;
    const headers = selectedFields.map((field) => field.label);
    const dataLines = rows.map((row) => selectedFields.map((field) => escapeCsv(row[field.id])).join(','));
    const csv = `\uFEFF${headers.map(escapeCsv).join(',')}\n${dataLines.join('\n')}`;
    downloadFile(csv, 'text/csv;charset=utf-8', `${activeReport.name.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}.csv`);
    showToast('Archivo CSV generado');
  };

  const exportJson = () => {
    if (!activeReport) return;
    const exportRows = rows.map((row) => Object.fromEntries(selectedFields.map((field) => [field.label, row[field.id]])));
    downloadFile(JSON.stringify(exportRows, null, 2), 'application/json', `${activeReport.name.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}.json`);
    showToast('Archivo JSON generado');
  };

  if (activeReport) {
    return (
      <div className="mx-auto w-full max-w-[1600px]">
        <header className="mb-4 flex flex-col gap-3 border-b border-slate-200/80 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <button
              type="button"
              onClick={() => setActiveReport(null)}
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
              title="Volver a informes"
            >
              <ArrowLeft size={16} />
            </button>
            <div className="min-w-0">
              <p className="mb-1 text-xs font-700 uppercase text-slate-400">Constructor de informes</p>
              <input
                value={activeReport.name}
                onChange={(event) => updateReport({ name: event.target.value })}
                className="w-full max-w-2xl border-0 bg-transparent p-0 text-2xl font-700 text-slate-950 outline-none"
                aria-label="Nombre del informe"
              />
              <p className="mt-1 text-sm text-slate-500">Configura los datos y la visualización; la vista previa se actualiza automáticamente.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pl-11 lg:pl-0">
            <button onClick={exportJson} className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-600 text-slate-700 transition-colors hover:bg-slate-50">
              <FileJson size={15} />
              JSON
            </button>
            <button onClick={exportCsv} className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-600 text-slate-700 transition-colors hover:bg-slate-50">
              <Download size={15} />
              CSV
            </button>
            <button onClick={saveReport} className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-700 text-white shadow-[0_8px_18px_-12px_rgba(30, 107, 255,0.85)] transition-colors hover:bg-primary/90">
              <Save size={15} />
              Guardar informe
            </button>
          </div>
        </header>

        <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="h-fit rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-700 text-slate-900">Configuración</h2>
              <p className="mt-0.5 text-xs text-slate-500">Define el contenido del informe.</p>
            </div>
            <div className="space-y-5 p-4">
              <div>
                <label className="mb-1.5 block text-xs font-700 text-slate-600">Fuente de datos</label>
                <select
                  value={activeReport.dataset}
                  onChange={(event) => changeDataset(event.target.value as DatasetId)}
                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  aria-label="Fuente de datos"
                >
                  {Object.entries(DATASET_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </div>

              <div>
                <p className="mb-2 text-xs font-700 text-slate-600">Visualización</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {VISUALIZATIONS.map((view) => {
                    const ViewIcon = view.icon;
                    const active = activeReport.visualization === view.id;
                    return (
                      <button
                        key={view.id}
                        onClick={() => updateReport({ visualization: view.id })}
                        className={`flex h-14 flex-col items-center justify-center gap-1 rounded-md border text-[11px] font-600 transition-colors ${active ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
                      >
                        <ViewIcon size={15} />
                        {view.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {activeReport.visualization !== 'table' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-700 text-slate-600">Agrupar por</label>
                    <select value={activeReport.groupBy} onChange={(event) => updateReport({ groupBy: event.target.value })} className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-400" aria-label="Agrupar por">
                      {groupFields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-700 text-slate-600">Métrica</label>
                    <select value={activeReport.metric} onChange={(event) => updateReport({ metric: event.target.value })} className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-400" aria-label="Métrica">
                      <option value="__count">Cantidad</option>
                      {metricFields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
                    </select>
                  </div>
                </div>
              )}

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-700 text-slate-600">Campos incluidos</p>
                  <span className="text-[11px] text-slate-400">{activeReport.fields.length} seleccionados</span>
                </div>
                <div className="space-y-1">
                  {availableFields.map((field) => {
                    const checked = activeReport.fields.includes(field.id);
                    return (
                      <button
                        key={field.id}
                        onClick={() => toggleField(field.id)}
                        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-slate-600 transition-colors hover:bg-slate-50"
                      >
                        <span>{field.label}</span>
                        <span className={`flex h-4 w-4 items-center justify-center rounded border ${checked ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'}`}>
                          {checked && <Check size={11} />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </aside>

          <section className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-sm font-700 text-slate-900">Vista previa</h2>
                <p className="mt-0.5 text-xs text-slate-500">{rows.length} registros · {PERIOD_LABELS[period]}</p>
              </div>
              <span className="inline-flex h-7 items-center rounded-md bg-slate-100 px-2.5 text-xs font-600 text-slate-600">{DATASET_LABELS[activeReport.dataset]}</span>
            </div>
            <ReportPreview
              config={activeReport}
              rows={rows}
              fields={selectedFields}
              chartData={chartData}
              stats={stats}
            />
          </section>
        </div>

        {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      </div>
    );
  }

  const categories: ReportCategory[] = ['Todos', 'Documentos', 'Firmas', 'Actividad', 'Auditoría', 'Personalizados'];

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <header className="mb-4 flex flex-col gap-3 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            {isLive && <span className="inline-flex items-center gap-1 text-[11px] font-600 text-emerald-600"><Wifi size={11} /> En vivo</span>}
          </div>
          <h1 className="text-2xl font-700 text-slate-950">Informes y análisis</h1>
          <p className="mt-1 text-sm text-slate-500">Consulta información, crea visualizaciones y exporta los datos de tu espacio.</p>
        </div>
        <button onClick={() => setActiveReport(createBlankReport())} className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-700 text-white shadow-[0_8px_18px_-12px_rgba(30, 107, 255,0.85)] transition-colors hover:bg-primary/90">
          <Plus size={16} />
          Crear informe
        </button>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="relative min-w-[240px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre o descripción..." className="h-9 w-full rounded-md border border-slate-200 bg-slate-50/60 pl-9 pr-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100" />
        </div>
        <div className="relative">
          <button onClick={() => setPeriodOpen((open) => !open)} className="flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-600 text-slate-700 transition-colors hover:bg-slate-50">
            <Calendar size={15} className="text-slate-400" />
            {PERIOD_LABELS[period]}
            <ChevronDown size={14} className="text-slate-400" />
          </button>
          {periodOpen && (
            <div className="absolute right-0 top-11 z-30 w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
              {(Object.keys(PERIOD_LABELS) as Period[]).map((option) => (
                <button key={option} onClick={() => { onPeriodChange(option); setPeriodOpen(false); }} className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs transition-colors ${period === option ? 'bg-blue-50 font-700 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                  {PERIOD_LABELS[option]}
                  {period === option && <Check size={13} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={onRefresh} className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50" title="Actualizar datos">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {categories.map((item) => (
          <button key={item} onClick={() => setCategory(item)} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-600 transition-colors ${category === item ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {item}
            {item === 'Personalizados' && savedReports.length > 0 && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{savedReports.length}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 text-sm text-slate-500"><RefreshCw size={18} className="animate-spin text-blue-600" /> Preparando informes...</div>
        </div>
      ) : filteredReports.length === 0 ? (
        <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-slate-200 bg-white px-6 text-center shadow-sm">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50"><FileText size={20} className="text-blue-600" /></div>
          <h2 className="text-sm font-700 text-slate-900">No encontramos informes</h2>
          <p className="mt-1 text-sm text-slate-500">Cambia los filtros o crea un informe personalizado.</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filteredReports.map((report) => (
            <ReportRow
              key={report.id}
              report={report}
              favorite={favorites.has(report.id)}
              onFavorite={() => toggleFavorite(report.id)}
              onOpen={() => setActiveReport(cloneConfig(report))}
            />
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <SummaryMetric icon={FileSpreadsheet} label="Documentos analizados" value={stats.total} />
        <SummaryMetric icon={Users} label="Participantes identificados" value={participants.length} />
        <SummaryMetric icon={Activity} label="Eventos de auditoría" value={auditEntries.length} />
      </div>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

function ReportRow({ report, favorite, onFavorite, onOpen }: { report: ReportConfig; favorite: boolean; onFavorite: () => void; onOpen: () => void }) {
  const visualization = VISUALIZATIONS.find((item) => item.id === report.visualization) || VISUALIZATIONS[0];
  const VisualizationIcon = visualization.icon;
  return (
    <article className="group flex min-h-[112px] items-center gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-blue-200 hover:shadow-md">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><VisualizationIcon size={19} /></div>
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-sm font-700 text-slate-900 group-hover:text-blue-700">{report.name}</h2>
          {report.custom && <span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-700 text-violet-600">Personalizado</span>}
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{report.description}</p>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400"><span>{report.category}</span><span>·</span><span>{DATASET_LABELS[report.dataset]}</span><span>·</span><span>{visualization.label}</span></div>
      </button>
      <button onClick={onFavorite} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${favorite ? 'bg-amber-50 text-amber-500' : 'text-slate-300 hover:bg-slate-50 hover:text-slate-600'}`} title={favorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}>
        <Star size={17} fill={favorite ? 'currentColor' : 'none'} />
      </button>
    </article>
  );
}

function SummaryMetric({ icon: MetricIcon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-500"><MetricIcon size={15} /></div>
      <div><p className="text-lg font-700 tabular-nums text-slate-900">{value}</p><p className="text-xs text-slate-500">{label}</p></div>
    </div>
  );
}

function ReportPreview({ config, rows, fields, chartData, stats }: { config: ReportConfig; rows: Array<Record<string, string | number | boolean>>; fields: FieldDefinition[]; chartData: Array<{ name: string; value: number }>; stats: ReportStats }) {
  if (rows.length === 0) {
    return <div className="flex min-h-[440px] flex-col items-center justify-center px-6 text-center"><div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100"><ListFilter size={19} className="text-slate-400" /></div><p className="text-sm font-700 text-slate-800">No hay datos para esta configuración</p><p className="mt-1 text-xs text-slate-500">Prueba otro periodo o fuente de datos.</p></div>;
  }

  if (config.visualization === 'table') {
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/80">
            <tr>{fields.map((field) => <th key={field.id} className="px-4 py-3 text-left text-xs font-700 text-slate-500">{field.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.slice(0, 50).map((row, index) => (
              <tr key={index} className="hover:bg-slate-50/70">
                {fields.map((field) => <td key={field.id} className="max-w-[260px] truncate px-4 py-3 text-xs text-slate-700">{field.type === 'date' ? formatDate(row[field.id]) : field.type === 'boolean' ? (row[field.id] ? 'Sí' : 'No') : String(row[field.id] ?? '—')}{field.id === 'tasa' ? '%' : ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-slate-200 px-4 py-2 text-xs text-slate-400">Mostrando {Math.min(rows.length, 50)} de {rows.length} registros</div>
      </div>
    );
  }

  if (config.visualization === 'kpi') {
    const top = [...chartData].sort((a, b) => b.value - a.value)[0];
    const completionRate = stats.total ? Math.round((stats.completado / stats.total) * 100) : 0;
    return (
      <div className="grid min-h-[440px] content-center gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="Registros" value={rows.length} accent="blue" />
        <KpiTile label="Categorías" value={chartData.length} accent="slate" />
        <KpiTile label="Grupo principal" value={top?.value || 0} detail={top?.name || 'Sin datos'} accent="emerald" />
        <KpiTile label="Tasa de completación" value={`${completionRate}%`} accent="amber" />
      </div>
    );
  }

  return (
    <div className="h-[500px] p-5">
      <ResponsiveContainer width="100%" height="100%">
        {config.visualization === 'bar' ? (
          <BarChart data={chartData} margin={{ top: 12, right: 12, left: -18, bottom: 28 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} angle={-20} textAnchor="end" interval={0} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} />
            <Bar dataKey="value" name="Valor" fill="#1E6BFF" radius={[4, 4, 0, 0]} maxBarSize={42} />
          </BarChart>
        ) : config.visualization === 'line' ? (
          <LineChart data={chartData} margin={{ top: 12, right: 20, left: -18, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} />
            <Line type="monotone" dataKey="value" name="Valor" stroke="#1E6BFF" strokeWidth={2.5} dot={{ r: 3, fill: '#1E6BFF' }} />
          </LineChart>
        ) : config.visualization === 'area' ? (
          <AreaChart data={chartData} margin={{ top: 12, right: 20, left: -18, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} />
            <Area type="monotone" dataKey="value" name="Valor" stroke="#1E6BFF" fill="#dbeafe" strokeWidth={2.5} />
          </AreaChart>
        ) : (
          <PieChart>
            <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="47%" innerRadius={74} outerRadius={132} paddingAngle={2}>
              {chartData.map((_, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function KpiTile({ label, value, detail, accent }: { label: string; value: string | number; detail?: string; accent: 'blue' | 'slate' | 'emerald' | 'amber' }) {
  const styles = { blue: 'bg-blue-50 text-blue-700', slate: 'bg-slate-100 text-slate-700', emerald: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700' }[accent];
  return <div className="rounded-lg border border-slate-200 bg-white p-4"><div className={`mb-4 h-1.5 w-8 rounded ${styles}`} /><p className="text-xs font-600 text-slate-500">{label}</p><p className="mt-1 text-3xl font-700 tabular-nums text-slate-950">{value}</p>{detail && <p className="mt-2 truncate text-xs text-slate-500">{detail}</p>}</div>;
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border border-emerald-200 bg-white px-4 py-3 text-sm font-600 text-slate-700 shadow-xl"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check size={12} /></span>{message}<button onClick={onClose} className="ml-1 text-slate-400 hover:text-slate-700"><X size={14} /></button></div>;
}
