'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

import { Star, AlertTriangle, AlertCircle, Trash2, FilePlus, FolderPlus, FileText, Search, ArrowUpDown, LayoutList, LayoutGrid, SlidersHorizontal, X, Folder, Share2, Lock, Move, Eye, ChevronRight, ChevronLeft, Plus, Filter, Pencil, Check, Maximize2, Minimize2, Download, Home } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import PersonalizarVistaModal, { DEFAULT_COLUMNS, DEFAULT_FILTERS, ColumnConfig, FilterVisibilityConfig, GridColumnConfig, DEFAULT_GRID_COLUMNS, DEFAULT_CF_COLUMNS } from './components/PersonalizarVistaModal';
import AppLayout from '@/components/AppLayout';

// ─── ResizableTh Component ├───────────────────────────────────────────────────
interface ResizableThProps {
  colKey: string;
  width: number | undefined;
  minWidth?: number;
  onResize: (colKey: string, newWidth: number) => void;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

function ResizableTh({ colKey, width, minWidth = 60, onResize, className = '', style = {}, children }: ResizableThProps) {
  const startX = useRef<number>(0);
  const startWidth = useRef<number>(0);
  const thRef = useRef<HTMLTableCellElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startX.current = e.clientX;
    startWidth.current = thRef.current ? thRef.current.offsetWidth : (width || 120);

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX.current;
      const newWidth = Math.max(minWidth, startWidth.current + delta);
      onResize(colKey, newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [colKey, minWidth, onResize, width]);

  return (
    <th
      ref={thRef}
      className={`relative select-none whitespace-nowrap ${className}`}
      style={{ width: width ? `${width}px` : undefined, ...style }}
    >
      {children}
      <div
        onMouseDown={handleMouseDown}
        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize group/resizer flex items-center justify-center z-10"
        title="Arrastrar para redimensionar"
      >
        <div className="w-0.5 h-4 bg-border group-hover/resizer:bg-primary/50 rounded-full transition-colors" />
      </div>
    </th>
  );
}

// ─── useColumnWidths Hook ├────────────────────────────────────────────────────
// Stores column widths in Supabase (user_view_preferences, view_key='col_widths_config')
// keyed by tableKey inside the column_widths_config JSONB column.
// Falls back to localStorage for instant hydration while Supabase loads.
const COL_WIDTHS_VIEW_KEY = 'col_widths_config';

function useColumnWidths(tableKey: string, defaults: Record<string, number>, userId?: string | null) {
  const storageKey = `docubox_col_widths_${tableKey}`;
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    if (typeof window === 'undefined') return defaults;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) return { ...defaults, ...JSON.parse(stored) };
    } catch {}
    return defaults;
  });

  // Load from Supabase on mount when userId is available
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    supabase
      .from('user_view_preferences')
      .select('column_widths_config')
      .eq('user_id', userId)
      .eq('view_key', COL_WIDTHS_VIEW_KEY)
      .single()
      .then(({ data, error }) => {
        if (!error && data?.column_widths_config) {
          const tableWidths = (data.column_widths_config as Record<string, Record<string, number>>)[tableKey];
          if (tableWidths && typeof tableWidths === 'object') {
            const merged = { ...defaults, ...tableWidths };
            setWidths(merged);
            try { localStorage.setItem(storageKey, JSON.stringify(merged)); } catch {}
          }
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, tableKey]);

  // Debounce ref for Supabase saves
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleResize = useCallback((colKey: string, newWidth: number) => {
    setWidths((prev) => {
      const updated = { ...prev, [colKey]: newWidth };
      // Persist to localStorage immediately
      try { localStorage.setItem(storageKey, JSON.stringify(updated)); } catch {}
      // Debounce Supabase save (500ms)
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        if (!userId) return;
        const supabase = createClient();
        // Read current config first to merge all table widths
        const { data } = await supabase
          .from('user_view_preferences')
          .select('column_widths_config')
          .eq('user_id', userId)
          .eq('view_key', COL_WIDTHS_VIEW_KEY)
          .single();
        const existing = (data?.column_widths_config as Record<string, Record<string, number>>) || {};
        const merged = { ...existing, [tableKey]: updated };
        await supabase
          .from('user_view_preferences')
          .upsert(
            { user_id: userId, view_key: COL_WIDTHS_VIEW_KEY, column_widths_config: merged },
            { onConflict: 'user_id,view_key' }
          );
      }, 500);
      return updated;
    });
  }, [storageKey, tableKey, userId]);

  return { widths, handleResize };
}





interface Document {
  id: string;
  name: string;
  descripcion?: string | null;
  estado: string;
  etiquetas: string[];
  tamano: string;
  ultimaModificacion: string;
  ultimoPaso?: number;
  isDraft?: boolean;
  isFavorite?: boolean;
  fechaVencimiento?: string | null;
  fileUrl?: string | null;
  scanStatus?: string | null;
  scanThreat?: string | null;
  carpetaId?: string | null;
  fechaCreacion?: string | null;
  fechaCompletado?: string | null;
  numeroOficio?: string | null;
  folioInterno?: string | null;
  rutaGuardado?: string | null;
  esUrgente?: boolean;
  participantes?: any[];
  tipoDocumentoId?: string | null;
  tipoDocumentoNombre?: string | null;
  miSubEstado?: string | null;
  ownerName?: string | null;
}

interface DeletedDocument {
  id: string;
  name: string;
  descripcion?: string | null;
  tipo: string;
  eliminadoPor: string;
  fechaEliminacion: string;
  tamano: string;
  retencion?: string | null;
}

interface Carpeta {
  id: string;
  name: string;
  creadoEn: string;
  parentId: string | null;
  descripcion?: string | null;
  tipoDocumentoId?: string | null;
  tipoDocumentoNombre?: string | null;
  grupoTipoDocumentoId?: string | null;
  grupoTipoDocumentoNombre?: string | null;
  tamano?: string;
  numArchivos?: number;
  numCarpetas?: number;
}

interface StatusCounts {
  borrador: number;
  en_proceso: number;
  en_espera: number;
  completado: number;
  rechazado: number;
  cancelado: number;
  vencido: number;
}

interface SubEstadoCounts {
  // Participation states for documents where user is an invited participant
  sin_revisar: number;
  en_revision: number;
  firmo: number;
  rechazo: number;
  aprobo: number;
  cancelo: number;
  urgente_atencion: number;
  participacion_vencida: number;
  // Participation states for participants in user's own documents
  participantes_sin_revisar: number;
  participantes_en_revision: number;
  participantes_firmo: number;
  participantes_rechazo: number;
  participantes_aprobo: number;
  participantes_cancelo: number;
  participantes_urgente_atencion: number;
  participantes_participacion_vencida: number;
  // For sin revisar section
  sin_revisar_propios: number;
  sin_revisar_participantes: number;
  // Legacy (kept for compatibility)
  no_inicializados: number;
}

interface ActivityItem {
  id: string;
  accion: string;
  documento_nombre: string;
  documento_id: string | null;
  created_at: string;
}

interface ContextMenuState {
  open: boolean;
  docId: string | null;
  docName: string;
  isDraft: boolean;
  isFavorite: boolean;
  fileUrl: string | null;
  x: number;
  y: number;
}

interface FolderContextMenuState {
  open: boolean;
  carpetaId: string | null;
  carpetaName: string;
  x: number;
  y: number;
}

interface ConfidentialModalState {
  open: boolean;
  docId: string | null;
  docName: string;
  password: string;
  confirmPassword: string;
  saving: boolean;
  error: string;
}

interface TipoDocumento {
  id: string;
  nombre: string;
}

interface Etiqueta {
  id: string;
  nombre: string;
  color: string;
}

interface WorkspaceUser {
  id: string;
  full_name: string;
  email: string;
}

// ─── Custom Filter Interface ├─────────────────────────────────────────────────
interface CustomFilter {
  id: string;
  nombre: string;
  descripcion?: string;
  icono: string;
  filtros: Record<string, any>;
}

interface GrupoTipoDocumento {
  id: string;
  nombre: string;
}

const sidebarItems = [
  { id: 'mi-espacio', label: 'Mi espacio', icon: FileText },
  { id: 'papelera', label: 'Papelera', icon: Trash2 },
];

const filterOptions = ['Tipo', 'Propietario', 'Modificado', 'Estado', 'Creado', 'Cerrado', 'Etiquetas'];

function getDocIconColor(estado: string): string {
  switch (estado) {
    case 'Borrador': return 'text-gray-400';
    case 'En proceso': return 'text-blue-500';
    case 'En espera': return 'text-orange-500';
    case 'Completado': return 'text-green-500';
    case 'Rechazado': return 'text-red-500';
    case 'Cancelado': return 'text-slate-400';
    default: return 'text-blue-400';
  }
}

function getStatusDot(estado: string): string {
  switch (estado) {
    case 'Borrador': return 'bg-gray-400';
    case 'En proceso': return 'bg-blue-500';
    case 'En espera': return 'bg-orange-500';
    case 'Completado': return 'bg-green-500';
    case 'Rechazado': return 'bg-red-500';
    case 'Cancelado': return 'bg-slate-400';
    default: return 'bg-gray-400';
  }
}

function getParticipacionDot(sub: string): string {
  switch (sub) {
    case 'sin_revisar': return 'bg-amber-400';
    case 'en_revision': return 'bg-cyan-500';
    case 'firmo': case 'firmado': return 'bg-green-500';
    case 'rechazo': case 'rechazado': return 'bg-red-500';
    case 'aprobo': case 'aprobado': return 'bg-blue-500';
    case 'cancelo': case 'cancelado': return 'bg-slate-400';
    case 'urgente_atencion': return 'bg-orange-500';
    case 'participacion_vencida': return 'bg-red-800';
    default: return 'bg-gray-300';
  }
}

function getParticipacionLabel(sub: string): string {
  switch (sub) {
    case 'sin_revisar': return 'Sin revisar';
    case 'en_revision': return 'En revisión';
    case 'firmo': case 'firmado': return 'Firmado';
    case 'rechazo': case 'rechazado': return 'Rechazado';
    case 'aprobo': case 'aprobado': return 'Aprobado';
    case 'cancelo': case 'cancelado': return 'Cancelado';
    case 'urgente_atencion': return 'Urgente atención';
    case 'participacion_vencida': return 'Participación vencida';
    default: return sub;
  }
}

// ─── Date/Time Formatter ├─────────────────────────────────────────────────────
function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  let d = new Date(isoString);
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'p.m.' : 'a.m.';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const hh = String(hours).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${minutes} ${ampm}`;
}

function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  let d = new Date(isoString);
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
// ─────────────────────────────────────────────────────────────────────────────

function mapDocRow(d: any): Document {
  return {
    id: d.id,
    name: d.nombre || 'Sin nombre',
    descripcion: d.descripcion || null,
    estado:
      d.estado === 'borrador' ? 'Borrador'
      : d.estado === 'en_proceso' ? 'En proceso'
      : d.estado === 'en_progreso' ? 'En proceso'
      : d.estado === 'en_espera' ? 'En espera'
      : d.estado === 'completado' ? 'Completado'
      : d.estado === 'rechazado' ? 'Rechazado'
      : d.estado === 'cancelado' ? 'Cancelado'
      : d.estado || 'Borrador',
    etiquetas: d.etiquetas_ids || [],
    tamano: d.file_size ? `${Math.round(d.file_size / 1024)} KB` : '—',
    ultimaModificacion: d.updated_at ? formatDateTime(d.updated_at) : '—',
    ultimoPaso: d.ultimo_paso || 1,
    isDraft: d.estado === 'borrador',
    isFavorite: !!d.is_favorite,
    fechaVencimiento: d.fecha_vencimiento || null,
    fileUrl: d.file_url || null,
    scanStatus: d.scan_status || null,
    scanThreat: d.scan_threat || null,
    carpetaId: d.carpeta_id || null,
    fechaCreacion: d.created_at ? formatDateTime(d.created_at) : null,
    fechaCompletado: d.fecha_completado ? formatDateTime(d.fecha_completado) : null,
    numeroOficio: d.numero_oficio || null,
    folioInterno: d.folio_interno || null,
    rutaGuardado: d.ruta_guardado || null,
    esUrgente: !!d.es_urgente,
    participantes: d.participantes || [],
    tipoDocumentoId: d.tipo_documento_id || null,
    tipoDocumentoNombre: d.tipo_documento?.nombre || null,
    ownerName: d._ownerName || null,
  };
}

// Recursive sidebar folder tree node
function FolderTreeNode({
  carpeta,
  allCarpetas,
  currentFolderId,
  activeSection,
  depth,
  onNavigate,
}: {
  carpeta: Carpeta;
  allCarpetas: Carpeta[];
  currentFolderId: string | null;
  activeSection: string;
  depth: number;
  onNavigate: (carpeta: Carpeta) => void;
}) {
  const children = allCarpetas.filter((c) => c.parentId === carpeta.id);
  const hasChildren = children.length > 0;
  const isActive = activeSection === 'mi-espacio' && currentFolderId === carpeta.id;
  const [expanded, setExpanded] = useState(false);

  // Auto-expand if current folder is a descendant
  useEffect(() => {
    if (currentFolderId && isDescendant(carpeta.id, currentFolderId, allCarpetas)) {
      setExpanded(true);
    }
  }, [currentFolderId]);

  return (
    <div>
      <div
        className={`flex items-center gap-1 rounded-lg text-sm font-medium transition-colors w-full group cursor-pointer ${
          isActive ? 'bg-yellow-50 text-yellow-700' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
        style={{ paddingLeft: `${8 + depth * 12}px`, paddingRight: '4px', paddingTop: '5px', paddingBottom: '5px' }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            className="flex-shrink-0 p-0.5 rounded hover:bg-black/5 transition-colors"
          >
            <ChevronRight size={11} className={`transition-transform ${expanded ? 'rotate-90' : ''} text-muted-foreground/60`} />
          </button>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}
        <button
          onClick={() => onNavigate(carpeta)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left text-sm font-medium"
          title={carpeta.name}
        >
          <Folder size={13} className={`flex-shrink-0 ${isActive ? 'text-yellow-500' : 'text-yellow-400 group-hover:text-yellow-500'}`} />
          <span className="truncate">{carpeta.name}</span>
        </button>
      </div>
      {expanded && hasChildren && (
        <div>
          {children.map((child) => (
            <FolderTreeNode
              key={child.id}
              carpeta={child}
              allCarpetas={allCarpetas}
              currentFolderId={currentFolderId}
              activeSection={activeSection}
              depth={depth + 1}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function isDescendant(ancestorId: string, targetId: string, allCarpetas: Carpeta[]): boolean {
  const target = allCarpetas.find((c) => c.id === targetId);
  if (!target) return false;
  if (target.parentId === ancestorId) return true;
  if (target.parentId) return isDescendant(ancestorId, target.parentId, allCarpetas);
  return false;
}

// ─── DateRangePicker Component ├──────────────────────────────────────────────
const MONTHS_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DAYS_ES = ['lu','ma','mi','ju','vi','sá','do'];

interface DateRange {
  start: Date | null;
  end: Date | null;
}

function DateRangePicker({
  value,
  onChange,
  onBack,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  onBack: () => void;
}) {
  const today = new Date();
  const [leftYear, setLeftYear] = useState(today.getFullYear());
  const [leftMonth, setLeftMonth] = useState(today.getMonth());
  const [hovered, setHovered] = useState<Date | null>(null);
  const [selecting, setSelecting] = useState<DateRange>({ start: value.start, end: value.end });

  const rightMonth = leftMonth === 11 ? 0 : leftMonth + 1;
  const rightYear = leftMonth === 11 ? leftYear + 1 : leftYear;

  const prevMonth = () => {
    if (leftMonth === 0) { setLeftMonth(11); setLeftYear((y) => y - 1); }
    else setLeftMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (leftMonth === 11) { setLeftMonth(0); setLeftYear((y) => y + 1); }
    else setLeftMonth((m) => m + 1);
  };

  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfWeek = (year: number, month: number) => {
    const day = new Date(year, month, 1).getDay();
    return day === 0 ? 6 : day - 1; // Monday = 0
  };

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const isInRange = (date: Date) => {
    const start = selecting.start;
    const end = selecting.end || hovered;
    if (!start || !end) return false;
    const [s, e] = start <= end ? [start, end] : [end, start];
    return date > s && date < e;
  };

  const isStart = (date: Date) => !!selecting.start && isSameDay(date, selecting.start);
  const isEnd = (date: Date) => !!selecting.end && isSameDay(date, selecting.end);

  const handleDayClick = (date: Date) => {
    if (!selecting.start || (selecting.start && selecting.end)) {
      setSelecting({ start: date, end: null });
    } else {
      const [s, e] = date >= selecting.start ? [selecting.start, date] : [date, selecting.start];
      setSelecting({ start: s, end: e });
    }
  };

  const handleApply = () => {
    if (selecting.start && selecting.end) {
      onChange(selecting);
    }
  };

  const renderCalendar = (year: number, month: number) => {
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfWeek(year, month);
    const prevDays = getDaysInMonth(year, month === 0 ? 11 : month - 1);
    const cells: { date: Date; current: boolean }[] = [];

    for (let i = firstDay - 1; i >= 0; i--) {
      let d = new Date(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1, prevDays - i);
      cells.push({ date: d, current: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: new Date(year, month, d), current: true });
    }
    const remaining = 42 - cells.length;
    for (let d = 1; d <= remaining; d++) {
      cells.push({ date: new Date(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1, d), current: false });
    }

    return (
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-center text-foreground mb-3">
          {MONTHS_ES[month]} {year}
        </p>
        <div className="grid grid-cols-7 mb-1">
          {DAYS_ES.map((d) => (
            <div key={d} className="text-center text-xs text-muted-foreground font-medium py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((cell, i) => {
            const inRange = isInRange(cell.date);
            const start = isStart(cell.date);
            const end = isEnd(cell.date);
            const isToday = isSameDay(cell.date, today);
            const isHovered = hovered && !selecting.end && selecting.start && isSameDay(cell.date, hovered);
            return (
              <div
                key={i}
                className={`relative flex items-center justify-center h-8 cursor-pointer select-none
                  ${!cell.current ? 'opacity-30' : ''}
                  ${inRange ? 'bg-primary/10' : ''}
                  ${start || end ? 'bg-primary rounded-full text-white font-semibold' : ''}
                  ${!start && !end && isToday ? 'font-bold text-primary' : ''}
                  ${!start && !end && !inRange ? 'hover:bg-muted rounded-full' : ''}
                  ${isHovered && !start && !end ? 'bg-primary/20 rounded-full' : ''}
                `}
                onClick={() => cell.current && handleDayClick(cell.date)}
                onMouseEnter={() => cell.current && setHovered(cell.date)}
                onMouseLeave={() => setHovered(null)}
              >
                <span className={`text-xs w-7 h-7 flex items-center justify-center rounded-full
                  ${start || end ? 'bg-primary text-white' : ''}
                `}>
                  {cell.date.getDate()}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full" style={{ minWidth: 560 }}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-border">
        <span className="text-sm font-semibold text-foreground">Seleccionar rango</span>
        <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground font-medium transition-colors">Volver</button>
      </div>
      {/* Two calendars side by side */}
      <div className="flex items-start gap-0">
        {/* Left calendar with prev arrow */}
        <div className="flex items-start gap-1 flex-1">
          <button onClick={prevMonth} className="mt-1 p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground flex-shrink-0">
            <ChevronLeft size={16} />
          </button>
          <div className="flex-1">
            {renderCalendar(leftYear, leftMonth)}
          </div>
        </div>
        {/* Divider */}
        <div className="w-px bg-border mx-3 self-stretch" />
        {/* Right calendar with next arrow */}
        <div className="flex items-start gap-1 flex-1">
          <div className="flex-1">
            {renderCalendar(rightYear, rightMonth)}
          </div>
          <button onClick={nextMonth} className="mt-1 p-1 rounded hover:bg-muted transition-colors text-muted-foreground flex-shrink-0">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      {/* Footer */}
      <div className="flex items-center justify-between pt-3 mt-3 border-t border-border">
        <span className="text-xs text-muted-foreground">
          {selecting.start && selecting.end
            ? `${selecting.start.toLocaleDateString('es-MX')} – ${selecting.end.toLocaleDateString('es-MX')}`
            : selecting.start
            ? `Desde: ${selecting.start.toLocaleDateString('es-MX')}`
            : 'Selecciona el rango'}
        </span>
        <button
          onClick={handleApply}
          disabled={!selecting.start || !selecting.end}
          className="px-5 py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Aplicar
        </button>
      </div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

// ─── Period Filter Options ────────────────────────────────────────────────────
const PERIOD_OPTIONS = [
  { value: 'today', label: 'Hoy' },
  { value: '7d', label: 'Últimos 7 días' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: '90d', label: 'Últimos 90 días' },
  { value: 'all', label: 'Todo el historial' },
];

function getPeriodStartDate(period: string): Date | null {
  const now = new Date();
  if (period === 'today') { let d = new Date(now); d.setHours(0,0,0,0); return d; }
  if (period === '7d') return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (period === '30d') return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (period === '90d') return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  return null; // 'all'
}

function PeriodFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const selected = PERIOD_OPTIONS.find((o) => o.value === value) || PERIOD_OPTIONS[2];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-lg bg-white hover:bg-muted transition-colors text-foreground font-medium"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground flex-shrink-0"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <span>{selected.label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-border rounded-xl shadow-lg min-w-[160px] py-1">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full text-left px-4 py-2 text-sm transition-colors hover:bg-muted ${value === opt.value ? 'text-primary font-semibold' : 'text-foreground'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

// ─── EstadoDocumentosSection Component ───────────────────────────────────────
function EstadoDocumentosSection({
  statusCounts,
  rawDocumentsData,
}: {
  statusCounts: StatusCounts;
  rawDocumentsData: any[];
}) {
  const [period, setPeriod] = useState('30d');

  const periodStart = getPeriodStartDate(period);
  const filteredDocs = periodStart
    ? rawDocumentsData.filter((d) => {
        const created = d.created_at ? new Date(d.created_at) : null;
        return created && created >= periodStart;
      })
    : rawDocumentsData;

  const now = new Date();
  const counts = { borrador: 0, en_proceso: 0, en_espera: 0, completado: 0, rechazado: 0, cancelado: 0, vencido: 0 };
  filteredDocs.forEach((d: any) => {
    const s = d.estado || 'borrador';
    if (s === 'borrador') counts.borrador++;
    else if (s === 'en_proceso' || s === 'en_progreso') counts.en_proceso++;
    else if (s === 'en_espera') counts.en_espera++;
    else if (s === 'completado') counts.completado++;
    else if (s === 'rechazado') counts.rechazado++;
    else if (s === 'cancelado') counts.cancelado++;
    if (d.fecha_vencimiento && !['completado', 'cancelado', 'rechazado'].includes(s)) {
      if (new Date(d.fecha_vencimiento) < now) counts.vencido++;
    }
  });

  const items = [
    { label: 'Borrador', count: counts.borrador, color: 'text-gray-600', bg: 'bg-white', border: 'border-gray-300', iconBg: 'bg-gray-100', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-500"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
    { label: 'En progreso', count: counts.en_proceso, color: 'text-blue-700', bg: 'bg-white', border: 'border-blue-300', iconBg: 'bg-blue-100', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-600"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
    { label: 'En espera', count: counts.en_espera, color: 'text-orange-700', bg: 'bg-white', border: 'border-orange-300', iconBg: 'bg-orange-100', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-orange-600"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> },
    { label: 'Completado', count: counts.completado, color: 'text-green-700', bg: 'bg-white', border: 'border-green-300', iconBg: 'bg-green-100', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-600"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> },
    { label: 'Rechazado', count: counts.rechazado, color: 'text-red-700', bg: 'bg-white', border: 'border-red-300', iconBg: 'bg-red-100', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-600"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> },
    { label: 'Cancelado', count: counts.cancelado, color: 'text-slate-600', bg: 'bg-white', border: 'border-slate-300', iconBg: 'bg-slate-100', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-500"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> },
    { label: 'Vencido', count: counts.vencido, color: 'text-rose-700', bg: 'bg-white', border: 'border-rose-400', iconBg: 'bg-rose-100', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-rose-600"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> },
  ];

  return (
    <div className="bg-white border border-border rounded-xl p-5 mb-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-foreground">Estado de los documentos</h2>
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {items.map((s) => (
          <div key={s.label} className={`${s.bg} border-2 ${s.border} rounded-xl p-4 flex flex-col gap-2 min-h-[100px] justify-between shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5`}>
            <div className="flex items-center justify-between">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${s.iconBg}`}>
                {s.icon}
              </div>
            </div>
            <div>
              <span className={`text-3xl font-extrabold ${s.color}`}>{s.count}</span>
              <p className="text-xs text-muted-foreground font-medium mt-0.5">{s.label}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────
function ParticipacionEstadosSection({
  allDocumentsRaw,
  userId,
  userEmail,
}: {
  allDocumentsRaw: any[];
  userId: string | undefined;
  userEmail: string | undefined;
}) {
  const [activeTab, setActiveTab] = useState<'mis_participaciones' | 'participantes_en_mis_docs'>('mis_participaciones');
  const [period, setPeriod] = useState('30d');

  // Filter documents by period based on created_at
  const periodStart = getPeriodStartDate(period);
  const filteredDocs = periodStart
    ? allDocumentsRaw.filter((d) => {
        const created = d.created_at ? new Date(d.created_at) : null;
        return created && created >= periodStart;
      })
    : allDocumentsRaw;

  // ── Compute "mis participaciones" counts ──
  // Documents where the authenticated user is a participant (regardless of owner)
  const now = new Date();
  const in72h = new Date(now.getTime() + 72 * 60 * 60 * 1000);

  let sinRevisarCount = 0;
  let enRevisionCount = 0;
  let firmadoCount = 0;
  let rechazadoCount = 0;
  let aprobadoCount = 0;
  let canceladoCount = 0;
  let urgenteCount = 0;
  let vencidaCount = 0;

  filteredDocs.forEach((d: any) => {
    const parts: any[] = d.participantes || [];
    const userPart = parts.find((p: any) => {
      const pId = p.id || p.user_id || p.userId;
      const pEmail = p.email || '';
      return pId === userId || pEmail === userEmail;
    });
    if (!userPart) return;

    const sub = userPart.sub_estado || 'en_revision';
    const fechaVenc = d.fecha_vencimiento ? new Date(d.fecha_vencimiento) : null;
    const isVencido = fechaVenc && fechaVenc < now;
    const isUrgente = fechaVenc && fechaVenc >= now && fechaVenc <= in72h;

    if (isVencido) { vencidaCount++; return; }
    if (isUrgente) { urgenteCount++; return; }

    if (sub === 'sin_revisar') sinRevisarCount++;
    else if (sub === 'en_revision') enRevisionCount++;
    else if (sub === 'firmo' || sub === 'firmado') firmadoCount++;
    else if (sub === 'rechazo' || sub === 'rechazado') rechazadoCount++;
    else if (sub === 'aprobo' || sub === 'aprobado') aprobadoCount++;
    else if (sub === 'cancelo' || sub === 'cancelado') canceladoCount++;
  });

  // ── Compute "participantes en mis docs" counts ──
  // Count participants (not documents) in documents owned by the user
  let partSinRevisarCount = 0;
  let partEnRevisionCount = 0;
  let partFirmadoCount = 0;
  let partRechazadoCount = 0;
  let partAprobadoCount = 0;
  let partUrgenteCount = 0;
  let partVencidaCount = 0;

  // The listar API already returns only documents owned by the current user (owner_id = user.id),
  // so we iterate all filteredDocs without an owner_id check.
  filteredDocs.forEach((d: any) => {
    const parts: any[] = d.participantes || [];
    const fechaVenc = d.fecha_vencimiento ? new Date(d.fecha_vencimiento) : null;
    const isVencido = fechaVenc && fechaVenc < now;
    const isUrgente = fechaVenc && fechaVenc >= now && fechaVenc <= in72h;

    parts.forEach((p: any) => {
      const pId = p.id || p.user_id || p.userId;
      const pEmail = p.email || '';
      // Skip the owner themselves from participant counts
      if (pId === userId || pEmail === userEmail) return;
      const sub = p.sub_estado || 'sin_revisar';

      if (isVencido) { partVencidaCount++; return; }
      if (isUrgente) { partUrgenteCount++; return; }

      if (sub === 'sin_revisar') partSinRevisarCount++;
      else if (sub === 'en_revision') partEnRevisionCount++;
      else if (sub === 'firmo' || sub === 'firmado') partFirmadoCount++;
      else if (sub === 'rechazo' || sub === 'rechazado') partRechazadoCount++;
      else if (sub === 'aprobo' || sub === 'aprobado') partAprobadoCount++;
      else if (sub === 'cancelo' || sub === 'cancelado') partSinRevisarCount++; // fallback
      else partSinRevisarCount++; // unknown sub_estado defaults to sin_revisar
    });
  });

  const misParticipacionesItems = [
    { label: 'Sin revisar', count: sinRevisarCount, color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-400', desc: 'Documentos que no has abierto' },
    { label: 'En revisión', count: enRevisionCount, color: 'text-cyan-700', bg: 'bg-cyan-50', border: 'border-cyan-200', dot: 'bg-cyan-500', desc: 'Documentos abiertos pero sin participación' },
    { label: 'Firmé', count: firmadoCount, color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200', dot: 'bg-green-500', desc: 'Documentos firmados' },
    { label: 'Rechacé', count: rechazadoCount, color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', dot: 'bg-red-500', desc: 'Documentos con participación rechazada' },
    { label: 'Aprobé', count: aprobadoCount, color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-500', desc: 'Documentos aprobados' },
    { label: 'Cancelé', count: canceladoCount, color: 'text-slate-600', bg: 'bg-slate-100', border: 'border-slate-300', dot: 'bg-slate-400', desc: 'Documentos que he cancelado' },
    { label: 'Urgente atención', count: urgenteCount, color: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-300', dot: 'bg-rose-500', desc: 'Documentos próximos a vencer (menos de 72 horas)' },
    { label: 'Participación vencida', count: vencidaCount, color: 'text-gray-600', bg: 'bg-gray-100', border: 'border-gray-300', dot: 'bg-gray-500', desc: 'Documentos cuya participación ha expirado' },
  ];

  const participantesEnMisDocsItems = [
    { label: 'Sin revisar', count: partSinRevisarCount, color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-400', desc: 'Participantes que no han abierto el documento' },
    { label: 'En revisión', count: partEnRevisionCount, color: 'text-cyan-700', bg: 'bg-cyan-50', border: 'border-cyan-200', dot: 'bg-cyan-500', desc: 'Participantes que han abierto el documento pero no participado' },
    { label: 'Han firmado', count: partFirmadoCount, color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200', dot: 'bg-green-500', desc: 'Participantes que han firmado el documento' },
    { label: 'Han rechazado', count: partRechazadoCount, color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', dot: 'bg-red-500', desc: 'Participantes que han rechazado el documento' },
    { label: 'Han aprobado', count: partAprobadoCount, color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-500', desc: 'Participantes que han aprobado el documento' },
    { label: 'Con urgente atención', count: partUrgenteCount, color: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-300', dot: 'bg-rose-500', desc: 'Con participaciones próximas a vencer (menos de 72 horas)' },
    { label: 'Con participación vencida', count: partVencidaCount, color: 'text-gray-600', bg: 'bg-gray-100', border: 'border-gray-300', dot: 'bg-gray-500', desc: 'El plazo de participación ha expirado' },
  ];

  const items = activeTab === 'mis_participaciones' ? misParticipacionesItems : participantesEnMisDocsItems;

  return (
    <div className="bg-white border border-border rounded-xl overflow-hidden mb-6 shadow-sm">
      {/* Header with tabs */}
      <div className="px-5 pt-4 pb-0 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-foreground">Estado de participaciones</h2>
          <PeriodFilter value={period} onChange={setPeriod} />
        </div>
        {/* Tabs */}
        <div className="flex items-center gap-0">
          <button
            onClick={() => setActiveTab('mis_participaciones')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === 'mis_participaciones' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Estado de mis participaciones en documentos
          </button>
          <button
            onClick={() => setActiveTab('participantes_en_mis_docs')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === 'participantes_en_mis_docs' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Estado de participantes en mis documentos
          </button>
        </div>
      </div>
      {/* Content */}
      <div className="p-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {items.map((s) => (
            <div key={s.label} className={`${s.bg} border ${s.border} rounded-xl p-3 flex flex-col gap-1.5 relative overflow-hidden min-h-[90px] justify-between shadow-sm hover:shadow-md transition-all`}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${s.dot}`} />
                <span className={`text-xs font-semibold ${s.color}`}>{s.label}</span>
              </div>
              <span className={`text-2xl font-bold ${s.color}`}>{s.count}</span>
              <span className="text-[10px] text-muted-foreground leading-tight">{s.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

// ─── DocumentosSinRevisionSection Component ──────────────────────────────────
function DocumentosSinRevisionSection({
  sinRevisarPropiosDocs,
  sinRevisarParticipantesDocs,
  loadingDocs,
  onNavigate,
  onOpenContextMenu,
  onRefresh,
}: {
  sinRevisarPropiosDocs: Document[];
  sinRevisarParticipantesDocs: Document[];
  loadingDocs: boolean;
  onNavigate: (docId: string) => void;
  onOpenContextMenu: (e: React.MouseEvent, doc: Document) => void;
  onRefresh: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'no_revisados_por_mi' | 'no_revisados_por_participantes'>('no_revisados_por_mi');

  let docs = activeTab === 'no_revisados_por_mi' ? sinRevisarPropiosDocs : sinRevisarParticipantesDocs;

  return (
    <div className="bg-white border border-border rounded-xl overflow-hidden mb-6 shadow-sm">
      {/* Header with tabs */}
      <div className="px-5 pt-4 pb-0 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-foreground">Documentos sin revisión</h2>
          <button
            onClick={onRefresh}
            disabled={loadingDocs}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-lg bg-white hover:bg-muted transition-colors text-foreground font-medium disabled:opacity-50"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`${loadingDocs ? 'animate-spin' : ''} flex-shrink-0`}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Actualizar
          </button>
        </div>
        {/* Tabs */}
        <div className="flex items-center gap-0">
          <button
            onClick={() => setActiveTab('no_revisados_por_mi')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === 'no_revisados_por_mi' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            No revisados por mí
            <span className={`ml-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-full ${activeTab === 'no_revisados_por_mi' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
              {sinRevisarPropiosDocs.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('no_revisados_por_participantes')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === 'no_revisados_por_participantes' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            No revisados por participantes
            <span className={`ml-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-full ${activeTab === 'no_revisados_por_participantes' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
              {sinRevisarParticipantesDocs.length}
            </span>
          </button>
        </div>
      </div>
      {/* Content */}
      <div className="p-5">
        {loadingDocs ? (
          <div className="flex items-center gap-2 py-2">
            <svg className="animate-spin h-4 w-4 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm text-muted-foreground">Cargando...</span>
          </div>
        ) : docs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            {activeTab === 'no_revisados_por_mi'
              ? 'No tienes documentos pendientes de revisión.' :'Todos los participantes han revisado los documentos.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {docs.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border hover:bg-muted/40 transition-colors cursor-pointer group"
                onClick={() => onNavigate(doc.id)}
              >
                <input type="checkbox" className="rounded border-border accent-primary flex-shrink-0" onClick={(e) => e.stopPropagation()} readOnly />
                <FileText size={16} className="text-amber-500 flex-shrink-0" />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-sm text-foreground font-medium truncate group-hover:text-primary transition-colors">{doc.name}</span>
                  {doc.descripcion && (
                    <span className="text-xs text-muted-foreground truncate">{doc.descripcion}</span>
                  )}
                </div>
                <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full flex-shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                  Sin revisar
                </span>
                {doc.esUrgente && (
                  <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full flex-shrink-0">Urgente</span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); onOpenContextMenu(e, doc); }}
                  className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground opacity-0 group-hover:opacity-100 flex-shrink-0"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

export default function MisDocumentosPage() {
  const [activeSection, setActiveSection] = useState('mi-espacio');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [favSearchQuery, setFavSearchQuery] = useState('');
  const [favViewMode, setFavViewMode] = useState<'list' | 'grid'>('list');
  const [porVencerSearch, setPorVencerSearch] = useState('');
  const [porVencerViewMode, setPorVencerViewMode] = useState<'list' | 'grid'>('list');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [miEspacioSortDropdownOpen, setMiEspacioSortDropdownOpen] = useState(false);
  const miEspacioSortDropdownRef = React.useRef<HTMLDivElement>(null);
  const [selectedEtiqueta, setSelectedEtiqueta] = useState<string | null>(null);

  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const router = useRouter();

  // ─── Column widths for resizable tables ───────────────────────────────────
  const { widths: mainColWidths, handleResize: resizeMainCol } = useColumnWidths('main', {
    checkbox: 40, nombre: 220, propietario: 130, ultimaModificacion: 170, tamano: 90,
    estado: 130, estadoParticipacion: 190, etiquetas: 130, tipoDocumento: 110,
    numeroDocumento: 130, folioInterno: 100, fechaCreacion: 150, fechaCompletado: 150,
    fechaVencimiento: 130, prioridad: 100, rutaGuardado: 150,
  }, user?.id);
  const { widths: favColWidths, handleResize: resizeFavCol } = useColumnWidths('favoritos', {
    checkbox: 40, nombre: 220, propietario: 130, estado: 130, fechaCreacion: 150,
    numeroDocumento: 130, ultimaModificacion: 170, tamano: 90, etiquetas: 130,
    tipoDocumento: 110, fechaVencimiento: 130, prioridad: 100,
  }, user?.id);
  const { widths: porVencerColWidths, handleResize: resizePorVencerCol } = useColumnWidths('por-vencer', {
    checkbox: 40, nombre: 220, propietario: 130, estado: 130, fechaCreacion: 150,
    numeroDocumento: 130, ultimaModificacion: 170, tamano: 90, vence: 130,
    etiquetas: 130, tipoDocumento: 110, prioridad: 100,
  }, user?.id);
  const { widths: papeleraColWidths, handleResize: resizePapeleraCol } = useColumnWidths('papelera', {
    nombre: 260, tipo: 100, eliminadoPor: 140, fechaEliminacion: 150, tamano: 90, retencion: 100, acciones: 200,
  }, user?.id);
  const { widths: cfColWidths, handleResize: resizeCfCol } = useColumnWidths('filtros-personalizados', {
    checkbox: 40, nombre: 220, propietario: 130, estado: 130, fechaCreacion: 150,
    numeroDocumento: 130, ultimaModificacion: 170, tamano: 90, etiquetas: 130,
    tipoDocumento: 110, folioInterno: 100, fechaCompletado: 150, fechaVencimiento: 130,
    prioridad: 100, rutaGuardado: 150,
  }, user?.id);

  // Folder navigation state
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folderBreadcrumb, setFolderBreadcrumb] = useState<{ id: string; name: string }[]>([]);

  const [realDocuments, setRealDocuments] = useState<Document[]>([]);
  const [rawDocumentsData, setRawDocumentsData] = useState<any[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [favoriteDocuments, setFavoriteDocuments] = useState<Document[]>([]);
  const [participantDocuments, setParticipantDocuments] = useState<Document[]>([]);
  const [loadingFavorites, setLoadingFavorites] = useState(false);
  const [porVencerDocuments, setPorVencerDocuments] = useState<Document[]>([]);
  const [loadingPorVencer, setLoadingPorVencer] = useState(false);
  const [deletedDocuments, setDeletedDocuments] = useState<DeletedDocument[]>([]);
  const [loadingPapelera, setLoadingPapelera] = useState(false);

  const [statusCounts, setStatusCounts] = useState<StatusCounts>({
    borrador: 0, en_proceso: 0, en_espera: 0, completado: 0, rechazado: 0, cancelado: 0, vencido: 0,
  });
  const [subEstadoCounts, setSubEstadoCounts] = useState<SubEstadoCounts>({
    sin_revisar: 0, en_revision: 0, firmo: 0, rechazo: 0, aprobo: 0, cancelo: 0,
    urgente_atencion: 0, participacion_vencida: 0,
    participantes_sin_revisar: 0, participantes_en_revision: 0,
    participantes_firmo: 0, participantes_rechazo: 0, participantes_aprobo: 0, participantes_cancelo: 0,
    participantes_urgente_atencion: 0, participantes_participacion_vencida: 0,
    sin_revisar_propios: 0, sin_revisar_participantes: 0,
    no_inicializados: 0,
  });
  const [sugeridosDocuments, setSugeridosDocuments] = useState<Document[]>([]);
  const [noInicializadosDocuments, setNoInicializadosDocuments] = useState<Document[]>([]);
  const [sinRevisarPropiosDocs, setSinRevisarPropiosDocs] = useState<Document[]>([]);
  const [sinRevisarParticipantesDocs, setSinRevisarParticipantesDocs] = useState<Document[]>([]);
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(true);

  const [carpetas, setCarpetas] = useState<Carpeta[]>([]);
  const [showCarpetaModal, setShowCarpetaModal] = useState(false);
  const [nuevaCarpetaNombre, setNuevaCarpetaNombre] = useState('');
  const [nuevaCarpetaDescripcion, setNuevaCarpetaDescripcion] = useState('');
  const [nuevaCarpetaTipoDocumentoId, setNuevaCarpetaTipoDocumentoId] = useState('');
  const [nuevaCarpetaGrupoId, setNuevaCarpetaGrupoId] = useState('');
  const [carpetaError, setCarpetaError] = useState('');
  const [crearCarpetaLoading, setCrearCarpetaLoading] = useState(false);

  const [papeleraSearch, setPapeleraSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; docId: string | null; docName: string; isEmptyAll: boolean }>({
    open: false, docId: null, docName: '', isEmptyAll: false,
  });

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    open: false, docId: null, docName: '', isDraft: false, isFavorite: false, fileUrl: null, x: 0, y: 0,
  });

  // Folder context menu state
  const [folderContextMenu, setFolderContextMenu] = useState<FolderContextMenuState>({
    open: false, carpetaId: null, carpetaName: '', x: 0, y: 0,
  });
  const [renameFolderModal, setRenameFolderModal] = useState({ open: false, carpetaId: null as string | null, currentName: '', newName: '' });
  const [moveFolderModal, setMoveFolderModal] = useState({ open: false, carpetaId: null as string | null, carpetaName: '' });

  // Confirmation for mover a papelera (docs and folders)
  const [confirmPapelera, setConfirmPapelera] = useState<{ open: boolean; type: 'doc' | 'folder'; id: string | null; name: string }>({
    open: false, type: 'doc', id: null, name: '',
  });

  const [renameModal, setRenameModal] = useState({ open: false, docId: null as string | null, currentName: '', newName: '' });
  const [moveModal, setMoveModal] = useState({ open: false, docId: null as string | null, docName: '', isBulk: false });
  const [tagModal, setTagModal] = useState({ open: false, docId: null as string | null, docName: '', tag: '' });
  const [reminderModal, setReminderModal] = useState({ open: false, docId: null as string | null, docName: '', date: '', note: '' });
  const [shareModal, setShareModal] = useState({ open: false, docId: null as string | null, docName: '', email: '' });
  const [confidentialModal, setConfidentialModal] = useState<ConfidentialModalState>({
    open: false, docId: null, docName: '', password: '', confirmPassword: '', saving: false, error: '',
  });
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Personalizar vista state
  const [personalizarOpen, setPersonalizarOpen] = useState(false);
  const [columnConfig, setColumnConfig] = useState<ColumnConfig[]>(DEFAULT_COLUMNS);
  const [filterConfig, setFilterConfig] = useState<FilterVisibilityConfig[]>(DEFAULT_FILTERS);
  const [gridColumnConfig, setGridColumnConfig] = useState<GridColumnConfig[]>(DEFAULT_GRID_COLUMNS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // Custom filters state
  const [customFilters, setCustomFilters] = useState<CustomFilter[]>([]);
  // Inline editing of custom filter name
  const [editingFilterId, setEditingFilterId] = useState<string | null>(null);
  const [editingFilterName, setEditingFilterName] = useState('');
  const editingFilterRef = useRef<HTMLInputElement>(null);
  const [showCrearFiltroModal, setShowCrearFiltroModal] = useState(false);
  const [nuevoFiltroNombre, setNuevoFiltroNombre] = useState('');
  const [nuevoFiltroDescripcion, setNuevoFiltroDescripcion] = useState('');
  const [nuevoFiltroIcono, setNuevoFiltroIcono] = useState('📁');
  const [nuevoFiltroFiltros, setNuevoFiltroFiltros] = useState<Record<string, any>>({});
  const [nuevoFiltroError, setNuevoFiltroError] = useState('');
  // Criteria drag & drop state
  const [nuevoFiltroCriterios, setNuevoFiltroCriterios] = useState<string[]>([]);
  const [showCriterioSelector, setShowCriterioSelector] = useState(false);
  const [dragCriterioIdx, setDragCriterioIdx] = useState<number | null>(null);
  const [dragOverCriterioIdx, setDragOverCriterioIdx] = useState<number | null>(null);
  const [iconPickerOpen, setIconPickerOpen] = useState(true);

  // Per-custom-filter toolbar state: search, sort, viewMode, column config
  const [cfSearchQueries, setCfSearchQueries] = useState<Record<string, string>>({});
  const [cfSortOrders, setCfSortOrders] = useState<Record<string, string>>({});
  const [cfViewModes, setCfViewModes] = useState<Record<string, 'list' | 'grid'>>({});
  const [cfColumnConfigs, setCfColumnConfigs] = useState<Record<string, ColumnConfig[]>>({});
  const [cfColumnConfigOpen, setCfColumnConfigOpen] = useState<string | null>(null);
  const cfColumnConfigRefs = React.useRef<Record<string, HTMLDivElement | null>>({});

  // Favoritos toolbar state
  const [favSortOrder, setFavSortOrder] = useState('ultimaModificacion_desc');
  const [favColumnConfigOpen, setFavColumnConfigOpen] = useState(false);
  const [favColumnConfig, setFavColumnConfig] = useState<ColumnConfig[]>(DEFAULT_CF_COLUMNS);
  const favColumnConfigRef = React.useRef<HTMLDivElement>(null);

  // Por vencer toolbar state
  const [porVencerSortOrder, setPorVencerSortOrder] = useState('fechaVencimiento_asc');
  const [porVencerColumnConfigOpen, setPorVencerColumnConfigOpen] = useState(false);
  const [porVencerColumnConfig, setPorVencerColumnConfig] = useState<ColumnConfig[]>(DEFAULT_CF_COLUMNS);
  const porVencerColumnConfigRef = React.useRef<HTMLDivElement>(null);

  // Active filter values
  const [activeFilters, setActiveFilters] = useState<Record<string, any>>({});
  // Which filter dropdown is open
  const [openFilterDropdown, setOpenFilterDropdown] = useState<string | null>(null);
  const filterDropdownRef = useRef<HTMLDivElement>(null);

  // Custom date range state per date filter
  const [customDateRanges, setCustomDateRanges] = useState<Record<string, DateRange>>({});
  // Which date filter is showing the range picker
  const [showDateRangePicker, setShowDateRangePicker] = useState<string | null>(null);

  // Tipo documento list for filter
  const [tiposDocumento, setTiposDocumento] = useState<TipoDocumento[]>([]);
  const [tipoDocSearch, setTipoDocSearch] = useState('');
  const [loadingTipos, setLoadingTipos] = useState(false);
  const [gruposDocumento, setGruposDocumento] = useState<GrupoTipoDocumento[]>([]);
  const [loadingGrupos, setLoadingGrupos] = useState(false);

  // Etiquetas list for filter
  const [etiquetasList, setEtiquetasList] = useState<Etiqueta[]>([]);
  const [etiquetasSearch, setEtiquetasSearch] = useState('');
  const [loadingEtiquetas, setLoadingEtiquetas] = useState(false);

  // Workspace users for propietario filter
  const [workspaceUsers, setWorkspaceUsers] = useState<WorkspaceUser[]>([]);
  const [propietarioSearch, setPropietarioSearch] = useState('');
  const [loadingPropietarios, setLoadingPropietarios] = useState(false);

  // Participants list for participantes filter
  const [participantUsers, setParticipantUsers] = useState<WorkspaceUser[]>([]);
  const [participantesSearch, setParticipantesSearch] = useState('');
  const [loadingParticipantes, setLoadingParticipantes] = useState(false);

  // Drag & drop state
  const [dragDocId, setDragDocId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragFolderId, setDragFolderId] = useState<string | null>(null);

  // Sort state for Mi Espacio
  const [miEspacioSortOrder, setMiEspacioSortOrder] = useState('ultimaModificacion_desc');

  const [activeContextMenuDocId, setActiveContextMenuDocId] = useState<string | null>(null);
  const [activeFolderContextMenuId, setActiveFolderContextMenuId] = useState<string | null>(null);

  // Fav column drag state
  const [favColDragIdx, setFavColDragIdx] = useState<number | null>(null);
  const [favColDragOverIdx, setFavColDragOverIdx] = useState<number | null>(null);
  const favColDragIdxRef = useRef<number | null>(null);
  const favColDragOverIdxRef = useRef<number | null>(null);

  // PorVencer column drag state
  const [pvColDragIdx, setPvColDragIdx] = useState<number | null>(null);
  const [pvColDragOverIdx, setPvColDragOverIdx] = useState<number | null>(null);
  const pvColDragIdxRef = useRef<number | null>(null);
  const pvColDragOverIdxRef = useRef<number | null>(null);

  // Custom filter column drag state
  const [cfColDragIdx, setCfColDragIdx] = useState<Record<string, number | null>>({});
  const [cfColDragOverIdx, setCfColDragOverIdx] = useState<Record<string, number | null>>({});
  const cfColDragIdxRef = useRef<Record<string, number | null>>({});
  const cfColDragOverIdxRef = useRef<Record<string, number | null>>({});

  const contextMenuRef = useRef<HTMLDivElement>(null);
  const folderContextMenuRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const openContextMenu = (e: React.MouseEvent, doc: Document) => {
    e.stopPropagation();
    // Toggle: if same doc already open, close it
    if (activeContextMenuDocId === doc.id && contextMenu.open) {
      setContextMenu((prev) => ({ ...prev, open: false, docId: null }));
      setActiveContextMenuDocId(null);
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenu({
      open: true, docId: doc.id, docName: doc.name, isDraft: !!doc.isDraft,
      isFavorite: !!doc.isFavorite, fileUrl: doc.fileUrl || null,
      x: rect.right, y: rect.bottom,
    });
    setActiveContextMenuDocId(doc.id);
    // Close folder menu if open
    setFolderContextMenu((prev) => ({ ...prev, open: false, carpetaId: null }));
    setActiveFolderContextMenuId(null);
  };

  const closeContextMenu = () => {
    setContextMenu((prev) => ({ ...prev, open: false, docId: null }));
    setActiveContextMenuDocId(null);
  };

  const openFolderContextMenu = (e: React.MouseEvent, carpeta: Carpeta) => {
    e.stopPropagation();
    e.preventDefault();
    // Toggle: if same folder already open, close it
    if (activeFolderContextMenuId === carpeta.id && folderContextMenu.open) {
      setFolderContextMenu((prev) => ({ ...prev, open: false, carpetaId: null }));
      setActiveFolderContextMenuId(null);
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setFolderContextMenu({
      open: true,
      carpetaId: carpeta.id,
      carpetaName: carpeta.name,
      x: rect.right,
      y: rect.bottom,
    });
    setActiveFolderContextMenuId(carpeta.id);
    // Close doc menu if open
    setContextMenu((prev) => ({ ...prev, open: false, docId: null }));
    setActiveContextMenuDocId(null);
  };

  const closeFolderContextMenu = () => {
    setFolderContextMenu((prev) => ({ ...prev, open: false, carpetaId: null }));
    setActiveFolderContextMenuId(null);
  };

  // Open folder: navigate into it
  const handleOpenFolder = (carpeta: Carpeta) => {
    closeFolderContextMenu();
    setCurrentFolderId(carpeta.id);
    setFolderBreadcrumb((prev) => [...prev, { id: carpeta.id, name: carpeta.name }]);
    setSearchQuery('');
    setSelectedRows([]);
    setSelectedFolders([]);
  };

  // Navigate breadcrumb
  const handleBreadcrumbNav = (index: number) => {
    if (index === -1) {
      // Root
      setCurrentFolderId(null);
      setFolderBreadcrumb([]);
    } else {
      const crumb = folderBreadcrumb[index];
      setCurrentFolderId(crumb.id);
      setFolderBreadcrumb((prev) => prev.slice(0, index + 1));
    }
    setSearchQuery('');
    setSelectedRows([]);
    setSelectedFolders([]);
  };

  // Navigate directly to a folder from sidebar
  const handleSidebarFolderNav = (carpeta: Carpeta) => {
    setActiveSection('mi-espacio');
    setCurrentFolderId(carpeta.id);
    // Build breadcrumb path from root to this folder
    const buildPath = (id: string): { id: string; name: string }[] => {
      const c = carpetas.find((x) => x.id === id);
      if (!c) return [];
      if (c.parentId) return [...buildPath(c.parentId), { id: c.id, name: c.name }];
      return [{ id: c.id, name: c.name }];
    };
    setFolderBreadcrumb(buildPath(carpeta.id));
    setSearchQuery('');
    setSelectedRows([]);
    setSelectedFolders([]);
  };

  // Folder context menu actions
  const handleFolderMenuVer = () => {
    const carpeta = carpetas.find((c) => c.id === folderContextMenu.carpetaId);
    if (carpeta) handleOpenFolder(carpeta);
  };

  const handleFolderMenuMover = () => {
    setMoveFolderModal({ open: true, carpetaId: folderContextMenu.carpetaId, carpetaName: folderContextMenu.carpetaName });
    closeFolderContextMenu();
  };

  const handleFolderMenuRenombrar = () => {
    setRenameFolderModal({ open: true, carpetaId: folderContextMenu.carpetaId, currentName: folderContextMenu.carpetaName, newName: folderContextMenu.carpetaName });
    closeFolderContextMenu();
  };

  const handleFolderMenuPapelera = async () => {
    const carpetaId = folderContextMenu.carpetaId;
    const carpetaName = folderContextMenu.carpetaName;
    closeFolderContextMenu();
    if (!carpetaId) return;
    // Show confirmation dialog
    setConfirmPapelera({ open: true, type: 'folder', id: carpetaId, name: carpetaName });
  };

  const handleConfirmPapelera = async () => {
    const { type, id, name } = confirmPapelera;
    setConfirmPapelera({ open: false, type: 'doc', id: null, name: '' });
    if (!id || !user) return;
    const supabase = createClient();
    if (type === 'folder') {
      // Move all documents in this folder back to root (no folder)
      await supabase.from('documentos').update({ carpeta_id: null }).eq('carpeta_id', id).eq('owner_id', user.id);
      // Delete the folder
      const { error } = await supabase.from('carpetas').delete().eq('id', id).eq('owner_id', user.id);
      if (error) { showToast('Error al mover la carpeta a papelera'); return; }
      setCarpetas((prev) => prev.filter((c) => c.id !== id));
      if (currentFolderId === id) {
        setCurrentFolderId(null);
        setFolderBreadcrumb([]);
      }
      showToast(`Carpeta "${name}" movida a papelera`);
      loadDocuments();
    } else {
      const { error } = await supabase.from('documentos').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('owner_id', user.id);
      if (error) { showToast('Error al mover a papelera'); return; }
      setRealDocuments((prev) => prev.filter((d) => d.id !== id));
      showToast(`"${name}" movido a papelera`);
      if (activeSection === 'papelera') loadPapelera();
    }
  };

  const handleFolderMenuConfidencial = () => {
    // Confidential mode for folder: set password on all docs inside
    setConfidentialModal({
      open: true,
      docId: folderContextMenu.carpetaId, // reuse docId field to store carpetaId
      docName: `carpeta "${folderContextMenu.carpetaName}"`,
      password: '', confirmPassword: '', saving: false, error: '',
    });
    closeFolderContextMenu();
  };

  const handleSaveRenameFolder = async () => {
    const nombre = renameFolderModal.newName.trim();
    if (!nombre || !renameFolderModal.carpetaId || !user) return;
    const supabase = createClient();
    const { error } = await supabase.from('carpetas').update({ nombre }).eq('id', renameFolderModal.carpetaId).eq('owner_id', user.id);
    if (error) { showToast('Error al renombrar la carpeta'); return; }
    setCarpetas((prev) => prev.map((c) => c.id === renameFolderModal.carpetaId ? { ...c, name: nombre } : c));
    // Update breadcrumb if needed
    setFolderBreadcrumb((prev) => prev.map((b) => b.id === renameFolderModal.carpetaId ? { ...b, name: nombre } : b));
    setRenameFolderModal({ open: false, carpetaId: null, currentName: '', newName: '' });
    showToast(`Carpeta renombrada a "${nombre}"`);
  };

  const handleSaveMoveFolder = async (targetParentId: string | null, targetName: string) => {
    if (!moveFolderModal.carpetaId || !user) return;
    // Prevent moving a folder into itself
    if (targetParentId === moveFolderModal.carpetaId) { showToast('No puedes mover una carpeta dentro de sí misma'); return; }
    const supabase = createClient();
    const { error } = await supabase.from('carpetas').update({ parent_id: targetParentId }).eq('id', moveFolderModal.carpetaId).eq('owner_id', user.id);
    if (error) { showToast('Error al mover la carpeta'); return; }
    setCarpetas((prev) => prev.map((c) => c.id === moveFolderModal.carpetaId ? { ...c, parentId: targetParentId } : c));
    setMoveFolderModal({ open: false, carpetaId: null, carpetaName: '' });
    showToast(`Carpeta movida a "${targetName || 'Raíz'}"`);
  };

  const handleMenuAbrir = () => {
    const docId = contextMenu.docId;
    const isDraft = contextMenu.isDraft;
    if (!docId) return;
    closeContextMenu();
    if (isDraft) router.push(`/crear-documento?draft=${docId}`);
    else router.push(`/visor-documento/${docId}`);
  };

  const handleMenuMover = () => {
    setMoveModal({ open: true, docId: contextMenu.docId, docName: contextMenu.docName, isBulk: false });
    closeContextMenu();
  };

  const handleMenuRenombrar = () => {
    setRenameModal({ open: true, docId: contextMenu.docId, currentName: contextMenu.docName, newName: contextMenu.docName });
    closeContextMenu();
  };

  const handleMenuFavoritos = async () => {
    const docId = contextMenu.docId;
    const docName = contextMenu.docName;
    const isFav = contextMenu.isFavorite;
    closeContextMenu();
    if (!docId || !user) return;
    const supabase = createClient();
    const { error } = await supabase.from('documentos').update({ is_favorite: !isFav }).eq('id', docId).eq('owner_id', user.id);
    if (error) { showToast('Error al actualizar favoritos'); return; }
    setRealDocuments((prev) => prev.map((d) => d.id === docId ? { ...d, isFavorite: !isFav } : d));
    showToast(isFav ? `"${docName}" eliminado de Favoritos` : `"${docName}" Añadido a Favoritos`);
    if (activeSection === 'favoritos') loadFavorites();
  };

  const handleMenuConfidencial = () => {
    setConfidentialModal({ open: true, docId: contextMenu.docId, docName: contextMenu.docName, password: '', confirmPassword: '', saving: false, error: '' });
    closeContextMenu();
  };

  const handleSaveConfidential = async () => {
    if (!confidentialModal.docId || !user) return;
    if (!confidentialModal.password) { setConfidentialModal((prev) => ({ ...prev, error: 'La contraseña es obligatoria.' })); return; }
    if (confidentialModal.password !== confidentialModal.confirmPassword) { setConfidentialModal((prev) => ({ ...prev, error: 'Las contraseñas no coinciden.' })); return; }
    setConfidentialModal((prev) => ({ ...prev, saving: true, error: '' }));
    const supabase = createClient();
    const { error } = await supabase.from('documentos').update({ tiene_codigo_acceso: true, codigo_acceso_hash: confidentialModal.password }).eq('id', confidentialModal.docId).eq('owner_id', user.id);
    if (error) { setConfidentialModal((prev) => ({ ...prev, saving: false, error: 'Error al guardar. Intenta de nuevo.' })); return; }
    setConfidentialModal({ open: false, docId: null, docName: '', password: '', confirmPassword: '', saving: false, error: '' });
    showToast(`Modo Confidencial Activado para "${confidentialModal.docName}"`);
  };

  const handleMenuDescargar = async () => {
    const docId = contextMenu.docId;
    const docName = contextMenu.docName;
    const fileUrl = contextMenu.fileUrl;
    closeContextMenu();
    if (!docId || !user) return;
    if (fileUrl) {
      const a = document.createElement('a');
      a.href = fileUrl; a.download = docName; a.target = '_blank';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      showToast(`Descargando "${docName}"...`);
    } else {
      showToast(`No hay archivo disponible para descargar`);
    }
  };

  const handleMenuCompartir = () => {
    setShareModal({ open: true, docId: contextMenu.docId, docName: contextMenu.docName, email: '' });
    closeContextMenu();
  };

  const handleMenuPapelera = async () => {
    const docName = contextMenu.docName;
    const docId = contextMenu.docId;
    closeContextMenu();
    if (!docId || !user) return;
    // Show confirmation dialog
    setConfirmPapelera({ open: true, type: 'doc', id: docId, name: docName });
  };

  const handleBulkPapelera = async () => {
    if (!user || selectedRows.length === 0) return;
    const supabase = createClient();
    const { error } = await supabase.from('documentos').update({ deleted_at: new Date().toISOString() }).in('id', selectedRows).eq('owner_id', user.id);
    if (error) { showToast('Error al mover a papelera'); return; }
    setRealDocuments((prev) => prev.filter((d) => !selectedRows.includes(d.id)));
    showToast(`${selectedRows.length} documento(s) movido(s) a papelera`);
    setSelectedRows([]);
    if (activeSection === 'papelera') loadPapelera();
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) closeContextMenu();
      if (folderContextMenuRef.current && !folderContextMenuRef.current.contains(e.target as Node)) closeFolderContextMenu();
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target as Node)) setOpenFilterDropdown(null);
      // Check cfColumnConfig refs - only close if click is outside the ref container
      if (cfColumnConfigOpen !== null) {
        const cfRef = cfColumnConfigRefs.current[cfColumnConfigOpen];
        if (cfRef && !cfRef.contains(e.target as Node)) setCfColumnConfigOpen(null);
      }
      if (favColumnConfigRef.current && !favColumnConfigRef.current.contains(e.target as Node)) setFavColumnConfigOpen(false);
      if (porVencerColumnConfigRef.current && !porVencerColumnConfigRef.current.contains(e.target as Node)) setPorVencerColumnConfigOpen(false);
      if (miEspacioSortDropdownRef.current && !miEspacioSortDropdownRef.current.contains(e.target as Node)) setMiEspacioSortDropdownOpen(false);
    };
    // Note: scroll should NOT close context menus — menus are fixed positioned and stay open
    const handleScroll = () => {
      // Only close filter dropdowns and sort dropdowns on scroll, NOT context menus
      setOpenFilterDropdown(null);
      setMiEspacioSortDropdownOpen(false);
    };
    if (contextMenu.open || folderContextMenu.open || openFilterDropdown !== null || cfColumnConfigOpen !== null || favColumnConfigOpen || porVencerColumnConfigOpen || miEspacioSortDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('scroll', handleScroll, true);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [contextMenu.open, folderContextMenu.open, openFilterDropdown, cfColumnConfigOpen, favColumnConfigOpen, porVencerColumnConfigOpen, miEspacioSortDropdownOpen]);

  // Load tipos de documento for filter
  const loadTiposDocumento = useCallback(async () => {
    setLoadingTipos(true);
    try {
      const res = await fetch('/api/documentos/tipos');
      const json = await res.json();
      if (json.data) setTiposDocumento(json.data);
    } catch (_) { /* ignore */ }
    finally { setLoadingTipos(false); }
  }, []);

  const loadGruposDocumento = useCallback(async () => {
    setLoadingGrupos(true);
    try {
      const res = await fetch('/api/documentos/grupos');
      const json = await res.json();
      if (json.data) setGruposDocumento(json.data);
    } catch (_) { /* ignore */ }
    finally { setLoadingGrupos(false); }
  }, []);

  useEffect(() => {
    loadTiposDocumento();
    loadGruposDocumento();
  }, [loadTiposDocumento, loadGruposDocumento]);

  const loadEtiquetas = useCallback(async () => {
    setLoadingEtiquetas(true);
    try {
      const res = await fetch('/api/documentos/etiquetas');
      if (res.ok) {
        const json = await res.json();
        setEtiquetasList(json.data || []);
      }
    } catch (e) {
      console.error('Error loading etiquetas:', e);
    } finally {
      setLoadingEtiquetas(false);
    }
  }, []);

  const loadWorkspaceUsers = useCallback(async () => {
    if (!user) return;
    setLoadingPropietarios(true);
    try {
      const supabase = createClient();
      // Get distinct owner_ids from documentos
      const { data: docsData, error: docsError } = await supabase
        .from('documentos')
        .select('owner_id')
        .is('deleted_at', null);
      if (!docsError && docsData) {
        const ownerIds = [...new Set((docsData as any[]).map((d) => d.owner_id).filter(Boolean))];
        if (ownerIds.length > 0) {
          const { data: profilesData, error: profilesError } = await supabase
            .from('user_profiles')
            .select('id, full_name, email')
            .in('id', ownerIds)
            .order('full_name');
          if (!profilesError && profilesData) {
            setWorkspaceUsers(profilesData as WorkspaceUser[]);
          }
        } else {
          setWorkspaceUsers([]);
        }
      }
    } catch (e) {
      console.error('Error loading workspace users:', e);
    } finally {
      setLoadingPropietarios(false);
    }
  }, [user]);

  const loadParticipantUsers = useCallback(async () => {
    if (!user) return;
    setLoadingParticipantes(true);
    try {
      const supabase = createClient();
      // Get all documents with their participantes field
      const { data, error } = await supabase
        .from('documentos')
        .select('participantes')
        .is('deleted_at', null);
      if (!error && data) {
        const userMap = new Map<string, WorkspaceUser>();
        (data as any[]).forEach((doc) => {
          const parts: any[] = doc.participantes || [];
          parts.forEach((p) => {
            const id = p.id || p.user_id || p.userId;
            const name = p.nombre || p.name || p.full_name || '';
            const email = p.email || '';
            if (id && !userMap.has(id)) {
              userMap.set(id, { id, full_name: name, email });
            } else if (!id && email && !userMap.has(email)) {
              userMap.set(email, { id: email, full_name: name, email });
            }
          });
        });
        // Also fetch from user_profiles for registered participants
        const participantIds = [...userMap.keys()].filter((k) => k.length === 36); // UUID-like
        if (participantIds.length > 0) {
          const { data: profiles } = await supabase
            .from('user_profiles')
            .select('id, full_name, email')
            .in('id', participantIds);
          if (profiles) {
            (profiles as WorkspaceUser[]).forEach((p) => {
              userMap.set(p.id, p);
            });
          }
        }
        setParticipantUsers([...userMap.values()].filter((u) => u.email || u.full_name));
      }
    } catch (e) {
      console.error('Error loading participant users:', e);
    } finally {
      setLoadingParticipantes(false);
    }
  }, [user]);

  useEffect(() => {
    loadEtiquetas();
    loadWorkspaceUsers();
    loadParticipantUsers();
  }, [loadEtiquetas, loadWorkspaceUsers, loadParticipantUsers]);

  const loadDocuments = useCallback(async () => {
    if (!user) return;
    setLoadingDocs(true);
    const supabase = createClient();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setLoadingDocs(false); return; }

      // Fetch own documents
      const res = await fetch('/api/documentos/listar?tipo=todos', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        console.error('[mis-documentos] Error al cargar documentos:', json.error);
        setLoadingDocs(false);
        return;
      }

      const data = json.data || [];

      // Fetch participant documents (documents where user is a participant but not owner)
      let participacionesData: any[] = [];
      try {
        const partRes = await fetch(`/api/documentos/mis-participaciones?t=${Date.now()}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (partRes.ok) {
          const partJson = await partRes.json();
          // Map participaciones to raw document format for merging
          participacionesData = (partJson.participaciones || [])
            .filter((p: any) => p.supabaseId) // only docs with valid IDs
            .map((p: any) => ({
              id: p.supabaseId,
              nombre: p.documentName,
              descripcion: p.description || null,
              estado: p.status === 'en-progreso' ? 'en_proceso'
                : p.status === 'en-espera' ? 'en_espera'
                : p.status === 'completado' ? 'completado'
                : p.status === 'cancelado' ? 'cancelado'
                : p.status === 'rechazado' ? 'rechazado'
                : 'en_proceso',
              etiquetas_ids: [],
              file_size: null,
              updated_at: null,
              ultimo_paso: 1,
              is_favorite: false,
              fecha_vencimiento: p.expiresAt || null,
              file_url: null,
              scan_status: null,
              scan_threat: null,
              carpeta_id: null,
              created_at: p.receivedAt,
              fecha_completado: p.completedAt || null,
              numero_oficio: null,
              folio_interno: null,
              ruta_guardado: null,
              es_urgente: p.priority === 'Urgente',
              participantes: p.participantList?.map((pl: any) => ({
                email: pl.email,
                nombre: pl.name,
                sub_estado: pl.subEstado || pl.status,
                acto: pl.acto,
                rol: pl.rol,
              })) || [],
              tipo_documento_id: null,
              tipo_documento: p.documentType ? { nombre: p.documentType } : null,
              owner_id: null, // not the current user
              _isParticipantDoc: true,
              _mySubEstado: p.mySignatureStatus,
              _myActo: p.myActo,
              _myRol: p.myRol,
              _ownerName: p.senderName || null,
            }));
        }
      } catch (e) {
        console.error('[mis-documentos] Error al cargar participaciones:', e);
      }

      // Merge: own docs + participant docs (deduplicate by id)
      const ownIds = new Set(data.map((d: any) => d.id));
      const uniqueParticipantDocs = participacionesData.filter((p: any) => !ownIds.has(p.id));

      const allData = [...data, ...uniqueParticipantDocs];
      setRawDocumentsData(allData);

      // Map own documents
      const mappedOwn = data.map((d: any) => {
        const mapped = mapDocRow(d);
        const parts: any[] = d.participantes || [];
        const userPart = parts.find((p: any) => {
          const pId = p.id || p.user_id || p.userId;
          const pEmail = p.email || '';
          return pId === user?.id || pEmail === user?.email;
        });
        mapped.miSubEstado = userPart ? (userPart.sub_estado || 'en_revision') : null;
        return mapped;
      });

      // Map participant documents
      const mappedParticipant = uniqueParticipantDocs.map((d: any) => {
        const mapped = mapDocRow(d);
        mapped.miSubEstado = d._mySubEstado || 'en_revision';
        return mapped;
      });

      setParticipantDocuments(mappedParticipant);
      setRealDocuments([...mappedOwn, ...mappedParticipant]);

      const counts: StatusCounts = { borrador: 0, en_proceso: 0, en_espera: 0, completado: 0, rechazado: 0, cancelado: 0, vencido: 0 };
      const now72 = new Date();
      allData.forEach((d: any) => {
        const s = d.estado || 'borrador';
        if (s === 'borrador') counts.borrador++;
        else if (s === 'en_proceso' || s === 'en_progreso') counts.en_proceso++;
        else if (s === 'en_espera') counts.en_espera++;
        else if (s === 'completado') counts.completado++;
        else if (s === 'rechazado') counts.rechazado++;
        else if (s === 'cancelado') counts.cancelado++;
        if (d.fecha_vencimiento && !['completado', 'cancelado', 'rechazado'].includes(s)) {
          const venc = new Date(d.fecha_vencimiento);
          if (venc < now72) counts.vencido++;
        }
      });
      setStatusCounts(counts);

      // Compute participation counts using allData
      const now = new Date();
      const in72h = new Date(now.getTime() + 72 * 60 * 60 * 1000);

      let sinRevisarCount = 0;
      let enRevisionCount = 0;
      let firmoCount = 0;
      let rechazoCount = 0;
      let aproboCount = 0;
      let canceloCount = 0;
      let urgenteAtencionCount = 0;
      let participacionVencidaCount = 0;

      let partSinRevisarCount = 0;
      let partEnRevisionCount = 0;
      let partFirmoCount = 0;
      let partRechazoCount = 0;
      let partAproboCount = 0;
      let partCanceloCount = 0;
      let partUrgenteAtencionCount = 0;
      let partParticipacionVencidaCount = 0;

      let noInicializadosCount = 0;
      let sinRevisarPropiosCount = 0;
      let sinRevisarParticipantesCount = 0;

      const noInicializados: Document[] = [];
      const sinRevisarPropiosDocs: Document[] = [];
      const sinRevisarParticipantesDocs: Document[] = [];
      const sugeridos: Document[] = [];

      allData.forEach((d: any) => {
        const estado = d.estado || 'borrador';
        const mapped = mapDocRow(d);
        const isOwner = d.owner_id === user?.id;
        const parts: any[] = d.participantes || [];
        const fechaVenc = d.fecha_vencimiento ? new Date(d.fecha_vencimiento) : null;
        const isVencido = fechaVenc && fechaVenc < now;
        const isUrgente72h = fechaVenc && fechaVenc >= now && fechaVenc <= in72h;

        if (estado === 'borrador' && parts.length === 0 && isOwner) {
          noInicializadosCount++;
          noInicializados.push(mapped);
        }

        if (estado === 'en_proceso' || estado === 'en_progreso') {
          const userParticipation = parts.find((p: any) => {
            const pId = p.id || p.user_id || p.userId;
            const pEmail = p.email || '';
            return pId === user?.id || pEmail === user?.email;
          });

          // For participant docs, use the _mySubEstado directly
          const effectiveSubEstado = d._isParticipantDoc
            ? (d._mySubEstado || 'en_revision')
            : (userParticipation?.sub_estado || null);

          if (effectiveSubEstado !== null && (!isOwner || d._isParticipantDoc)) {
            const sub = effectiveSubEstado;
            if (isVencido) {
              participacionVencidaCount++;
            } else if (isUrgente72h) {
              urgenteAtencionCount++;
            } else if (sub === 'sin_revisar' || sub === 'Sin revisión') {
              sinRevisarCount++;
            } else if (sub === 'en_revision' || sub === 'En revisión') {
              enRevisionCount++;
            } else if (sub === 'firmo' || sub === 'firmado' || sub === 'Firmado') {
              firmoCount++;
            } else if (sub === 'rechazo' || sub === 'rechazado' || sub === 'Rechazado') {
              rechazoCount++;
            } else if (sub === 'aprobo' || sub === 'aprobado' || sub === 'Aprobado') {
              aproboCount++;
            } else if (sub === 'cancelo' || sub === 'cancelado' || sub === 'Cancelado') {
              canceloCount++;
            }
          }

          if (isOwner) {
            const otherParts = parts.filter((p: any) => {
              const pId = p.id || p.user_id || p.userId;
              return pId !== user?.id;
            });
            otherParts.forEach((p: any) => {
              const sub = p.sub_estado || 'en_revision';
              if (isVencido) {
                partParticipacionVencidaCount++;
              } else if (isUrgente72h) {
                partUrgenteAtencionCount++;
              } else if (sub === 'sin_revisar') {
                partSinRevisarCount++;
              } else if (sub === 'en_revision') {
                partEnRevisionCount++;
              } else if (sub === 'firmo' || sub === 'firmado') {
                partFirmoCount++;
              } else if (sub === 'rechazo' || sub === 'rechazado') {
                partRechazoCount++;
              } else if (sub === 'aprobo' || sub === 'aprobado') {
                partAproboCount++;
              } else if (sub === 'cancelo' || sub === 'cancelado') {
                partCanceloCount++;
              }
            });
          }

          // No revisados por mí
          const isParticipantSinRevisar = d._isParticipantDoc
            ? (!d._mySubEstado || d._mySubEstado === 'sin_revisar' || d._mySubEstado === 'Sin revisión')
            : parts.some((p: any) => {
                const pId = p.id || p.user_id || p.userId;
                const pEmail = p.email || '';
                return (pId === user?.id || pEmail === user?.email) && (!p.sub_estado || p.sub_estado === 'sin_revisar');
              });

          if (isParticipantSinRevisar) {
            sinRevisarPropiosCount++;
            if (sinRevisarPropiosDocs.length < 10) sinRevisarPropiosDocs.push(mapped);
          }

          if (isOwner) {
            const hasParticipantSinRevisar = parts.some((p: any) => {
              const pId = p.id || p.user_id || p.userId;
              const pEmail = p.email || '';
              const isCurrentUser = pId === user?.id || pEmail === user?.email;
              return !isCurrentUser && (!p.sub_estado || p.sub_estado === 'sin_revisar');
            });
            if (hasParticipantSinRevisar) {
              sinRevisarParticipantesCount++;
              if (sinRevisarParticipantesDocs.length < 10) sinRevisarParticipantesDocs.push(mapped);
            }
          }

          const esUrgente = !!d.es_urgente;
          const tieneSinRevisar = d._isParticipantDoc
            ? (!d._mySubEstado || d._mySubEstado === 'sin_revisar' || d._mySubEstado === 'Sin revisión')
            : parts.some((p: any) => !p.sub_estado || p.sub_estado === 'sin_revisar');
          if (esUrgente || tieneSinRevisar) {
            sugeridos.push({ ...mapped, esUrgente });
          }
        }
      });

      sugeridos.sort((a, b) => {
        if (a.esUrgente && !b.esUrgente) return -1;
        if (!a.esUrgente && b.esUrgente) return 1;
        return 0;
      });

      setSubEstadoCounts({
        sin_revisar: sinRevisarCount,
        en_revision: enRevisionCount,
        firmo: firmoCount,
        rechazo: rechazoCount,
        aprobo: aproboCount,
        cancelo: canceloCount,
        urgente_atencion: urgenteAtencionCount,
        participacion_vencida: participacionVencidaCount,
        participantes_sin_revisar: partSinRevisarCount,
        participantes_en_revision: partEnRevisionCount,
        participantes_firmo: partFirmoCount,
        participantes_rechazo: partRechazoCount,
        participantes_aprobo: partAproboCount,
        participantes_cancelo: partCanceloCount,
        participantes_urgente_atencion: partUrgenteAtencionCount,
        participantes_participacion_vencida: partParticipacionVencidaCount,
        sin_revisar_propios: sinRevisarPropiosCount,
        sin_revisar_participantes: sinRevisarParticipantesCount,
        no_inicializados: noInicializadosCount,
      });
      setSugeridosDocuments(sugeridos.slice(0, 10));
      setNoInicializadosDocuments(noInicializados.slice(0, 10));
      setSinRevisarPropiosDocs(sinRevisarPropiosDocs.slice(0, 10));
      setSinRevisarParticipantesDocs(sinRevisarParticipantesDocs.slice(0, 10));
    } catch (err) { console.error('Error loading documents:', err); }
    finally { setLoadingDocs(false); }
  }, [user]);

  const loadFavorites = useCallback(async () => {
    if (!user) return;
    setLoadingFavorites(true);
    const supabase = createClient();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setLoadingFavorites(false); return; }

      const res = await fetch('/api/documentos/listar?tipo=favoritos', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al cargar favoritos');
      setFavoriteDocuments((json.data || []).map(mapDocRow));
    } catch (err) { console.error('Error loading favorites:', err); }
    finally { setLoadingFavorites(false); }
  }, [user]);

  const loadPorVencer = useCallback(async () => {
    if (!user) return;
    setLoadingPorVencer(true);
    const supabase = createClient();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setLoadingPorVencer(false); return; }

      const res = await fetch('/api/documentos/listar?tipo=por_vencer', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al cargar por vencer');
      setPorVencerDocuments((json.data || []).map(mapDocRow));
    } catch (err) { console.error('Error loading por vencer:', err); }
    finally { setLoadingPorVencer(false); }
  }, [user]);

  const loadPapelera = useCallback(async () => {
    if (!user) return;
    setLoadingPapelera(true);
    const supabase = createClient();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setLoadingPapelera(false); return; }

      const res = await fetch('/api/documentos/listar?tipo=papelera', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al cargar papelera');
      setDeletedDocuments((json.data || []).map((d: any) => ({
        id: d.id,
        name: d.nombre || 'Sin nombre',
        descripcion: d.descripcion || null,
        tipo: 'Documento',
        eliminadoPor: user.user_metadata?.full_name || user.email || 'Usuario',
        fechaEliminacion: d.deleted_at ? formatDate(d.deleted_at) : '—',
        tamano: d.file_size ? `${Math.round(d.file_size / 1024)} KB` : '—',
        retencion: d.retencion || null,
      })));
    } catch (err) { console.error('Error loading papelera:', err); }
    finally { setLoadingPapelera(false); }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    loadDocuments();
    const supabase = createClient();
    const channel = supabase
      .channel(`mis-documentos-${user.id}`)
      // Owned documents changes
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documentos', filter: `owner_id=eq.${user.id}` }, () => loadDocuments())
      // Participant rows for this user (status/sub_estado changes from other screens)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participantes', filter: `user_id=eq.${user.id}` }, () => loadDocuments())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, loadDocuments]);

  useEffect(() => {
    if (activeSection === 'favoritos') loadFavorites();
    if (activeSection === 'por-vencer') loadPorVencer();
    if (activeSection === 'papelera') loadPapelera();
  }, [activeSection, loadFavorites, loadPorVencer, loadPapelera]);

  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    const VIEW_KEY = 'mi_espacio_v1';

    const loadPreferences = async () => {
      const { data, error } = await supabase
        .from('user_view_preferences')
        .select('columns_config, filters_config, custom_filters, grid_columns_config')
        .eq('user_id', user.id)
        .eq('view_key', VIEW_KEY)
        .single();

      if (!error && data) {
        if (Array.isArray(data.columns_config) && data.columns_config.length > 0) {
          // Merge stored order/visibility with defaults (add any missing columns)
          const stored: ColumnConfig[] = data.columns_config;
          const storedIds = stored.map((c: ColumnConfig) => c.id);
          const missing = DEFAULT_COLUMNS.filter((c) => !storedIds.includes(c.id));
          setColumnConfig([...stored, ...missing]);
        }
        if (Array.isArray(data.filters_config) && data.filters_config.length > 0) {
          const stored: FilterVisibilityConfig[] = data.filters_config;
          const storedIds = stored.map((f: FilterVisibilityConfig) => f.id);
          const missing = DEFAULT_FILTERS.filter((f) => !storedIds.includes(f.id));
          setFilterConfig([...stored, ...missing]);
        }
        if (Array.isArray(data.custom_filters) && data.custom_filters.length > 0) {
          setCustomFilters(data.custom_filters as CustomFilter[]);
        }
        if (Array.isArray(data.grid_columns_config) && data.grid_columns_config.length > 0) {
          const stored: GridColumnConfig[] = data.grid_columns_config;
          const storedIds = stored.map((c: GridColumnConfig) => c.id);
          const missing = DEFAULT_GRID_COLUMNS.filter((c) => !storedIds.includes(c.id));
          setGridColumnConfig([...stored, ...missing]);
        }
        // NOTE: active_filters and custom_date_ranges are intentionally NOT restored on load.
        // We only persist which filters are configured to show, not their selected values.
      }
      setPrefsLoaded(true);
    };

    loadPreferences();
  }, [user]);

  const savePreferences = async (cols: ColumnConfig[], fils: FilterVisibilityConfig[]) => {
    if (!user) return;
    const supabase = createClient();
    const VIEW_KEY = 'mi_espacio_v1';
    await supabase
      .from('user_view_preferences')
      .upsert(
        {
          user_id: user.id,
          view_key: VIEW_KEY,
          columns_config: cols,
          filters_config: fils,
        },
        { onConflict: 'user_id,view_key' }
      );
  };

  const saveGridColumnPreferences = async (gridCols: GridColumnConfig[]) => {
    if (!user) return;
    const supabase = createClient();
    const VIEW_KEY = 'mi_espacio_v1';
    await supabase
      .from('user_view_preferences')
      .upsert(
        {
          user_id: user.id,
          view_key: VIEW_KEY,
          grid_columns_config: gridCols,
        },
        { onConflict: 'user_id,view_key' }
      );
  };

  // NOTE: saveActiveFilters removed — active filter values are not persisted (only filter visibility is)

  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    const loadActivity = async () => {
      setLoadingActivity(true);
      try {
        const { data, error } = await supabase.from('audit_trail').select('id, accion, documento_nombre, documento_id, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5);
        if (!error && data) setRecentActivity(data);
      } catch (_) { /* ignore */ }
      finally { setLoadingActivity(false); }
    };
    loadActivity();
    const actChannel = supabase.channel(`activity-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_trail', filter: `user_id=eq.${user.id}` }, (payload) => {
        setRecentActivity((prev) => [payload.new as ActivityItem, ...prev].slice(0, 5));
      }).subscribe();
    return () => { supabase.removeChannel(actChannel); };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    const loadCarpetas = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      try {
        const res = await fetch('/api/documentos/carpetas', { headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json();
        if (json.data) setCarpetas(json.data.map((c: any) => ({
          id: c.id,
          name: c.nombre,
          creadoEn: c.created_at ? formatDate(c.created_at) : '',
          parentId: c.parent_id || null,
          descripcion: c.descripcion || null,
          tipoDocumentoId: c.tipo_documento_id || null,
          tipoDocumentoNombre: c.tipo_documento?.nombre || null,
          grupoTipoDocumentoId: c.grupo_tipo_documento_id || null,
          grupoTipoDocumentoNombre: c.grupo_tipo_documento?.nombre || null,
        })));
      } catch (err) {
        console.error('Error loading carpetas:', err);
      }
    };
    loadCarpetas();
  }, [user]);

  const workspaceDisplayName = activeWorkspace?.name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Mi Espacio';
  const isPersonalWorkspace = !activeWorkspace || activeWorkspace.workspaceType === 'personal';
  const personalUserFullName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Mi Espacio';
  const workspaceLabel = isPersonalWorkspace ? 'Espacio personal de' : 'Espacio de';

  // Derived: carpetas visible in current folder view
  const visibleCarpetas = carpetas.filter((c) => {
    const matchesFolder = currentFolderId === null ? c.parentId === null : c.parentId === currentFolderId;
    return matchesFolder && c.name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  // Derived: documents visible in current folder view
  const visibleDocuments = realDocuments.filter((doc) => {
    const matchesFolder = currentFolderId === null ? (doc.carpetaId === null || doc.carpetaId === undefined) : doc.carpetaId === currentFolderId;
    if (!matchesFolder) return false;
    if (!doc.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;

    // Apply active filters
    // estructura / tipo: 'carpeta' | 'archivo' — documents are always 'archivo'
    if (activeFilters['estructura'] && activeFilters['estructura'] !== '') {
      if (activeFilters['estructura'] === 'carpeta') return false; // documents are not folders
      // 'archivo' matches all documents — keep
    }

    // tipoDocumento: array of selected IDs
    if (activeFilters['tipoDocumento'] && Array.isArray(activeFilters['tipoDocumento']) && activeFilters['tipoDocumento'].length > 0) {
      const selectedIds: string[] = activeFilters['tipoDocumento'];
      const hasOtro = selectedIds.includes('__otros__');
      const regularIds = selectedIds.filter((id) => id !== '__otros__');
      const matchesOtro = hasOtro && doc.tipoDocumentoId === '__otros__';
      const matchesRegular = regularIds.length > 0 && doc.tipoDocumentoId != null && regularIds.includes(doc.tipoDocumentoId);
      if (!matchesOtro && !matchesRegular) return false;
    }

    // propietario: all docs belong to current user — filter by name match
    if (activeFilters['propietario'] && activeFilters['propietario'] !== '' && activeFilters['propietario'] !== 'todos') {
      if (activeFilters['propietario'] === 'mios') {
        // Only show docs owned by current user — already the case since we query by owner_id
        // no-op: all docs are already the current user's
      } else if (Array.isArray(activeFilters['propietario']) && activeFilters['propietario'].length > 0) {
        // filter by selected user IDs — since docs are owner_id = user.id, only show if user.id is in list
        if (!activeFilters['propietario'].includes(user?.id || '')) return false;
      }
    }

    // ultimaModificacion: date range — filter by preset or custom range
    if (activeFilters['ultimaModificacion'] && activeFilters['ultimaModificacion'] !== '') {
      // doc.ultimaModificacion is formatted as DD/MM/YYYY HH:MM am/pm — parse from ISO stored in raw data
      // Use fechaCreacion as fallback; parse the formatted string back to a date
      const parseFormattedDate = (formatted: string): Date | null => {
        if (!formatted || formatted === '—') return null;
        // Format: DD/MM/YYYY HH:MM a.m./p.m.
        const parts = formatted.split(' ');
        if (parts.length < 2) return null;
        const [dd, mm, yyyy] = parts[0].split('/');
        if (!dd || !mm || !yyyy) return null;
        return new Date(`${yyyy}-${mm}-${dd}`);
      };
      const docDate = parseFormattedDate(doc.ultimaModificacion);
      if (docDate) {
        const now = new Date();
        const range = activeFilters['ultimaModificacion'];
        if (range === 'today') {
          const todayDate = new Date(); todayDate.setHours(0,0,0,0);
          if (docDate < todayDate) return false;
        } else if (range === 'week') {
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          if (docDate < weekAgo) return false;
        } else if (range === 'month') {
          const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          if (docDate < monthAgo) return false;
        } else if (range === 'year') {
          const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          if (docDate < yearAgo) return false;
        } else if (range === 'custom') {
          const cr = customDateRanges['ultimaModificacion'];
          if (cr?.start && cr?.end) {
            const start = new Date(cr.start); start.setHours(0,0,0,0);
            const end = new Date(cr.end); end.setHours(23,59,59,999);
            if (docDate < start || docDate > end) return false;
          }
        }
      }
    }

    // estado
    if (activeFilters['estado'] && activeFilters['estado'] !== '') {
      if (activeFilters['estado'] === 'Vencido') {
        // Vencido: doc has a past expiry date and is not completed/cancelled/rejected
        const fv = doc.fechaVencimiento ? new Date(doc.fechaVencimiento) : null;
        const now = new Date();
        const isVencido = fv && fv < now && !['Completado', 'Cancelado', 'Rechazado'].includes(doc.estado);
        if (!isVencido) return false;
      } else {
        if (doc.estado !== activeFilters['estado']) return false;
      }
    }

    // fechaVencimiento: 'vencido' | 'proximos' | 'sin_vencimiento' | 'custom'
    if (activeFilters['fechaVencimiento'] && activeFilters['fechaVencimiento'] !== '') {
      const fv = activeFilters['fechaVencimiento'];
      const now = new Date();
      if (fv === 'vencido') {
        if (!doc.fechaVencimiento || new Date(doc.fechaVencimiento) >= now) return false;
      } else if (fv === 'proximos') {
        const in72h = new Date(now.getTime() + 72 * 60 * 60 * 1000);
        if (!doc.fechaVencimiento || new Date(doc.fechaVencimiento) < now || new Date(doc.fechaVencimiento) > in72h) return false;
      } else if (fv === 'sin_vencimiento') {
        if (doc.fechaVencimiento) return false;
      }
    }

    // etiquetas: filter by tag text match
    if (activeFilters['etiquetas'] && Array.isArray(activeFilters['etiquetas']) && activeFilters['etiquetas'].length > 0) {
      const selectedNames: string[] = activeFilters['etiquetas'];
      const hasMatch = doc.etiquetas.some((t) => selectedNames.includes(String(t)));
      if (!hasMatch) return false;
    }

    // fechaCompletado: date range
    if (activeFilters['fechaCompletado'] && activeFilters['fechaCompletado'] !== '') {
      const range = activeFilters['fechaCompletado'];
      const now = new Date();
      if (doc.fechaCompletado) {
        const parts = doc.fechaCompletado.split(' ')[0].split('/');
        let d = parts.length === 3 ? new Date(`${parts[2]}-${parts[1]}-${parts[0]}`) : null;
        if (d && !isNaN(d.getTime())) {
          if (range === 'sin_completado') {
            if (doc.fechaCompletado) return false;
          } else if (range === 'today') {
            const t = new Date(); t.setHours(0,0,0,0);
            if (d < t) return false;
          } else if (range === 'week') {
            if (d < new Date(now.getTime() - 7*24*60*60*1000)) return false;
          } else if (range === 'month') {
            if (d < new Date(now.getTime() - 30*24*60*60*1000)) return false;
          }
        }
      } else {
        // doc has no fechaCompletado but filter requires one
        if (range !== 'sin_completado') return false;
      }
    }

    // fechaCreacion: date range
    if (activeFilters['fechaCreacion'] && activeFilters['fechaCreacion'] !== '') {
      const range = activeFilters['fechaCreacion'];
      const now = new Date();
      if (doc.fechaCreacion) {
        const parts = doc.fechaCreacion.split(' ')[0].split('/');
        let d = parts.length === 3 ? new Date(`${parts[2]}-${parts[1]}-${parts[0]}`) : null;
        if (d && !isNaN(d.getTime())) {
          if (range === 'today') {
            const t = new Date(); t.setHours(0,0,0,0);
            if (d < t) return false;
          } else if (range === 'week') {
            if (d < new Date(now.getTime() - 7*24*60*60*1000)) return false;
          } else if (range === 'month') {
            if (d < new Date(now.getTime() - 30*24*60*60*1000)) return false;
          } else if (range === 'year') {
            if (d < new Date(now.getTime() - 365*24*60*60*1000)) return false;
          } else if (range === 'custom') {
            const cr = customDateRanges['fechaCreacion'];
            if (cr?.start && cr?.end) {
              const start = new Date(cr.start); start.setHours(0,0,0,0);
              const end = new Date(cr.end); end.setHours(23,59,59,999);
              if (d < start || d > end) return false;
            }
          }
        }
      }
    }

    // participantes: text match on participant name/email
    if (activeFilters['participantes'] && activeFilters['participantes'] !== '' && activeFilters['participantes'] !== 'todos') {
      const parts: any[] = doc.participantes || [];
      if (activeFilters['participantes'] === 'yo') {
        // Show docs where current user is a participant
        const isParticipant = parts.some((p) => {
          const pid = p.id || p.user_id || p.userId;
          const pemail = p.email || '';
          return pid === user?.id || pemail === user?.email;
        });
        if (!isParticipant) return false;
      } else if (Array.isArray(activeFilters['participantes']) && activeFilters['participantes'].length > 0) {
        const selectedIds: string[] = activeFilters['participantes'];
        const hasMatch = parts.some((p) => {
          const pid = p.id || p.user_id || p.userId || p.email;
          return selectedIds.includes(pid);
        });
        if (!hasMatch) return false;
      }
    }

    // prioridad: 'urgente' | 'normal'
    if (activeFilters['prioridad'] && activeFilters['prioridad'] !== '') {
      if (activeFilters['prioridad'] === 'urgente' && !doc.esUrgente) return false;
      if (activeFilters['prioridad'] === 'normal' && doc.esUrgente) return false;
    }

    // estadoParticipacion: filter by current user's participation sub_estado
    if (activeFilters['estadoParticipacion'] && activeFilters['estadoParticipacion'] !== '') {
      const filterVal = activeFilters['estadoParticipacion'];
      if (filterVal === 'ninguna') {
        // Show only docs where user has no participation
        if (doc.miSubEstado !== null && doc.miSubEstado !== undefined) return false;
      } else if (filterVal === 'urgente_atencion') {
        // Urgente: has participation and doc is within 72h of expiry
        const fv = doc.fechaVencimiento ? new Date(doc.fechaVencimiento) : null;
        const now2 = new Date();
        const in72h2 = new Date(now2.getTime() + 72 * 60 * 60 * 1000);
        if (!doc.miSubEstado || !fv || fv < now2 || fv > in72h2) return false;
      } else if (filterVal === 'participacion_vencida') {
        // Vencida: has participation and doc is past expiry
        const fv = doc.fechaVencimiento ? new Date(doc.fechaVencimiento) : null;
        const now2 = new Date();
        if (!doc.miSubEstado || !fv || fv >= now2) return false;
      } else {
        if (doc.miSubEstado !== filterVal) return false;
      }
    }

    return true;
  });

  // Sort visible documents for Mi Espacio
  const sortedDocuments = [...visibleDocuments].sort((a, b) => {
    if (miEspacioSortOrder === 'nombre_asc') return a.name.localeCompare(b.name);
    if (miEspacioSortOrder === 'nombre_desc') return b.name.localeCompare(a.name);
    if (miEspacioSortOrder === 'estado_asc') return a.estado.localeCompare(b.estado);
    if (miEspacioSortOrder === 'ultimaModificacion_asc') return a.ultimaModificacion.localeCompare(b.ultimaModificacion);
    return b.ultimaModificacion.localeCompare(a.ultimaModificacion);
  });

  const toggleSelectAll = () => {
    const allFolderIds = visibleCarpetas.map((c) => c.id);
    const allSelected = selectedRows.length === sortedDocuments.length && selectedFolders.length === visibleCarpetas.length && (sortedDocuments.length + visibleCarpetas.length) > 0;
    if (allSelected) {
      setSelectedRows([]);
      setSelectedFolders([]);
    } else {
      setSelectedRows(sortedDocuments.map((d) => d.id));
      setSelectedFolders(allFolderIds);
    }
  };

  const toggleSelectFolder = (id: string) => {
    setSelectedFolders((prev) => prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]);
  };

  const toggleSelectRow = (id: string) => {
    setSelectedRows((prev) => prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]);
  };

  const handleRestore = async (docId: string) => {
    if (!user) return;
    const supabase = createClient();
    const { error } = await supabase.from('documentos').update({ deleted_at: null }).eq('id', docId).eq('owner_id', user.id);
    if (!error) { setDeletedDocuments((prev) => prev.filter((d) => d.id !== docId)); showToast('Documento restaurado correctamente'); loadDocuments(); }
    else showToast('Error al restaurar el documento');
  };

  const openConfirmDelete = (docId: string, docName: string) => setConfirmDelete({ open: true, docId, docName, isEmptyAll: false });
  const openConfirmEmptyAll = () => setConfirmDelete({ open: true, docId: null, docName: '', isEmptyAll: true });

  const handleConfirmPermanentDelete = async () => {
    if (!user) return;
    const supabase = createClient();
    if (confirmDelete.isEmptyAll) {
      const { error } = await supabase.from('documentos').delete().eq('owner_id', user.id).not('deleted_at', 'is', null);
      if (!error) setDeletedDocuments([]);
    } else if (confirmDelete.docId) {
      const { error } = await supabase.from('documentos').delete().eq('id', confirmDelete.docId).eq('owner_id', user.id);
      if (!error) setDeletedDocuments((prev) => prev.filter((d) => d.id !== confirmDelete.docId));
    }
    setConfirmDelete({ open: false, docId: null, docName: '', isEmptyAll: false });
  };

  const filteredDeleted = deletedDocuments.filter((doc) => doc.name.toLowerCase().includes(papeleraSearch.toLowerCase()));

  const handleCrearCarpeta = async () => {
    const nombre = nuevaCarpetaNombre.trim();
    if (!nombre) { setCarpetaError('El nombre de la carpeta es obligatorio.'); return; }
    if (!nuevaCarpetaGrupoId) { setCarpetaError('El grupo de tipo de documento es obligatorio.'); return; }
    if (!user) return;
    setCrearCarpetaLoading(true);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) { setCarpetaError('No autenticado. Inicia sesión de nuevo.'); setCrearCarpetaLoading(false); return; }
    try {
      const res = await fetch('/api/documentos/carpetas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          nombre,
          parent_id: currentFolderId,
          descripcion: nuevaCarpetaDescripcion.trim() || null,
          grupo_tipo_documento_id: nuevaCarpetaGrupoId || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) { setCarpetaError(json.error || 'Error al crear la carpeta. Intenta de nuevo.'); setCrearCarpetaLoading(false); return; }
      if (json.data) setCarpetas((prev) => [...prev, {
        id: json.data.id,
        name: json.data.nombre,
        creadoEn: json.data.created_at ? formatDate(json.data.created_at) : '',
        parentId: json.data.parent_id || null,
        descripcion: json.data.descripcion || null,
        tipoDocumentoId: json.data.tipo_documento_id || null,
        tipoDocumentoNombre: json.data.tipo_documento?.nombre || null,
        grupoTipoDocumentoId: json.data.grupo_tipo_documento_id || null,
        grupoTipoDocumentoNombre: json.data.grupo_tipo_documento?.nombre || null,
      }]);
      setNuevaCarpetaNombre('');
      setNuevaCarpetaDescripcion('');
      setNuevaCarpetaTipoDocumentoId('');
      setNuevaCarpetaGrupoId('');
      setCarpetaError('');
      setShowCarpetaModal(false);
    } catch (err) {
      setCarpetaError('Error al crear la carpeta. Intenta de nuevo.');
    } finally {
      setCrearCarpetaLoading(false);
    }
  };

  const handleCloseCarpetaModal = () => {
    setShowCarpetaModal(false);
    setNuevaCarpetaNombre('');
    setNuevaCarpetaDescripcion('');
    setNuevaCarpetaTipoDocumentoId('');
    setNuevaCarpetaGrupoId('');
    setCarpetaError('');
  };

  const handleMoverACarpeta = async (carpetaId: string | null, carpetaName: string) => {
    if (!user) return;
    const supabase = createClient();
    const ids = moveModal.isBulk ? selectedRows : (moveModal.docId ? [moveModal.docId] : []);
    if (ids.length === 0) return;
    const { error } = await supabase.from('documentos').update({ carpeta_id: carpetaId }).in('id', ids).eq('owner_id', user.id);
    setMoveModal({ open: false, docId: null, docName: '', isBulk: false });
    if (!error) {
      if (moveModal.isBulk) setSelectedRows([]);
      showToast(carpetaId ? `Documento(s) movido(s) a "${carpetaName}"` : `Documento(s) movido(s) a la raíz`);
      loadDocuments();
    } else {
      showToast('Error al mover el documento');
    }
  };

  // Drag & drop handlers
  const handleDragStart = (e: React.DragEvent, docId: string) => {
    setDragDocId(docId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('type', 'document');
    e.dataTransfer.setData('id', docId);
  };

  const handleFolderDragStart = (e: React.DragEvent, folderId: string) => {
    setDragFolderId(folderId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('type', 'folder');
    e.dataTransfer.setData('id', folderId);
  };

  const handleDragEnd = () => {
    setDragDocId(null);
    setDragFolderId(null);
    setDragOverFolderId(null);
  };

  const handleFolderDragOver = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverFolderId(folderId);
  };

  const handleFolderDragLeave = () => {
    setDragOverFolderId(null);
  };

  const handleFolderDrop = async (e: React.DragEvent, carpeta: Carpeta) => {
    e.preventDefault();
    setDragOverFolderId(null);
    if (!user) return;

    const type = e.dataTransfer.getData('type');
    const id = e.dataTransfer.getData('id');

    const supabase = createClient();

    if (type === 'document' && (dragDocId || id)) {
      const docId = dragDocId || id;
      if (!docId) return;
      const { error } = await supabase.from('documentos').update({ carpeta_id: carpeta.id }).eq('id', docId).eq('owner_id', user.id);
      setDragDocId(null);
      if (!error) {
        showToast(`Documento movido a "${carpeta.name}"`);
        loadDocuments();
      } else {
        showToast('Error al mover el documento');
      }
    } else if (type === 'folder' && (dragFolderId || id)) {
      const folderId = dragFolderId || id;
      if (!folderId || folderId === carpeta.id) return;
      // Prevent moving a folder into itself or its descendants
      if (isDescendant(folderId, carpeta.id, carpetas)) { showToast('No puedes mover una carpeta dentro de sí misma'); setDragFolderId(null); return; }
      const { error } = await supabase.from('carpetas').update({ parent_id: carpeta.id }).eq('id', folderId).eq('owner_id', user.id);
      setDragFolderId(null);
      if (!error) {
        setCarpetas((prev) => prev.map((c) => c.id === folderId ? { ...c, parentId: carpeta.id } : c));
        showToast(`Carpeta movida a "${carpeta.name}"`);
      } else {
        showToast('Error al mover la carpeta');
      }
    }
  };

  // Root-level folders for sidebar tree
  const rootCarpetas = carpetas.filter((c) => c.parentId === null);

  // Helper: get label for active tipoDocumento filter
  const getTipoDocFilterLabel = () => {
    const ids: string[] = activeFilters['tipoDocumento'] || [];
    if (ids.length === 0) return null;
    if (ids.length === 1) {
      const t = tiposDocumento.find((x) => x.id === ids[0]);
      return t ? t.nombre : '1 tipo';
    }
    return `${ids.length} tipos`;
  };

  // Save custom filters helper
  const saveCustomFilters = async (filters: CustomFilter[]) => {
    if (!user) return;
    const supabase = createClient();
    const VIEW_KEY = 'mi_espacio_v1';
    await supabase
      .from('user_view_preferences')
      .upsert(
        {
          user_id: user.id,
          view_key: VIEW_KEY,
          custom_filters: filters,
        },
        { onConflict: 'user_id,view_key' }
      );
  };

  // ─── Render helpers ────────────────────────────────────────────────────────

  const renderFolderGridCard = (carpeta: Carpeta) => {
    // Count children
    const numCarpetas = carpetas.filter((c) => c.parentId === carpeta.id).length;
    const numArchivos = realDocuments.filter((d) => d.carpetaId === carpeta.id).length;
    const tamano = realDocuments
      .filter((d) => d.carpetaId === carpeta.id)
      .reduce((acc, d) => {
        const kb = d.tamano && d.tamano !== '—' ? parseFloat(d.tamano) : 0;
        return acc + kb;
      }, 0);
    const tamanoStr = tamano > 0 ? `${tamano.toFixed(0)} KB` : '—';

    return (
      <div
        key={carpeta.id}
        draggable
        onDragStart={(e) => handleFolderDragStart(e, carpeta.id)}
        onDragEnd={handleDragEnd}
        className={`relative flex flex-col rounded-xl border cursor-pointer transition-all group overflow-hidden
          ${dragOverFolderId === carpeta.id ? 'border-primary bg-primary/5 scale-105' : selectedFolders.includes(carpeta.id) ? 'border-primary bg-primary/5 shadow-sm' : 'border-border bg-white hover:border-primary/40 hover:shadow-md'}
          ${dragFolderId === carpeta.id ? 'opacity-50' : ''}
        `}
        onDragOver={(e) => handleFolderDragOver(e, carpeta.id)}
        onDragLeave={handleFolderDragLeave}
        onDrop={(e) => handleFolderDrop(e, carpeta)}
      >
        {/* Checkbox top-left */}
        <div className="absolute top-3 left-3 z-10">
          <input
            type="checkbox"
            checked={selectedFolders.includes(carpeta.id)}
            onChange={(e) => { e.stopPropagation(); toggleSelectFolder(carpeta.id); }}
            onClick={(e) => e.stopPropagation()}
            className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
          />
        </div>
        {/* Actions button top-right */}
        <div className="absolute top-3 right-3 z-10">
          <button
            onClick={(e) => { e.stopPropagation(); openFolderContextMenu(e, carpeta); }}
            className={`p-1 rounded hover:bg-muted/80 transition-colors bg-white/80 backdrop-blur-sm ${activeFolderContextMenuId === carpeta.id && folderContextMenu.open ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`}
            title="Opciones"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
          </button>
        </div>
        {/* Top section: icon + name + description — clicking name opens folder */}
        <div className="flex flex-col items-center pt-5 pb-3 px-3 gap-1.5">
          <Folder size={36} className={`${dragOverFolderId === carpeta.id ? 'text-primary' : 'text-yellow-400 group-hover:text-yellow-500'} transition-colors flex-shrink-0`} />
          <button
            onClick={() => handleOpenFolder(carpeta)}
            className="text-sm font-semibold text-foreground text-center line-clamp-2 leading-tight w-full hover:text-primary transition-colors"
          >
            {carpeta.name}
          </button>
          {carpeta.descripcion && (
            <span className="text-xs text-muted-foreground text-center line-clamp-2 leading-tight w-full">{carpeta.descripcion}</span>
          )}
          {carpeta.grupoTipoDocumentoNombre && (
            <span className="px-2 py-0.5 text-[10px] font-medium bg-primary/10 text-primary rounded-full border border-primary/20 truncate max-w-full">{carpeta.grupoTipoDocumentoNombre}</span>
          )}
        </div>
        {/* Divider */}
        <div className="border-t border-border mx-0" />
        {/* Stats section */}
        <div className="flex flex-col gap-1 px-3 py-2.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Tamaño</span>
            <span className="font-medium text-foreground">{tamanoStr}</span>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Archivos</span>
            <span className="font-medium text-foreground">{numArchivos}</span>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Carpetas</span>
            <span className="font-medium text-foreground">{numCarpetas}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderDocGridCard = (doc: Document) => {
    const selectedFields = gridColumnConfig
      .filter((c) => c.selected)
      .sort((a, b) => a.order - b.order)
      .slice(0, 5); // max 5 columns

    const renderFieldValue = (fieldId: string) => {
      switch (fieldId) {
        case 'estado':
          return (
            <span className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusDot(doc.estado)}`} />
              {doc.estado}
            </span>
          );
        case 'estadoParticipacion':
          return doc.miSubEstado ? (
            <span className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getParticipacionDot(doc.miSubEstado)}`} />
              {getParticipacionLabel(doc.miSubEstado)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground italic">Ninguna</span>
          );
        case 'etiquetas':
          if (!doc.etiquetas || doc.etiquetas.length === 0) return null;
          return (
            <div className="flex flex-wrap justify-center gap-1">
              {doc.etiquetas.slice(0, 2).map((tagId, i) => {
                const etiqueta = etiquetasList.find((e) => e.id === String(tagId) || e.nombre === String(tagId));
                const label = etiqueta ? etiqueta.nombre : String(tagId);
                const color = etiqueta?.color || '#6366f1';
                return (
                  <span
                    key={i}
                    className="px-2 py-0.5 text-[10px] font-medium rounded-full border"
                    style={{ backgroundColor: `${color}20`, color, borderColor: `${color}40` }}
                  >
                    {label}
                  </span>
                );
              })}
              {doc.etiquetas.length > 2 && (
                <span className="px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground rounded-full border border-border">
                  +{doc.etiquetas.length - 2}
                </span>
              )}
            </div>
          );
        case 'ultimaModificacion':
          return <span className="text-xs text-muted-foreground text-center">{doc.ultimaModificacion}</span>;
        case 'tamano':
          return <span className="text-xs text-muted-foreground">{doc.tamano}</span>;
        case 'propietario':
          return (
            <span className="text-xs text-muted-foreground text-center">
              {doc.ownerName || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Yo'}
            </span>
          );
        case 'numeroDocumento':
          return doc.numeroOficio ? <span className="text-xs text-muted-foreground text-center">{doc.numeroOficio}</span> : null;
        case 'folioInterno':
          return doc.folioInterno ? <span className="text-xs text-muted-foreground text-center">{doc.folioInterno}</span> : null;
        case 'fechaCreacion':
          return doc.fechaCreacion ? <span className="text-xs text-muted-foreground text-center">{doc.fechaCreacion}</span> : null;
        case 'fechaCompletado':
          return doc.fechaCompletado ? <span className="text-xs text-muted-foreground text-center">{doc.fechaCompletado}</span> : null;
        case 'tipoDocumento':
          return doc.tipoDocumentoNombre ? <span className="text-xs text-muted-foreground truncate max-w-full text-center">{doc.tipoDocumentoNombre}</span> : null;
        case 'fechaVencimiento':
          return doc.fechaVencimiento ? <span className="text-xs text-muted-foreground text-center">{formatDate(doc.fechaVencimiento)}</span> : null;
        case 'prioridad':
          return doc.esUrgente ? (
            <span className="px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-600 rounded-full">Urgente</span>
          ) : (
            <span className="text-sm text-muted-foreground">Normal</span>
          );
        default:
          return null;
      }
    };

    // Separate fields: etiquetas shown below name (before divider), rest shown after divider
    const tagField = selectedFields.find((f) => f.id === 'etiquetas');
    const otherFields = selectedFields.filter((f) => f.id !== 'etiquetas');

    return (
      <div
        key={doc.id}
        draggable
        onDragStart={(e) => handleDragStart(e, doc.id)}
        onDragEnd={handleDragEnd}
        className={`relative flex flex-col rounded-2xl border cursor-pointer transition-all group overflow-hidden
          ${selectedRows.includes(doc.id) ? 'border-primary bg-primary/5 shadow-sm' : 'border-border bg-white hover:border-primary/30 hover:shadow-md'}
          ${dragDocId === doc.id ? 'opacity-50' : ''}
        `}
        onDoubleClick={() => doc.isDraft ? router.push(`/crear-documento?draft=${doc.id}`) : router.push(`/visor-documento/${doc.id}`)}
      >
        {/* Checkbox top-left */}
        <div className="absolute top-3 left-3 z-10">
          <input
            type="checkbox"
            checked={selectedRows.includes(doc.id)}
            onChange={(e) => { e.stopPropagation(); toggleSelectRow(doc.id); }}
            onClick={(e) => e.stopPropagation()}
            className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
          />
        </div>

        {/* Actions button top-right */}
        <div className="absolute top-3 right-3 z-10">
          <button
            onClick={(e) => { e.stopPropagation(); openContextMenu(e, doc); }}
            className={`p-1 rounded hover:bg-muted/80 transition-colors bg-white/80 backdrop-blur-sm ${activeContextMenuDocId === doc.id && contextMenu.open ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`}
            title="Opciones"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
          </button>
        </div>

        {/* Icon area */}
        <div className="flex flex-col items-center pt-8 pb-3 px-4 gap-2">
          <FileText size={44} className={`${getDocIconColor(doc.estado)} transition-colors`} />
          {/* Name with favorite icon before it — clicking name navigates */}
          <div className="flex items-center gap-1 w-full justify-center">
            {doc.isFavorite && <Star size={11} className="text-yellow-400 fill-yellow-400 flex-shrink-0" />}
            {doc.esUrgente && <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0 inline-block" title="Urgente" />}
            <button
              onClick={() => doc.isDraft ? router.push(`/crear-documento?draft=${doc.id}`) : router.push(`/visor-documento/${doc.id}`)}
              className="text-sm font-semibold text-foreground text-center line-clamp-2 leading-tight hover:text-primary transition-colors"
            >
              {doc.name}
            </button>
          </div>

          {/* Tags below name (before divider) */}
          {tagField && doc.etiquetas && doc.etiquetas.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1 mt-0.5">
              {doc.etiquetas.slice(0, 2).map((tagId, i) => {
                const etiqueta = etiquetasList.find((e) => e.id === String(tagId) || e.nombre === String(tagId));
                const label = etiqueta ? etiqueta.nombre : String(tagId);
                const color = etiqueta?.color || '#6366f1';
                return (
                  <span
                    key={i}
                    className="px-2 py-0.5 text-[10px] font-medium rounded-full border"
                    style={{ backgroundColor: `${color}20`, color, borderColor: `${color}40` }}
                  >
                    {label}
                  </span>
                );
              })}
              {doc.etiquetas.length > 2 && (
                <span className="px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground rounded-full border border-border">
                  +{doc.etiquetas.length - 2}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Divider + fields below */}
        {otherFields.length > 0 && (
          <>
            <div className="border-t border-border mx-0" />
            <div className="flex flex-col items-center gap-1.5 px-4 py-3">
              {otherFields.map((field) => {
                const value = renderFieldValue(field.id);
                if (!value) return null;
                return (
                  <div key={field.id} className="w-full flex justify-center">
                    {value}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  };

  const renderFolderTableRow = (carpeta: Carpeta) => {
    const visibleCols = columnConfig.filter((c) => c.visible);
    return (
    <tr
      key={carpeta.id}
      draggable
      onDragStart={(e) => handleFolderDragStart(e, carpeta.id)}
      onDragEnd={handleDragEnd}
      className={`border-b border-border hover:bg-muted/30 transition-colors group
        ${selectedFolders.includes(carpeta.id) ? 'bg-blue-50/60' : ''}
        ${dragOverFolderId === carpeta.id ? 'bg-primary/5' : ''}
        ${dragFolderId === carpeta.id ? 'opacity-50' : ''}
      `}
      onDragOver={(e) => handleFolderDragOver(e, carpeta.id)}
      onDragLeave={handleFolderDragLeave}
      onDrop={(e) => handleFolderDrop(e, carpeta)}
      onContextMenu={(e) => openFolderContextMenu(e, carpeta)}
    >
      <td className="px-4 py-3 w-10 flex-shrink-0">
        <input
          type="checkbox"
          checked={selectedFolders.includes(carpeta.id)}
          onChange={() => toggleSelectFolder(carpeta.id)}
          className="rounded border-border accent-primary cursor-pointer w-4 h-4"
        />
      </td>
      {/* Name column - spans all data columns */}
      <td className="px-3 py-3 min-w-[200px]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-yellow-50 border border-yellow-200 flex items-center justify-center flex-shrink-0">
            <Folder size={16} className={`${dragOverFolderId === carpeta.id ? 'text-primary' : 'text-yellow-500'} flex-shrink-0`} />
          </div>
          <div className="flex flex-col min-w-0">
            <button
              onClick={() => handleOpenFolder(carpeta)}
              className="text-sm font-medium text-foreground hover:text-primary transition-colors text-left"
            >
              {carpeta.name}
            </button>
            {carpeta.descripcion && (
              <span className="text-xs text-muted-foreground truncate max-w-[220px]">{carpeta.descripcion}</span>
            )}
            <span className="text-xs text-muted-foreground">Carpeta · {carpeta.creadoEn}</span>
          </div>
        </div>
      </td>
      {/* Render "-" for all visible data columns */}
      {visibleCols.find((c) => c.id === 'propietario')?.visible && (
        <td className="px-3 py-3 min-w-[100px]"><span className="text-sm text-muted-foreground">—</span></td>
      )}
      {visibleCols.find((c) => c.id === 'ultimaModificacion')?.visible && (
        <td className="px-3 py-3 min-w-[160px]"><span className="text-sm text-muted-foreground">—</span></td>
      )}
      {visibleCols.find((c) => c.id === 'tamano')?.visible && (
        <td className="px-3 py-3 min-w-[80px]"><span className="text-sm text-muted-foreground">—</span></td>
      )}
      {visibleCols.find((c) => c.id === 'estado')?.visible && (
        <td className="px-3 py-3 min-w-[120px]"><span className="text-sm text-muted-foreground">—</span></td>
      )}
      {visibleCols.find((c) => c.id === 'estadoParticipacion')?.visible && (
        <td className="px-3 py-3 min-w-[180px]"><span className="text-sm text-muted-foreground">—</span></td>
      )}
      {visibleCols.find((c) => c.id === 'etiquetas')?.visible && (
        <td className="px-3 py-3 min-w-[120px]"><span className="text-sm text-muted-foreground">—</span></td>
      )}
      {visibleCols.find((c) => c.id === 'numeroDocumento')?.visible && (
        <td className="px-3 py-3 min-w-[100px]"><span className="text-sm text-muted-foreground">—</span></td>
      )}
      {visibleCols.find((c) => c.id === 'folioInterno')?.visible && (
        <td className="px-3 py-3 min-w-[90px]"><span className="text-sm text-muted-foreground">—</span></td>
      )}
      {visibleCols.find((c) => c.id === 'fechaCreacion')?.visible && (
        <td className="px-3 py-3 min-w-[130px]"><span className="text-sm text-muted-foreground">—</span></td>
      )}
      {visibleCols.find((c) => c.id === 'fechaCompletado')?.visible && (
        <td className="px-3 py-3 min-w-[130px]"><span className="text-sm text-muted-foreground">—</span></td>
      )}
      {visibleCols.find((c) => c.id === 'fechaVencimiento')?.visible && (
        <td className="px-3 py-3 min-w-[120px]"><span className="text-sm text-muted-foreground">—</span></td>
      )}
      {visibleCols.find((c) => c.id === 'rutaGuardado')?.visible && (
        <td className="px-3 py-3 min-w-[120px]"><span className="text-sm text-muted-foreground">—</span></td>
      )}
      {visibleCols.find((c) => c.id === 'tipoDocumento')?.visible && (
        <td className="px-3 py-3 min-w-[100px]"><span className="text-sm text-muted-foreground">—</span></td>
      )}
      {visibleCols.find((c) => c.id === 'prioridad')?.visible && (
        <td className="px-3 py-3 min-w-[90px]"><span className="text-sm text-muted-foreground">—</span></td>
      )}
      <td className="sticky right-0 bg-white px-3 py-3 border-l border-border shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.06)] w-10">
        <button
          onClick={(e) => openFolderContextMenu(e, carpeta)}
          className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          title="Opciones"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
        </button>
      </td>
    </tr>
    );
  };

  const renderDocRowWithColumns = (doc: Document, cols: ColumnConfig[]) => {
    const ownerName = doc.ownerName || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Yo';
    return (
    <tr
      key={doc.id}
      draggable
      onDragStart={(e) => handleDragStart(e, doc.id)}
      onDragEnd={handleDragEnd}
      className={`border-b border-border last:border-0 hover:bg-muted/30 transition-colors group
        ${selectedRows.includes(doc.id) ? 'bg-blue-50/60' : ''}
        ${dragDocId === doc.id ? 'opacity-50' : ''}
      `}
    >
      <td className="px-4 py-3 w-10 flex-shrink-0">
        <input
          type="checkbox"
          checked={selectedRows.includes(doc.id)}
          onChange={() => toggleSelectRow(doc.id)}
          className="rounded border-border accent-primary cursor-pointer w-4 h-4"
        />
      </td>
      <td className="px-3 py-3 min-w-[200px]">
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
            doc.estado === 'Rechazado' ? 'bg-red-50 border border-red-200' :
            doc.estado === 'Completado' ? 'bg-green-50 border border-green-200' :
            doc.estado === 'En proceso' ? 'bg-blue-50 border border-blue-200' :
            doc.estado === 'En espera' ? 'bg-orange-50 border border-orange-200' :
            doc.estado === 'Cancelado'? 'bg-slate-50 border border-slate-200' : 'bg-gray-50 border border-gray-200'
          }`}>
            <FileText size={16} className={getDocIconColor(doc.estado)} />
          </div>
          <div className="flex flex-col min-w-0">
            <button
              onClick={() => doc.isDraft ? router.push(`/crear-documento?draft=${doc.id}`) : router.push(`/visor-documento/${doc.id}`)}
              className="text-xs font-medium text-foreground hover:text-primary transition-colors text-left flex items-center gap-1"
              title={doc.name}
            >
              {doc.isFavorite && <Star size={11} className="text-yellow-400 fill-yellow-400 flex-shrink-0" />}
              {doc.esUrgente && <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0 inline-block" title="Urgente" />}
              <span>{doc.name}</span>
            </button>
            {doc.descripcion ? (
              <span className="text-xs text-muted-foreground">{doc.descripcion}</span>
            ) : (
              <div className="flex items-center gap-1.5 mt-0.5">
                {doc.isDraft && <span className="text-xs text-muted-foreground">Borrador</span>}
                {doc.esUrgente && <span className="text-xs text-red-500 font-medium">Urgente</span>}
              </div>
            )}
          </div>
        </div>
      </td>
      {cols.find((c) => c.id === 'propietario')?.visible && (
        <td className="px-3 py-3 min-w-[100px]"><span className="text-xs text-muted-foreground" title={ownerName}>{ownerName}</span></td>
      )}
      {cols.find((c) => c.id === 'ultimaModificacion')?.visible && (
        <td className="px-3 py-3 min-w-[160px]"><span className="text-xs text-muted-foreground">{doc.ultimaModificacion}</span></td>
      )}
      {cols.find((c) => c.id === 'tamano')?.visible && (
        <td className="px-3 py-3 min-w-[80px]"><span className="text-xs text-muted-foreground">{doc.tamano}</span></td>
      )}
      {cols.find((c) => c.id === 'estado')?.visible && (
        <td className="px-3 py-3 min-w-[120px]">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusDot(doc.estado)}`} />
            <span className="text-xs text-muted-foreground">{doc.estado}</span>
          </div>
        </td>
      )}
      {cols.find((c) => c.id === 'estadoParticipacion')?.visible && (
        <td className="px-3 py-3 min-w-[180px]">
          {doc.miSubEstado ? (
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getParticipacionDot(doc.miSubEstado)}`} />
              <span className="text-xs text-muted-foreground">{getParticipacionLabel(doc.miSubEstado)}</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground italic">Ninguna</span>
          )}
        </td>
      )}
      {cols.find((c) => c.id === 'etiquetas')?.visible && (
        <td className="px-3 py-3 min-w-[120px]">
          <div className="flex flex-wrap gap-1">
            {doc.etiquetas.length > 0
              ? doc.etiquetas.slice(0, 2).map((tagId, i) => {
                  const etiqueta = etiquetasList.find((e) => e.id === String(tagId) || e.nombre === String(tagId));
                  const label = etiqueta ? etiqueta.nombre : String(tagId);
                  const color = etiqueta?.color || '#6366f1';
                  return (
                    <span
                      key={i}
                      className="px-1.5 py-0.5 text-xs rounded-full font-medium"
                      style={{ backgroundColor: `${color}20`, color, border: `1px solid ${color}40` }}
                    >
                      {label}
                    </span>
                  );
                })
              : <span className="text-sm text-muted-foreground">—</span>
            }
            {doc.etiquetas.length > 2 && <span className="text-xs text-muted-foreground">+{doc.etiquetas.length - 2}</span>}
          </div>
        </td>
      )}
      {cols.find((c) => c.id === 'numeroDocumento')?.visible && (
        <td className="px-3 py-3 min-w-[100px]"><span className="text-xs text-muted-foreground">{doc.numeroOficio || '—'}</span></td>
      )}
      {cols.find((c) => c.id === 'folioInterno')?.visible && (
        <td className="px-3 py-3 min-w-[90px]"><span className="text-xs text-muted-foreground">{doc.folioInterno || '—'}</span></td>
      )}
      {cols.find((c) => c.id === 'fechaCreacion')?.visible && (
        <td className="px-3 py-3 min-w-[130px]"><span className="text-xs text-muted-foreground">{doc.fechaCreacion || '—'}</span></td>
      )}
      {cols.find((c) => c.id === 'fechaCompletado')?.visible && (
        <td className="px-3 py-3 min-w-[130px]"><span className="text-xs text-muted-foreground">{doc.fechaCompletado || '—'}</span></td>
      )}
      {cols.find((c) => c.id === 'fechaVencimiento')?.visible && (
        <td className="px-3 py-3 min-w-[120px]">
          <span className={`text-xs ${doc.fechaVencimiento ? 'text-orange-600 font-medium' : 'text-muted-foreground'}`}>
            {doc.fechaVencimiento ? formatDate(doc.fechaVencimiento) : '—'}
          </span>
        </td>
      )}
      {cols.find((c) => c.id === 'rutaGuardado')?.visible && (
        <td className="px-3 py-3 min-w-[120px]"><span className="text-xs text-muted-foreground truncate max-w-[120px] block">{doc.rutaGuardado || '—'}</span></td>
      )}
      {cols.find((c) => c.id === 'tipoDocumento')?.visible && (
        <td className="px-3 py-3 min-w-[100px]"><span className="text-xs text-muted-foreground">{doc.tipoDocumentoNombre || '—'}</span></td>
      )}
      {cols.find((c) => c.id === 'prioridad')?.visible && (
        <td className="px-3 py-3 min-w-[90px]">
          {doc.esUrgente
            ? <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-600">Urgente</span>
            : <span className="text-xs text-muted-foreground">Normal</span>
          }
        </td>
      )}
      <td className="sticky right-0 bg-white px-3 py-3 border-l border-border shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.06)] w-10">
        <button
          onClick={(e) => openContextMenu(e, doc)}
          className={`p-1.5 rounded hover:bg-muted transition-colors ${activeContextMenuDocId === doc.id && contextMenu.open ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`}
          title="Opciones"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
        </button>
      </td>
    </tr>
    );
  };

  // ---- Folder context menu ----
  const renderFolderContextMenu = () => folderContextMenu.open ? (
    <div
      ref={folderContextMenuRef}
      className="fixed z-[300] bg-white border border-border rounded-xl shadow-xl py-1 min-w-[180px]"
      style={{ top: Math.min(folderContextMenu.y + 4, window.innerHeight - 200), left: Math.max(folderContextMenu.x - 180, 8) }}
    >
      <button onClick={handleFolderMenuVer} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left">
        <Eye size={15} className="text-muted-foreground" />Ver carpeta
      </button>
      <button onClick={handleFolderMenuMover} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left">
        <Move size={15} className="text-muted-foreground" />Mover
      </button>
      <button onClick={handleFolderMenuRenombrar} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Renombrar
      </button>
      <div className="border-t border-border my-1" />
      <button onClick={handleFolderMenuPapelera} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors text-left">
        <Trash2 size={15} className="text-red-500" />Mover a papelera
      </button>
    </div>
  ) : null;

  // ---- Document context menu (for documents) ----
  const renderDocContextMenu = () => contextMenu.open ? (
    <div
      ref={contextMenuRef}
      className="fixed z-[300] bg-white border border-border rounded-xl shadow-xl py-1 min-w-[180px]"
      style={{ top: Math.min(contextMenu.y + 4, window.innerHeight - 320), left: Math.max(contextMenu.x - 180, 8) }}
    >
      <button onClick={handleMenuAbrir} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left">
        <Eye size={15} className="text-muted-foreground" />{contextMenu.isDraft ? 'Continuar borrador' : 'Ver documento'}
      </button>
      <button onClick={handleMenuMover} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left">
        <Move size={15} className="text-muted-foreground" />Mover
      </button>
      <button onClick={handleMenuRenombrar} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Renombrar
      </button>
      <button onClick={handleMenuFavoritos} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left">
        <Star size={15} className={contextMenu.isFavorite ? 'text-yellow-400 fill-yellow-400' : 'text-muted-foreground'} />
        {contextMenu.isFavorite ? 'Quitar de Favoritos' : 'Añadir a Favoritos'}
      </button>
      <button onClick={handleMenuDescargar} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left">
        <Download size={15} className="text-muted-foreground" />
        Descargar
      </button>
      <button onClick={handleMenuCompartir} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left">
        <Share2 size={15} className="text-muted-foreground" />Compartir
      </button>
      <div className="border-t border-border my-1" />
      <button onClick={handleMenuConfidencial} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left">
        <Lock size={15} className="text-muted-foreground" />Modo Confidencial
      </button>
      <div className="border-t border-border my-1" />
      <button onClick={handleMenuPapelera} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors text-left">
        <Trash2 size={15} className="text-red-500" />Mover a papelera
      </button>
    </div>
  ) : null;

  // Rename document handler
  const handleSaveRename = async () => {
    const nombre = renameModal.newName.trim();
    if (!nombre || !renameModal.docId || !user) return;
    const supabase = createClient();
    const { error } = await supabase.from('documentos').update({ nombre }).eq('id', renameModal.docId).eq('owner_id', user.id);
    if (error) { showToast('Error al renombrar el documento'); return; }
    setRealDocuments((prev) => prev.map((d) => d.id === renameModal.docId ? { ...d, name: nombre } : d));
    setRenameModal({ open: false, docId: null, currentName: '', newName: '' });
    showToast(`Documento renombrado a "${nombre}"`);
  };

  const getCustomFilterDocuments = (cf: CustomFilter): Document[] => {
    return realDocuments.filter((doc) => {
      const filtros = cf.filtros || {};
      if (filtros['estado'] && doc.estado !== filtros['estado']) return false;
      if (filtros['tipoDocumento'] && Array.isArray(filtros['tipoDocumento']) && filtros['tipoDocumento'].length > 0) {
        if (!doc.tipoDocumentoId || !filtros['tipoDocumento'].includes(doc.tipoDocumentoId)) return false;
      }
      if (filtros['etiquetas'] && Array.isArray(filtros['etiquetas']) && filtros['etiquetas'].length > 0) {
        const hasMatch = doc.etiquetas.some((t) => filtros['etiquetas'].includes(String(t)));
        if (!hasMatch) return false;
      }
      if (filtros['prioridad']) {
        if (filtros['prioridad'] === 'urgente' && !doc.esUrgente) return false;
        if (filtros['prioridad'] === 'normal' && doc.esUrgente) return false;
      }
      if (filtros['fechaUltimaModificacion'] && filtros['fechaUltimaModificacion'] !== '') {
        const now = new Date();
        const range = filtros['fechaUltimaModificacion'];
        const docDate = doc.ultimaModificacion !== '—' ? new Date(doc.ultimaModificacion.split('/').reverse().join('-')) : null;
        if (docDate) {
          if (range === 'today') { const t = new Date(); t.setHours(0,0,0,0); if (docDate < t) return false; }
          else if (range === 'week') { if (docDate < new Date(now.getTime() - 7*24*60*60*1000)) return false; }
          else if (range === 'month') { if (docDate < new Date(now.getTime() - 30*24*60*60*1000)) return false; }
          else if (range === 'year') { if (docDate < new Date(now.getTime() - 365*24*60*60*1000)) return false; }
        }
      }
      if (filtros['fechaCreacion'] && filtros['fechaCreacion'] !== '') {
        const now = new Date();
        const range = filtros['fechaCreacion'];
        if (doc.fechaCreacion) {
          let d = new Date(doc.fechaCreacion.split('/').reverse().join('-'));
          if (range === 'today') { const t = new Date(); t.setHours(0,0,0,0); if (d < t) return false; }
          else if (range === 'week') { if (d < new Date(now.getTime() - 7*24*60*60*1000)) return false; }
          else if (range === 'month') { if (d < new Date(now.getTime() - 30*24*60*60*1000)) return false; }
          else if (range === 'year') { if (d < new Date(now.getTime() - 365*24*60*60*1000)) return false; }
        } else { return false; }
      }
      if (filtros['fechaVencimiento'] && filtros['fechaVencimiento'] !== '') {
        const fv = filtros['fechaVencimiento'];
        const now = new Date();
        if (fv === 'vencido') { if (!doc.fechaVencimiento || new Date(doc.fechaVencimiento) >= now) return false; }
        else if (fv === 'proximos') { const in72h = new Date(now.getTime() + 72*60*60*1000); if (!doc.fechaVencimiento || new Date(doc.fechaVencimiento) < now || new Date(doc.fechaVencimiento) > in72h) return false; }
        else if (fv === 'sin_vencimiento') { if (doc.fechaVencimiento) return false; }
      }
      if (filtros['fechaCompletado'] && filtros['fechaCompletado'] !== '') {
        const range = filtros['fechaCompletado'];
        const now = new Date();
        if (doc.fechaCompletado) {
          let d = new Date(doc.fechaCompletado.split('/').reverse().join('-'));
          if (range === 'sin_completado') { if (doc.fechaCompletado) return false; }
          else if (range === 'today') { const t = new Date(); t.setHours(0,0,0,0); if (d < t) return false; }
          else if (range === 'week') { if (d < new Date(now.getTime() - 7*24*60*60*1000)) return false; }
          else if (range === 'month') { if (d < new Date(now.getTime() - 30*24*60*60*1000)) return false; }
        } else { if (range !== 'sin_completado') return false; }
      }
      if (filtros['participantes'] && filtros['participantes'] !== '' && filtros['participantes'] !== 'todos') {
        const parts: any[] = doc.participantes || [];
        if (filtros['participantes'] === 'yo') {
          const isParticipant = parts.some((p) => { const pid = p.id || p.user_id || p.userId; const pemail = p.email || ''; return pid === user?.id || pemail === user?.email; });
          if (!isParticipant) return false;
        }
      }
      if (filtros['propietario'] && filtros['propietario'] !== '' && filtros['propietario'] !== 'todos') {
        if (filtros['propietario'] === 'mios') { /* all docs are already owner's */ }
      }
      return true;
    });
  };

  const renderMiEspacioContent = () => {
    // Sort visible documents - now uses component-level sortedDocuments
    const visibleFilters = filterConfig.filter((f) => f.visible);

    // Helper: get display label for an active filter value
    const getFilterLabel = (filterId: string, value: any): string => {
      if (!value || value === '') return '';
      switch (filterId) {
        case 'estructura': return value === 'carpeta' ? 'Carpetas' : value === 'archivo' ? 'Archivos' : '';
        case 'estado': return value;
        case 'propietario':
          if (value === 'mios') return 'Míos';
          if (Array.isArray(value) && value.length > 0) {
            const u = workspaceUsers.find((x) => x.id === value[0]);
            return u ? u.full_name || u.email : `${value.length} propietario(s)`;
          }
          return '';
        case 'ultimaModificacion': case'fechaCreacion': case'fechaCompletado':
          if (value === 'today') return 'Hoy';
          if (value === 'week') return 'Últimos 7 días';
          if (value === 'month') return 'Últimos 30 días';
          if (value === 'year') return 'Último año';
          if (value === 'custom') {
            const cr = customDateRanges[filterId];
            if (cr?.start && cr?.end) return `${cr.start.toLocaleDateString('es-MX')} – ${cr.end.toLocaleDateString('es-MX')}`;
            return 'Rango personalizado';
          }
          if (value === 'sin_completado') return 'Sin completar';
          return value;
        case 'fechaVencimiento':
          if (value === 'vencido') return 'Vencido';
          if (value === 'proximos') return 'Próximos 72h';
          if (value === 'sin_vencimiento') return 'Sin vencimiento';
          return value;
        case 'tipoDocumento':
          if (Array.isArray(value) && value.length > 0) {
            if (value.length === 1) {
              const t = tiposDocumento.find((x) => x.id === value[0]);
              return t ? t.nombre : '1 tipo';
            }
            return `${value.length} tipos`;
          }
          return '';
        case 'etiquetas':
          if (Array.isArray(value) && value.length > 0) {
            return value.length === 1 ? value[0] : `${value.length} etiquetas`;
          }
          return '';
        case 'participantes':
          if (value === 'yo') return 'Yo';
          if (Array.isArray(value) && value.length > 0) {
            const u = participantUsers.find((x) => x.id === value[0]);
            return u ? u.full_name || u.email : `${value.length} participante(s)`;
          }
          return '';
        case 'prioridad':
          if (value === 'urgente') return 'Urgente';
          if (value === 'normal') return 'Normal';
          return value;
        default: return String(value);
      }
    };

    // Render dropdown content for each filter
    const renderFilterDropdown = (filterId: string) => {
      switch (filterId) {
        case 'estructura':
          return (
            <div className="py-1 min-w-[160px]">
              {[{ value: '', label: 'Todos' }, { value: 'archivo', label: 'Archivos' }, { value: 'carpeta', label: 'Carpetas' }].map((opt) => (
                <button key={opt.value} onClick={() => { setActiveFilters((prev) => ({ ...prev, estructura: opt.value })); setOpenFilterDropdown(null); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${activeFilters['estructura'] === opt.value ? 'text-primary font-medium' : 'text-foreground'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          );
        case 'estado':
          return (
            <div className="py-1 min-w-[160px]">
              {[{ value: '', label: 'Todos' }, { value: 'Borrador', label: 'Borrador' }, { value: 'En proceso', label: 'En proceso' }, { value: 'En espera', label: 'En espera' }, { value: 'Completado', label: 'Completado' }, { value: 'Rechazado', label: 'Rechazado' }, { value: 'Cancelado', label: 'Cancelado' }, { value: 'Vencido', label: 'Vencido' }].map((opt) => (
                <button key={opt.value} onClick={() => { setActiveFilters((prev) => ({ ...prev, estado: opt.value })); setOpenFilterDropdown(null); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2 ${activeFilters['estado'] === opt.value ? 'text-primary font-medium' : 'text-foreground'}`}>
                  {opt.value && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${opt.value === 'Vencido' ? 'bg-red-800' : getStatusDot(opt.value)}`} />}
                  {opt.label}
                </button>
              ))}
            </div>
          );
        case 'propietario':
          return (
            <div className="py-1 min-w-[200px]">
              <div className="px-3 py-2">
                <input type="text" placeholder="Buscar propietario..." value={propietarioSearch} onChange={(e) => setPropietarioSearch(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
              <button onClick={() => { setActiveFilters((prev) => ({ ...prev, propietario: '' })); setOpenFilterDropdown(null); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${!activeFilters['propietario'] ? 'text-primary font-medium' : 'text-foreground'}`}>
                Todos
              </button>
              <button onClick={() => { setActiveFilters((prev) => ({ ...prev, propietario: 'mios' })); setOpenFilterDropdown(null); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${activeFilters['propietario'] === 'mios' ? 'text-primary font-medium' : 'text-foreground'}`}>
                Míos
              </button>
              <div className="max-h-40 overflow-y-auto">
                {loadingPropietarios ? <div className="px-3 py-2 text-xs text-muted-foreground">Cargando...</div> :
                  workspaceUsers.filter((u) => !propietarioSearch || (u.full_name || u.email || '').toLowerCase().includes(propietarioSearch.toLowerCase())).map((u) => (
                    <button key={u.id} onClick={() => { setActiveFilters((prev) => ({ ...prev, propietario: [u.id] })); setOpenFilterDropdown(null); }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors truncate ${Array.isArray(activeFilters['propietario']) && activeFilters['propietario'].includes(u.id) ? 'text-primary font-medium' : 'text-foreground'}`}>
                      {u.full_name || u.email}
                    </button>
                  ))
                }
              </div>
            </div>
          );
        case 'ultimaModificacion':
        case 'fechaCreacion':
          return showDateRangePicker === filterId ? (
            <div className="p-3">
              <DateRangePicker
                value={customDateRanges[filterId] || { start: null, end: null }}
                onChange={(range) => { setCustomDateRanges((prev) => ({ ...prev, [filterId]: range })); setActiveFilters((prev) => ({ ...prev, [filterId]: 'custom' })); setShowDateRangePicker(null); setOpenFilterDropdown(null); }}
                onBack={() => setShowDateRangePicker(null)}
              />
            </div>
          ) : (
            <div className="py-1 min-w-[180px]">
              {[{ value: '', label: 'Cualquier fecha' }, { value: 'today', label: 'Hoy' }, { value: 'week', label: 'Últimos 7 días' }, { value: 'month', label: 'Últimos 30 días' }, { value: 'year', label: 'Último año' }, { value: 'custom', label: 'Rango personalizado...' }].map((opt) => (
                <button key={opt.value} onClick={() => {
                  if (opt.value === 'custom') { setShowDateRangePicker(filterId); return; }
                  setActiveFilters((prev) => ({ ...prev, [filterId]: opt.value }));
                  setOpenFilterDropdown(null);
                }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${activeFilters[filterId] === opt.value ? 'text-primary font-medium' : 'text-foreground'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          );
        case 'fechaCompletado':
          return (
            <div className="py-1 min-w-[180px]">
              {[{ value: '', label: 'Cualquier fecha' }, { value: 'sin_completado', label: 'Sin completado' }, { value: 'today', label: 'Hoy' }, { value: 'week', label: 'Últimos 7 días' }, { value: 'month', label: 'Últimos 30 días' }].map((opt) => (
                <button key={opt.value} onClick={() => { setActiveFilters((prev) => ({ ...prev, fechaCompletado: opt.value })); setOpenFilterDropdown(null); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${activeFilters['fechaCompletado'] === opt.value ? 'text-primary font-medium' : 'text-foreground'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          );
        case 'fechaVencimiento':
          return (
            <div className="py-1 min-w-[180px]">
              {[{ value: '', label: 'Todos' }, { value: 'vencido', label: 'Vencido' }, { value: 'proximos', label: 'Próximos 72h' }, { value: 'sin_vencimiento', label: 'Sin vencimiento' }].map((opt) => (
                <button key={opt.value} onClick={() => { setActiveFilters((prev) => ({ ...prev, fechaVencimiento: opt.value })); setOpenFilterDropdown(null); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${activeFilters['fechaVencimiento'] === opt.value ? 'text-primary font-medium' : 'text-foreground'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          );
        case 'tipoDocumento':
          return (
            <div className="py-1 min-w-[200px]">
              <div className="px-3 py-2">
                <input type="text" placeholder="Buscar tipo..." value={tipoDocSearch} onChange={(e) => setTipoDocSearch(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors" />
              </div>
              <button onClick={() => { setActiveFilters((prev) => ({ ...prev, tipoDocumento: [] })); setOpenFilterDropdown(null); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${(!activeFilters['tipoDocumento'] || activeFilters['tipoDocumento'].length === 0) ? 'text-primary font-medium' : 'text-foreground'}`}>
                Todos
              </button>
              <div className="max-h-48 overflow-y-auto">
                {loadingTipos ? <div className="px-3 py-2 text-xs text-muted-foreground">Cargando...</div> :
                  <>
                    {tiposDocumento.filter((t) => !tipoDocSearch || t.nombre.toLowerCase().includes(tipoDocSearch.toLowerCase())).map((t) => {
                      const selected: string[] = activeFilters['tipoDocumento'] || [];
                      const isSelected = selected.includes(t.id);
                      return (
                        <button key={t.id} onClick={() => {
                          const updated = isSelected ? selected.filter((x) => x !== t.id) : [...selected, t.id];
                          setActiveFilters((prev) => ({ ...prev, tipoDocumento: updated }));
                        }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2 ${isSelected ? 'text-primary font-medium' : 'text-foreground'}`}>
                          <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${isSelected ? 'bg-primary border-primary' : 'border-border'}`}>
                            {isSelected && <svg width="8" height="8" viewBox="0 0 12 12" fill="white"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          </span>
                          {t.nombre}
                        </button>
                      );
                    })}
                    {(!tipoDocSearch || 'otro'.includes(tipoDocSearch.toLowerCase())) && (() => {
                      const selected: string[] = activeFilters['tipoDocumento'] || [];
                      const isSelected = selected.includes('__otros__');
                      return (
                        <button key="__otros__" onClick={() => {
                          const updated = isSelected ? selected.filter((x) => x !== '__otros__') : [...selected, '__otros__'];
                          setActiveFilters((prev) => ({ ...prev, tipoDocumento: updated }));
                        }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2 italic ${isSelected ? 'text-primary font-medium' : 'text-foreground'}`}>
                          <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${isSelected ? 'bg-primary border-primary' : 'border-border'}`}>
                            {isSelected && <svg width="8" height="8" viewBox="0 0 12 12" fill="white"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          </span>
                          Otro
                        </button>
                      );
                    })()}
                  </>
                }
              </div>
              {Array.isArray(activeFilters['tipoDocumento']) && activeFilters['tipoDocumento'].length > 0 && (
                <div className="border-t border-border px-3 py-2">
                  <button onClick={() => setOpenFilterDropdown(null)} className="w-full text-xs font-semibold text-primary text-center py-1 hover:underline">Aplicar</button>
                </div>
              )}
            </div>
          );
        case 'etiquetas':
          return (
            <div className="py-1 min-w-[200px]">
              <div className="px-3 py-2">
                <input type="text" placeholder="Buscar etiqueta..." value={etiquetasSearch} onChange={(e) => setEtiquetasSearch(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
              <button onClick={() => { setActiveFilters((prev) => ({ ...prev, etiquetas: [] })); setOpenFilterDropdown(null); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${(!activeFilters['etiquetas'] || activeFilters['etiquetas'].length === 0) ? 'text-primary font-medium' : 'text-foreground'}`}>
                Todas
              </button>
              <div className="max-h-48 overflow-y-auto">
                {loadingEtiquetas ? <div className="px-3 py-2 text-xs text-muted-foreground">Cargando...</div> :
                  etiquetasList.filter((et) => !etiquetasSearch || et.nombre.toLowerCase().includes(etiquetasSearch.toLowerCase())).map((et) => {
                    const selected: string[] = activeFilters['etiquetas'] || [];
                    const isSelected = selected.includes(et.nombre);
                    return (
                      <button key={et.id} onClick={() => {
                        const updated = isSelected ? selected.filter((x) => x !== et.nombre) : [...selected, et.nombre];
                        setActiveFilters((prev) => ({ ...prev, etiquetas: updated }));
                      }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2 ${isSelected ? 'text-primary font-medium' : 'text-foreground'}`}>
                        <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${isSelected ? 'bg-primary border-primary' : 'border-border'}`}>
                          {isSelected && <svg width="8" height="8" viewBox="0 0 12 12" fill="white"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </span>
                        {et.nombre}
                      </button>
                    );
                  })
                }
              </div>
            </div>
          );
        case 'participantes':
          return (
            <div className="py-1 min-w-[200px]">
              <div className="px-3 py-2">
                <input type="text" placeholder="Buscar participante..." value={participantesSearch} onChange={(e) => setParticipantesSearch(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
              {[{ value: '', label: 'Todos' }, { value: 'yo', label: 'Yo' }].map((opt) => (
                <button key={opt.value} onClick={() => { setActiveFilters((prev) => ({ ...prev, participantes: opt.value })); setOpenFilterDropdown(null); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${activeFilters['participantes'] === opt.value ? 'text-primary font-medium' : 'text-foreground'}`}>
                  {opt.label}
                </button>
              ))}
              <div className="max-h-40 overflow-y-auto">
                {loadingParticipantes ? <div className="px-3 py-2 text-xs text-muted-foreground">Cargando...</div> :
                  participantUsers.filter((u) => !participantesSearch || (u.full_name || u.email || '').toLowerCase().includes(participantesSearch.toLowerCase())).map((u) => (
                    <button key={u.id} onClick={() => { setActiveFilters((prev) => ({ ...prev, participantes: [u.id] })); setOpenFilterDropdown(null); }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors truncate ${Array.isArray(activeFilters['participantes']) && activeFilters['participantes'].includes(u.id) ? 'text-primary font-medium' : 'text-foreground'}`}>
                      {u.full_name || u.email}
                    </button>
                  ))
                }
              </div>
            </div>
          );
        case 'prioridad':
          return (
            <div className="py-1 min-w-[160px]">
              {[{ value: '', label: 'Todas' }, { value: 'urgente', label: 'Urgente' }, { value: 'normal', label: 'Normal' }].map((opt) => (
                <button key={opt.value} onClick={() => { setActiveFilters((prev) => ({ ...prev, prioridad: opt.value })); setOpenFilterDropdown(null); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${activeFilters['prioridad'] === opt.value ? 'text-primary font-medium' : 'text-foreground'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          );
        case 'estadoParticipacion':
          return (
            <div className="py-1 min-w-[200px]">
              {[
                { value: '', label: 'Todos', dot: '' },
                { value: 'ninguna', label: 'Ninguna (sin participación)', dot: 'bg-gray-300' },
                { value: 'sin_revisar', label: 'Sin revisar', dot: 'bg-amber-400' },
                { value: 'en_revision', label: 'En revisión', dot: 'bg-cyan-500' },
                { value: 'firmo', label: 'Firmado', dot: 'bg-green-500' },
                { value: 'rechazo', label: 'Rechazado', dot: 'bg-red-500' },
                { value: 'aprobo', label: 'Aprobado', dot: 'bg-blue-500' },
                { value: 'cancelo', label: 'Cancelado', dot: 'bg-slate-400' },
                { value: 'urgente_atencion', label: 'Urgente atención', dot: 'bg-orange-500' },
                { value: 'participacion_vencida', label: 'Participación vencida', dot: 'bg-red-800' },
              ].map((opt) => (
                <button key={opt.value} onClick={() => { setActiveFilters((prev) => ({ ...prev, estadoParticipacion: opt.value })); setOpenFilterDropdown(null); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2 ${activeFilters['estadoParticipacion'] === opt.value ? 'text-primary font-medium' : 'text-foreground'}`}>
                  {opt.dot && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${opt.dot}`} />}
                  {!opt.dot && <span className="w-2 h-2 flex-shrink-0" />}
                  {opt.label}
                </button>
              ))}
            </div>
          );
        default:
          return null;
      }
    };
    const activeFilterCount = Object.entries(activeFilters).filter(([, v]) => {
      if (!v || v === '') return false;
      if (Array.isArray(v) && v.length === 0) return false;
      return true;
    }).length;

    return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileText size={24} className="text-primary" />
            Mi Espacio
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Espacio de trabajo de: <span className="font-medium text-foreground">{isPersonalWorkspace ? personalUserFullName : workspaceDisplayName}</span></p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCarpetaModal(true)} className="flex items-center gap-2 bg-white text-foreground border border-border px-4 py-2 rounded-lg text-sm font-semibold hover:bg-muted transition-colors">
            <FolderPlus size={16} className="text-primary" />Crear Carpeta
          </button>
          <button onClick={() => router.push('/crear-documento')} className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors">
            <FilePlus size={16} />Crear Documento
          </button>
        </div>
      </div>
      {folderBreadcrumb.length > 0 && (
        <div className="flex items-center gap-1 mb-4 text-sm text-muted-foreground flex-wrap">
          <button onClick={() => handleBreadcrumbNav(-1)} className="hover:text-primary transition-colors">Mi Espacio</button>
          {folderBreadcrumb.map((crumb, idx) => (
            <React.Fragment key={crumb.id}>
              <ChevronRight size={14} />
              <button
                onClick={() => handleBreadcrumbNav(idx)}
                className={`hover:text-primary transition-colors ${idx === folderBreadcrumb.length - 1 ? 'text-foreground font-medium' : ''}`}
              >
                {crumb.name}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
      {/* Toolbar row */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="flex-1 relative min-w-[160px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="text" placeholder="Buscar documentos..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-9 pr-4 py-2 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors" />
        </div>
        <div className="relative" ref={miEspacioSortDropdownRef}>
          <button
            onClick={() => setMiEspacioSortDropdownOpen((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-border rounded-lg bg-white hover:bg-muted transition-colors text-foreground"
          >
            <ArrowUpDown size={14} />
            <span>Ordenar</span>
          </button>
          {miEspacioSortDropdownOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-border rounded-lg shadow-lg min-w-[160px] py-1">
              {[
                { value: 'ultimaModificacion_desc', label: 'Más reciente' },
                { value: 'ultimaModificacion_asc', label: 'Más antiguo' },
                { value: 'nombre_asc', label: 'Nombre A–Z' },
                { value: 'nombre_desc', label: 'Nombre Z–A' },
                { value: 'estado_asc', label: 'Estado' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { setMiEspacioSortOrder(opt.value); setMiEspacioSortDropdownOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-muted ${miEspacioSortOrder === opt.value ? 'text-primary font-medium' : 'text-foreground'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center border border-border rounded-lg overflow-hidden bg-white">
          <button onClick={() => setViewMode('list')} className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-muted text-foreground' : 'bg-white text-muted-foreground hover:bg-muted'}`} title="Vista lista">
            <LayoutList size={16} />
          </button>
          <button onClick={() => setViewMode('grid')} className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-muted text-foreground' : 'bg-white text-muted-foreground hover:bg-muted'}`} title="Vista cuadrícula">
            <LayoutGrid size={16} />
          </button>
        </div>
        <button
          onClick={() => setPersonalizarOpen(true)}
          className="p-2 border border-border rounded-lg bg-white hover:bg-muted transition-colors text-muted-foreground"
          title="Personalizar vista"
        >
          <SlidersHorizontal size={16} />
        </button>
        <button
          onClick={() => setIsFullscreen((v) => !v)}
          className="p-2 border border-border rounded-lg bg-white hover:bg-muted transition-colors text-muted-foreground"
          title={isFullscreen ? 'Salir de vista amplia' : 'Vista amplia'}
        >
          {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>

      {/* Filter bar row */}
      {visibleFilters.length > 0 && (
        <div className="flex items-center gap-2 mb-3 flex-wrap" ref={filterDropdownRef}>
          {visibleFilters.map((f) => {
            const hasValue = activeFilters[f.id] && (Array.isArray(activeFilters[f.id]) ? activeFilters[f.id].length > 0 : activeFilters[f.id] !== '');
            return (
              <div key={f.id} className="relative">
                <button
                  onClick={() => setOpenFilterDropdown(openFilterDropdown === f.id ? null : f.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg transition-colors ${hasValue ? 'border-primary bg-primary/10 text-primary font-semibold' : 'border-border bg-white text-foreground hover:bg-muted'}`}
                >
                  {f.label}
                  {hasValue && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
                </button>
                {openFilterDropdown === f.id && (
                  <div className="absolute top-full left-0 mt-1 z-[200] bg-white border border-border rounded-xl shadow-xl overflow-hidden">
                    {renderFilterDropdown(f.id)}
                  </div>
                )}
              </div>
            );
          })}
          {Object.values(activeFilters).some((v) => v && (Array.isArray(v) ? v.length > 0 : v !== '')) && (
            <button
              onClick={() => setActiveFilters({})}
              className="flex items-center gap-1 px-2 py-1.5 text-sm text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
            >
              <X size={11} />Limpiar filtros
            </button>
          )}
        </div>
      )}

      {/* Main content: list or grid */}
      {viewMode === 'grid' ? (
        <div className="p-1">
          {/* Selection bar when items are checked in grid view */}
          {(selectedRows.length > 0 || selectedFolders.length > 0) && (
            <div className="flex items-center justify-between bg-muted/60 border border-border rounded-xl px-4 py-3 mb-3">
              <span className="text-sm font-medium text-foreground">
                {selectedRows.length + selectedFolders.length} elemento(s) seleccionado(s)
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (selectedRows.length > 0) {
                      setMoveModal({ open: true, docId: null, docName: '', isBulk: true });
                    }
                  }}
                  disabled={selectedRows.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-foreground border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Move size={14} />Mover a...
                </button>
                <button
                  onClick={() => {
                    if (selectedRows.length > 0) {
                      handleBulkPapelera();
                    }
                  }}
                  disabled={selectedRows.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 size={14} />Mover a la papelera
                </button>
              </div>
            </div>
          )}
          {loadingDocs ? (
            <div className="flex items-center justify-center py-16 gap-3">
              <svg className="animate-spin h-5 w-5 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              <span className="text-sm text-muted-foreground">Cargando documentos...</span>
            </div>
          ) : (visibleCarpetas.length === 0 && sortedDocuments.length === 0) ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              {searchQuery ? 'No se encontraron documentos.' : 'No hay documentos en este espacio aún.'}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {visibleCarpetas.map(renderFolderGridCard)}
              {sortedDocuments.map(renderDocGridCard)}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          {/* Selection action bar for list view */}
          {(selectedRows.length > 0 || selectedFolders.length > 0) && (
            <div className="flex items-center justify-between bg-muted/60 border-b border-border px-4 py-3">
              <span className="text-sm font-medium text-foreground">
                {selectedRows.length + selectedFolders.length} elemento(s) seleccionado(s)
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setSelectedRows([]); setSelectedFolders([]); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
                >
                  <X size={14} />Deseleccionar
                </button>
                <button
                  onClick={() => {
                    if (selectedRows.length > 0) {
                      setMoveModal({ open: true, docId: null, docName: '', isBulk: true });
                    }
                  }}
                  disabled={selectedRows.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-foreground border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Move size={14} />Mover a...
                </button>
                <button
                  onClick={() => {
                    if (selectedRows.length > 0) {
                      handleBulkPapelera();
                    }
                  }}
                  disabled={selectedRows.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 size={14} />Mover a la papelera
                </button>
              </div>
            </div>
          )}
          {loadingDocs ? (
            <div className="flex items-center justify-center py-16 gap-3">
              <svg className="animate-spin h-5 w-5 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              <span className="text-sm text-muted-foreground">Cargando documentos...</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-3 py-3" style={{ width: `${mainColWidths.checkbox}px` }}>
                      <input
                        type="checkbox"
                        checked={selectedRows.length === sortedDocuments.length && selectedFolders.length === visibleCarpetas.length && (sortedDocuments.length + visibleCarpetas.length) > 0}
                        onChange={toggleSelectAll}
                        className="rounded border-border accent-primary cursor-pointer"
                      />
                    </th>
                    <ResizableTh colKey="nombre" width={mainColWidths.nombre} minWidth={120} onResize={resizeMainCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3">Nombre</ResizableTh>
                    {columnConfig.filter((c) => c.visible).find((c) => c.id === 'propietario') && <ResizableTh colKey="propietario" width={mainColWidths.propietario} minWidth={80} onResize={resizeMainCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Propietario</ResizableTh>}
                    {columnConfig.filter((c) => c.visible).find((c) => c.id === 'ultimaModificacion') && <ResizableTh colKey="ultimaModificacion" width={mainColWidths.ultimaModificacion} minWidth={120} onResize={resizeMainCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Última modificación</ResizableTh>}
                    {columnConfig.filter((c) => c.visible).find((c) => c.id === 'tamano') && <ResizableTh colKey="tamano" width={mainColWidths.tamano} minWidth={60} onResize={resizeMainCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Tamaño</ResizableTh>}
                    {columnConfig.filter((c) => c.visible).find((c) => c.id === 'estado') && <ResizableTh colKey="estado" width={mainColWidths.estado} minWidth={80} onResize={resizeMainCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Estado</ResizableTh>}
                    {columnConfig.filter((c) => c.visible).find((c) => c.id === 'estadoParticipacion') && <ResizableTh colKey="estadoParticipacion" width={mainColWidths.estadoParticipacion} minWidth={120} onResize={resizeMainCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Estado de mi participación</ResizableTh>}
                    {columnConfig.filter((c) => c.visible).find((c) => c.id === 'etiquetas') && <ResizableTh colKey="etiquetas" width={mainColWidths.etiquetas} minWidth={80} onResize={resizeMainCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Etiquetas</ResizableTh>}
                    {columnConfig.filter((c) => c.visible).find((c) => c.id === 'tipoDocumento') && <ResizableTh colKey="tipoDocumento" width={mainColWidths.tipoDocumento} minWidth={70} onResize={resizeMainCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Tipo</ResizableTh>}
                    {columnConfig.filter((c) => c.visible).find((c) => c.id === 'numeroDocumento') && <ResizableTh colKey="numeroDocumento" width={mainColWidths.numeroDocumento} minWidth={80} onResize={resizeMainCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">N° Documento</ResizableTh>}
                    {columnConfig.filter((c) => c.visible).find((c) => c.id === 'folioInterno') && <ResizableTh colKey="folioInterno" width={mainColWidths.folioInterno} minWidth={70} onResize={resizeMainCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Folio</ResizableTh>}
                    {columnConfig.filter((c) => c.visible).find((c) => c.id === 'fechaCreacion') && <ResizableTh colKey="fechaCreacion" width={mainColWidths.fechaCreacion} minWidth={100} onResize={resizeMainCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Creación</ResizableTh>}
                    {columnConfig.filter((c) => c.visible).find((c) => c.id === 'fechaCompletado') && <ResizableTh colKey="fechaCompletado" width={mainColWidths.fechaCompletado} minWidth={100} onResize={resizeMainCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Completado</ResizableTh>}
                    {columnConfig.filter((c) => c.visible).find((c) => c.id === 'fechaVencimiento') && <ResizableTh colKey="fechaVencimiento" width={mainColWidths.fechaVencimiento} minWidth={90} onResize={resizeMainCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Vencimiento</ResizableTh>}
                    {columnConfig.filter((c) => c.visible).find((c) => c.id === 'prioridad') && <ResizableTh colKey="prioridad" width={mainColWidths.prioridad} minWidth={70} onResize={resizeMainCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Prioridad</ResizableTh>}
                    {columnConfig.filter((c) => c.visible).find((c) => c.id === 'rutaGuardado') && <ResizableTh colKey="rutaGuardado" width={mainColWidths.rutaGuardado} minWidth={90} onResize={resizeMainCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Ruta</ResizableTh>}
                    <th className="sticky right-0 bg-muted/40 text-left text-xs font-semibold text-muted-foreground px-3 py-3 border-l border-border shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.06)] w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCarpetas.map(renderFolderTableRow)}
                  {sortedDocuments.map((doc) => renderDocRowWithColumns(doc, columnConfig.filter((c) => c.visible)))}
                  {visibleCarpetas.length === 0 && sortedDocuments.length === 0 && (
                    <tr>
                      <td colSpan={columnConfig.filter((c) => c.visible).length + 3} className="px-4 py-12 text-center text-sm text-muted-foreground">
                        {searchQuery ? 'No se encontraron documentos.' : 'No hay documentos en este espacio aún.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
    );
  };

  return (
    <AppLayout noPadding>
      <div className={`flex ${isFullscreen ? 'fixed inset-0 z-[100] bg-background' : 'min-h-[calc(100vh-128px)]'}`}>
        {/* Left sidebar */}
        <div className={`w-52 2xl:w-64 flex-shrink-0 border-r border-border bg-white flex flex-col ${isFullscreen ? 'hidden' : ''}`}>
          <div className="flex flex-col pt-2 px-2 gap-0.5 flex-1 overflow-y-auto">
            {/* Inicio & Mi espacio & Papelera */}
            {sidebarItems.map((item) => {
              const Icon2 = item.icon;
              return (
                <React.Fragment key={item.id}>
                  <button
                    onClick={() => {
                      setActiveSection(item.id);
                      if (item.id === 'mi-espacio') {
                        setCurrentFolderId(null);
                        setFolderBreadcrumb([]);
                      }
                    }}
                    title={item.label}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors w-full ${
                      activeSection === item.id
                        ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    {Icon2 && <Icon2 size={16} className="flex-shrink-0" />}
                    <span className="text-left">{item.label}</span>
                  </button>
                  {/* Folder tree under Mi espacio — recursive */}
                  {item.id === 'mi-espacio' && rootCarpetas.length > 0 && (
                    <div className="ml-1 flex flex-col">
                      {rootCarpetas.map((carpeta) => (
                        <FolderTreeNode
                          key={carpeta.id}
                          carpeta={carpeta}
                          allCarpetas={carpetas}
                          currentFolderId={currentFolderId}
                          activeSection={activeSection}
                          depth={0}
                          onNavigate={handleSidebarFolderNav}
                        />
                      ))}
                    </div>
                  )}
                </React.Fragment>
              );
            })}

            {/* CREADOS POR DOCUBOX section */}
            <div className="mt-3 mb-1 px-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Creados por Docubox</p>
            </div>
            <button
              onClick={() => setActiveSection('favoritos')}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors w-full ${
                activeSection === 'favoritos' ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
              }`}
            >
              <Star size={16} className={`flex-shrink-0 ${activeSection === 'favoritos' ? 'text-primary' : 'text-yellow-400'}`} />
              <span className="text-left flex-1 truncate">Favoritos</span>
            </button>
            <button
              onClick={() => setActiveSection('por-vencer')}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors w-full ${
                activeSection === 'por-vencer' ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
              }`}
            >
              <AlertTriangle size={16} className="flex-shrink-0 text-orange-500" />
              <span className="text-left flex-1 truncate text-foreground">Por vencer (72hrs.)</span>
            </button>

            {/* CREADOS POR MÍ section */}
            <div className="mt-3 mb-1 px-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Creados por mí</p>
            </div>
            {/* Custom filters */}
            {customFilters.map((cf) => (
              <div
                key={cf.id}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-sm font-medium transition-colors w-full group ${
                  activeSection === `custom-${cf.id}` ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
                }`}
              >
                {editingFilterId === cf.id ? (
                  <div className="flex items-center gap-1 flex-1 min-w-0">
                    <span className="text-base flex-shrink-0">{cf.icono}</span>
                    <input
                      ref={editingFilterRef}
                      type="text"
                      value={editingFilterName}
                      onChange={(e) => setEditingFilterName(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          const nombre = editingFilterName.trim();
                          if (nombre && nombre !== cf.nombre) {
                            const updated = customFilters.map((f) => f.id === cf.id ? { ...f, nombre } : f);
                            setCustomFilters(updated);
                            await saveCustomFilters(updated);
                          }
                          setEditingFilterId(null);
                        } else if (e.key === 'Escape') {
                          setEditingFilterId(null);
                        }
                      }}
                      className="flex-1 min-w-0 text-sm bg-transparent border-b border-primary outline-none text-foreground"
                      autoFocus
                    />
                    <button
                      onClick={async () => {
                        const nombre = editingFilterName.trim();
                        if (nombre && nombre !== cf.nombre) {
                          const updated = customFilters.map((f) => f.id === cf.id ? { ...f, nombre } : f);
                          setCustomFilters(updated);
                          await saveCustomFilters(updated);
                        }
                        setEditingFilterId(null);
                      }}
                      className="flex-shrink-0 p-0.5 rounded hover:bg-green-100 text-green-600 transition-colors"
                    >
                      <Check size={12} />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => setActiveSection(`custom-${cf.id}`)}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    >
                      <span className="text-base flex-shrink-0">{cf.icono}</span>
                      <span className="flex-1 truncate">{cf.nombre}</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingFilterId(cf.id);
                        setEditingFilterName(cf.nombre);
                      }}
                      className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                      title="Editar nombre"
                    >
                      <Pencil size={11} />
                    </button>
                  </>
                )}
              </div>
            ))}
            {/* Crear filtro button */}
            <button
              onClick={() => setShowCrearFiltroModal(true)}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors w-full text-primary hover:bg-primary/5 border border-dashed border-primary/30 mt-1"
            >
              <Plus size={15} className="flex-shrink-0" />
              <span className="text-left flex-1 truncate">Crear filtro</span>
            </button>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-auto px-4 sm:px-6 lg:px-8 pt-2 pb-4 md:pb-6">
          {activeSection === 'mi-espacio' && renderMiEspacioContent()}

          {activeSection === 'favoritos' && (
            <>
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                    <Star size={22} className="text-yellow-400 fill-yellow-400" />
                    Favoritos
                  </h1>
                  <p className="text-sm text-muted-foreground mt-1">Documentos marcados como favoritos</p>
                </div>
              </div>
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <div className="flex-1 relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input type="text" placeholder="Buscar en Favoritos..." value={favSearchQuery} onChange={(e) => setFavSearchQuery(e.target.value)} className="w-full pl-9 pr-4 py-2 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors" />
                </div>
                <div className="relative">
                  <select
                    value={favSortOrder}
                    onChange={(e) => setFavSortOrder(e.target.value)}
                    style={{ fontFamily: 'inherit' }}
                    className="pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-white hover:bg-muted transition-colors text-foreground appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  >
                    <option value="ultimaModificacion_desc">Más reciente</option>
                    <option value="ultimaModificacion_asc">Más antiguo</option>
                    <option value="nombre_asc">Nombre A–Z</option>
                    <option value="nombre_desc">Nombre Z–A</option>
                    <option value="estado_asc">Estado</option>
                  </select>
                  <ArrowUpDown size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
                <div className="flex items-center border border-border rounded-lg overflow-hidden bg-white">
                  <button onClick={() => setFavViewMode('list')} className={`p-2 transition-colors ${favViewMode === 'list' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}><LayoutList size={16} /></button>
                  <button onClick={() => setFavViewMode('grid')} className={`p-2 transition-colors ${favViewMode === 'grid' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}><LayoutGrid size={16} /></button>
                </div>
                <div className="relative">
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); setFavColumnConfigOpen((v) => !v); }}
                    className={`p-2 border rounded-lg transition-colors ${favColumnConfigOpen ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-white hover:bg-muted text-foreground'}`}
                    title="Configurar columnas"
                  >
                    <SlidersHorizontal size={14} />
                  </button>
                  {favColumnConfigOpen && (
                    <div
                      ref={favColumnConfigRef}
                      className="absolute top-full right-0 mt-1 z-[200] bg-white border border-border rounded-xl shadow-xl p-3 min-w-[220px]"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Columnas visibles</p>
                      <div className="space-y-0.5 max-h-64 overflow-y-auto">
                        {/* Nombre - mandatory, always first */}
                        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg bg-blue-50 border border-blue-100">
                          <input type="checkbox" checked disabled className="rounded border-border accent-primary cursor-not-allowed flex-shrink-0 opacity-60" />
                          <span className="text-sm text-foreground font-medium">Nombre</span>
                          <span className="text-[10px] text-blue-600 font-semibold ml-auto">Fijo</span>
                        </div>
                        {(favColumnConfig).filter((col) => col.id !== 'nombre' && col.id !== 'nombreDocumento').map((col, colIdx) => (
                          <div
                            key={col.id}
                            draggable
                            onDragStart={() => { favColDragIdxRef.current = colIdx; setFavColDragIdx(colIdx); }}
                            onDragEnter={() => { favColDragOverIdxRef.current = colIdx; setFavColDragOverIdx(colIdx); }}
                            onDragEnd={() => {
                              const from = favColDragIdxRef.current;
                              const to = favColDragOverIdxRef.current;
                              if (from !== null && to !== null && from !== to) {
                                const nonNombre = favColumnConfig.filter((c) => c.id !== 'nombre' && c.id !== 'nombreDocumento');
                                const updated = [...nonNombre];
                                const [moved] = updated.splice(from, 1);
                                updated.splice(to, 0, moved);
                                setFavColumnConfig(updated);
                              }
                              favColDragIdxRef.current = null; favColDragOverIdxRef.current = null;
                              setFavColDragIdx(null); setFavColDragOverIdx(null);
                            }}
                            onDragOver={(e) => e.preventDefault()}
                            className={`flex items-center gap-2.5 px-2 py-2 rounded-lg cursor-grab active:cursor-grabbing transition-colors select-none ${favColDragIdx === colIdx ? 'opacity-40 border border-blue-400 bg-blue-50' : favColDragOverIdx === colIdx ? 'border border-blue-400 bg-blue-50' : 'hover:bg-muted'}`}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-muted-foreground/40 flex-shrink-0"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>
                            <input
                              type="checkbox"
                              checked={col.visible}
                              onChange={() => {
                                const updated = favColumnConfig.map((c) => c.id === col.id ? { ...c, visible: !c.visible } : c);
                                setFavColumnConfig(updated);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="rounded border-border accent-primary cursor-pointer flex-shrink-0"
                            />
                            <span className="text-sm text-foreground">{col.label}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 pt-2 border-t border-border flex gap-2">
                        <button onClick={() => setFavColumnConfig(DEFAULT_CF_COLUMNS.map((c) => ({ ...c, visible: true })))} className="flex-1 text-xs text-primary hover:underline font-medium text-center py-1">Mostrar todas</button>
                        <button onClick={() => setFavColumnConfig(DEFAULT_CF_COLUMNS.map((c) => ({ ...c })))} className="flex-1 text-xs text-muted-foreground hover:text-foreground font-medium text-center py-1">Restablecer</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="bg-white border border-border rounded-xl overflow-hidden">
                {loadingFavorites ? (
                  <div className="flex items-center justify-center py-12 gap-3"><svg className="animate-spin h-5 w-5 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg><span className="text-sm text-muted-foreground">Cargando favoritos...</span></div>
                ) : favViewMode === 'grid' ? (
                  <div className="p-4">
                    {favoriteDocuments.filter((d) => d.name.toLowerCase().includes(favSearchQuery.toLowerCase())).length === 0 ? (
                      <div className="py-12 text-center text-sm text-muted-foreground">No tienes documentos favoritos aún.</div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                        {favoriteDocuments.filter((d) => d.name.toLowerCase().includes(favSearchQuery.toLowerCase())).map(renderDocGridCard)}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                  <table className="w-full min-w-max">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="px-3 py-3" style={{ width: `${favColWidths.checkbox}px` }}></th>
                        <ResizableTh colKey="nombre" width={favColWidths.nombre} minWidth={120} onResize={resizeFavCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3">Nombre</ResizableTh>
                        {favColumnConfig.find((c) => c.id === 'propietario')?.visible && <ResizableTh colKey="propietario" width={favColWidths.propietario} minWidth={80} onResize={resizeFavCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Propietario</ResizableTh>}
                        {favColumnConfig.find((c) => c.id === 'estado')?.visible && <ResizableTh colKey="estado" width={favColWidths.estado} minWidth={80} onResize={resizeFavCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Estado</ResizableTh>}
                        {favColumnConfig.find((c) => c.id === 'fechaCreacion')?.visible && <ResizableTh colKey="fechaCreacion" width={favColWidths.fechaCreacion} minWidth={100} onResize={resizeFavCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Fecha de creación</ResizableTh>}
                        {favColumnConfig.find((c) => c.id === 'numeroDocumento')?.visible && <ResizableTh colKey="numeroDocumento" width={favColWidths.numeroDocumento} minWidth={80} onResize={resizeFavCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">N° Documento</ResizableTh>}
                        {favColumnConfig.find((c) => c.id === 'ultimaModificacion')?.visible && <ResizableTh colKey="ultimaModificacion" width={favColWidths.ultimaModificacion} minWidth={120} onResize={resizeFavCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Última modificación</ResizableTh>}
                        {favColumnConfig.find((c) => c.id === 'tamano')?.visible && <ResizableTh colKey="tamano" width={favColWidths.tamano} minWidth={60} onResize={resizeFavCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Tamaño</ResizableTh>}
                        {favColumnConfig.find((c) => c.id === 'etiquetas')?.visible && <ResizableTh colKey="etiquetas" width={favColWidths.etiquetas} minWidth={80} onResize={resizeFavCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Etiquetas</ResizableTh>}
                        {favColumnConfig.find((c) => c.id === 'tipoDocumento')?.visible && <ResizableTh colKey="tipoDocumento" width={favColWidths.tipoDocumento} minWidth={70} onResize={resizeFavCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Tipo</ResizableTh>}
                        {favColumnConfig.find((c) => c.id === 'fechaVencimiento')?.visible && <ResizableTh colKey="fechaVencimiento" width={favColWidths.fechaVencimiento} minWidth={90} onResize={resizeFavCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Vencimiento</ResizableTh>}
                        {favColumnConfig.find((c) => c.id === 'prioridad')?.visible && <ResizableTh colKey="prioridad" width={favColWidths.prioridad} minWidth={70} onResize={resizeFavCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Prioridad</ResizableTh>}
                        <th className="sticky right-0 bg-muted/40 text-left text-xs font-semibold text-muted-foreground px-3 py-3 border-l border-border shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.06)] w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        let docs = favoriteDocuments.filter((d) => d.name.toLowerCase().includes(favSearchQuery.toLowerCase()));
                        docs = [...docs].sort((a, b) => {
                          if (favSortOrder === 'nombre_asc') return a.name.localeCompare(b.name);
                          if (favSortOrder === 'nombre_desc') return b.name.localeCompare(a.name);
                          if (favSortOrder === 'estado_asc') return a.estado.localeCompare(b.estado);
                          if (favSortOrder === 'ultimaModificacion_asc') return a.ultimaModificacion.localeCompare(b.ultimaModificacion);
                          return b.ultimaModificacion.localeCompare(a.ultimaModificacion);
                        });
                        return docs.map((doc) => (
                          <tr key={doc.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors group">
                            <td className="px-3 py-3 w-10">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${doc.estado === 'Rechazado' ? 'bg-red-50 border border-red-200' : doc.estado === 'Completado' ? 'bg-green-50 border border-green-200' : doc.estado === 'En proceso' ? 'bg-blue-50 border border-blue-200' : doc.estado === 'En espera' ? 'bg-orange-50 border border-orange-200' : doc.estado === 'Cancelado' ? 'bg-slate-50 border border-slate-200' : 'bg-gray-50 border border-gray-200'}`}>
                                <FileText size={16} className={getDocIconColor(doc.estado)} />
                              </div>
                            </td>
                            <td className="px-3 py-3 min-w-[200px]">
                              <div className="flex flex-col">
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => doc.isDraft ? router.push(`/crear-documento?draft=${doc.id}`) : router.push(`/visor-documento/${doc.id}`)}
                                    className="text-xs font-medium text-foreground hover:text-primary transition-colors text-left"
                                  >
                                    {doc.name}
                                  </button>
                                  <Star size={11} className="text-yellow-400 fill-yellow-400 flex-shrink-0" />
                                </div>
                                {doc.descripcion ? (
                                  <span className="text-xs text-muted-foreground">{doc.descripcion}</span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">{doc.fechaCreacion ? doc.fechaCreacion.split(' ')[0] : ''}</span>
                                )}
                              </div>
                            </td>
                            {favColumnConfig.find((c) => c.id === 'propietario')?.visible && <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.ownerName || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Yo'}</span></td>}
                            {favColumnConfig.find((c) => c.id === 'estado')?.visible && <td className="px-3 py-3"><div className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusDot(doc.estado)}`} /><span className="text-xs text-muted-foreground">{doc.estado}</span></div></td>}
                            {favColumnConfig.find((c) => c.id === 'fechaCreacion')?.visible && <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.fechaCreacion || '—'}</span></td>}
                            {favColumnConfig.find((c) => c.id === 'numeroDocumento')?.visible && <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.numeroOficio || '—'}</span></td>}
                            {favColumnConfig.find((c) => c.id === 'ultimaModificacion')?.visible && <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.ultimaModificacion}</span></td>}
                            {favColumnConfig.find((c) => c.id === 'tamano')?.visible && <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.tamano}</span></td>}
                            {favColumnConfig.find((c) => c.id === 'etiquetas')?.visible && <td className="px-3 py-3"><div className="flex flex-wrap gap-1">{doc.etiquetas.length > 0 ? doc.etiquetas.slice(0, 2).map((tagId, i) => {
                              const etiqueta = etiquetasList.find((e) => e.id === String(tagId) || e.nombre === String(tagId));
                              const label = etiqueta ? etiqueta.nombre : String(tagId);
                              const color = etiqueta?.color || '#6366f1';
                              return <span key={i} className="px-1.5 py-0.5 text-xs rounded-full font-medium" style={{ backgroundColor: `${color}20`, color, border: `1px solid ${color}40` }}>{label}</span>;
                            }) : <span className="text-xs text-muted-foreground">—</span>}</div></td>}
                            {favColumnConfig.find((c) => c.id === 'tipoDocumento')?.visible && <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.tipoDocumentoNombre || '—'}</span></td>}
                            {favColumnConfig.find((c) => c.id === 'fechaVencimiento')?.visible && <td className="px-3 py-3"><span className={`text-xs ${doc.fechaVencimiento ? 'text-orange-600 font-medium' : 'text-muted-foreground'}`}>{doc.fechaVencimiento ? formatDate(doc.fechaVencimiento) : '—'}</span></td>}
                            {favColumnConfig.find((c) => c.id === 'prioridad')?.visible && <td className="px-3 py-3">{doc.esUrgente ? <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-600">Urgente</span> : <span className="text-xs text-muted-foreground">Normal</span>}</td>}
                            <td className="sticky right-0 bg-white px-3 py-3 border-l border-border shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.06)] w-10">
                              <button onClick={(e) => openContextMenu(e, doc)} className={`p-1.5 rounded hover:bg-muted transition-colors ${activeContextMenuDocId === doc.id && contextMenu.open ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`} title="Opciones">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                              </button>
                            </td>
                          </tr>
                        ));
                      })()}
                      {favoriteDocuments.length === 0 && <tr><td colSpan={10} className="px-4 py-12 text-center text-sm text-muted-foreground">No tienes documentos favoritos aún.</td></tr>}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            </>
          )}

          {activeSection === 'por-vencer' && (
            <>
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                    <AlertTriangle size={22} className="text-orange-500" />
                    Por vencer
                  </h1>
                  <p className="text-sm text-muted-foreground mt-1">Documentos que vencen en las próximas 72 horas</p>
                </div>
              </div>
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <div className="flex-1 relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input type="text" placeholder="Buscar..." value={porVencerSearch} onChange={(e) => setPorVencerSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors" />
                </div>
                <div className="relative">
                  <select
                    value={porVencerSortOrder}
                    onChange={(e) => setPorVencerSortOrder(e.target.value)}
                    style={{ fontFamily: 'inherit' }}
                    className="pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-white hover:bg-muted transition-colors text-foreground appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  >
                    <option value="fechaVencimiento_asc">Vence antes</option>
                    <option value="fechaVencimiento_desc">Vence después</option>
                    <option value="nombre_asc">Nombre A–Z</option>
                    <option value="nombre_desc">Nombre Z–A</option>
                    <option value="estado_asc">Estado</option>
                  </select>
                  <ArrowUpDown size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
                <div className="flex items-center border border-border rounded-lg overflow-hidden bg-white">
                  <button onClick={() => setPorVencerViewMode('list')} className={`p-2 transition-colors ${porVencerViewMode === 'list' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}><LayoutList size={16} /></button>
                  <button onClick={() => setPorVencerViewMode('grid')} className={`p-2 transition-colors ${porVencerViewMode === 'grid' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}><LayoutGrid size={16} /></button>
                </div>
                <div className="relative">
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); setPorVencerColumnConfigOpen((v) => !v); }}
                    className={`p-2 border rounded-lg transition-colors ${porVencerColumnConfigOpen ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-white hover:bg-muted text-foreground'}`}
                    title="Configurar columnas"
                  >
                    <SlidersHorizontal size={14} />
                  </button>
                  {porVencerColumnConfigOpen && (
                    <div
                      ref={porVencerColumnConfigRef}
                      className="absolute top-full right-0 mt-1 z-[200] bg-white border border-border rounded-xl shadow-xl p-3 min-w-[220px]"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Columnas visibles</p>
                      <div className="space-y-0.5 max-h-64 overflow-y-auto">
                        {/* Nombre - mandatory, always first */}
                        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg bg-blue-50 border border-blue-100">
                          <input type="checkbox" checked disabled className="rounded border-border accent-primary cursor-not-allowed flex-shrink-0 opacity-60" />
                          <span className="text-sm text-foreground font-medium">Nombre</span>
                          <span className="text-[10px] text-blue-600 font-semibold ml-auto">Fijo</span>
                        </div>
                        {porVencerColumnConfig.filter((col) => col.id !== 'nombre' && col.id !== 'nombreDocumento').map((col, colIdx) => (
                          <div
                            key={col.id}
                            draggable
                            onDragStart={() => { pvColDragIdxRef.current = colIdx; setPvColDragIdx(colIdx); }}
                            onDragEnter={() => { pvColDragOverIdxRef.current = colIdx; setPvColDragOverIdx(colIdx); }}
                            onDragEnd={() => {
                              const from = pvColDragIdxRef.current;
                              const to = pvColDragOverIdxRef.current;
                              if (from !== null && to !== null && from !== to) {
                                const nonNombre = porVencerColumnConfig.filter((c) => c.id !== 'nombre' && c.id !== 'nombreDocumento');
                                const updated = [...nonNombre];
                                const [moved] = updated.splice(from, 1);
                                updated.splice(to, 0, moved);
                                setPorVencerColumnConfig(updated);
                              }
                              pvColDragIdxRef.current = null; pvColDragOverIdxRef.current = null;
                              setPvColDragIdx(null); setPvColDragOverIdx(null);
                            }}
                            onDragOver={(e) => e.preventDefault()}
                            className={`flex items-center gap-2.5 px-2 py-2 rounded-lg cursor-grab active:cursor-grabbing transition-colors select-none ${pvColDragIdx === colIdx ? 'opacity-40 border border-blue-400 bg-blue-50' : pvColDragOverIdx === colIdx ? 'border border-blue-400 bg-blue-50' : 'hover:bg-muted'}`}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-muted-foreground/40 flex-shrink-0"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>
                            <input
                              type="checkbox"
                              checked={col.visible}
                              onChange={() => {
                                const updated = porVencerColumnConfig.map((c) => c.id === col.id ? { ...c, visible: !c.visible } : c);
                                setPorVencerColumnConfig(updated);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="rounded border-border accent-primary cursor-pointer flex-shrink-0"
                            />
                            <span className="text-sm text-foreground">{col.label}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 pt-2 border-t border-border flex gap-2">
                        <button onClick={() => setPorVencerColumnConfig(DEFAULT_CF_COLUMNS.map((c) => ({ ...c, visible: true })))} className="flex-1 text-xs text-primary hover:underline font-medium text-center py-1">Mostrar todas</button>
                        <button onClick={() => setPorVencerColumnConfig(DEFAULT_CF_COLUMNS.map((c) => ({ ...c })))} className="flex-1 text-xs text-muted-foreground hover:text-foreground font-medium text-center py-1">Restablecer</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="bg-white border border-border rounded-xl overflow-hidden">
                {loadingPorVencer ? (
                  <div className="flex items-center justify-center py-12 gap-3"><svg className="animate-spin h-5 w-5 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg><span className="text-sm text-muted-foreground">Cargando...</span></div>
                ) : porVencerViewMode === 'grid' ? (
                  <div className="p-4">
                    {porVencerDocuments.filter((d) => d.name.toLowerCase().includes(porVencerSearch.toLowerCase())).length === 0 ? (
                      <div className="py-12 text-center text-sm text-muted-foreground">No hay documentos por vencer en las próximas 72 horas.</div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                        {porVencerDocuments.filter((d) => d.name.toLowerCase().includes(porVencerSearch.toLowerCase())).map(renderDocGridCard)}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                  <table className="w-full min-w-max">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="px-3 py-3" style={{ width: `${porVencerColWidths.checkbox}px` }}></th>
                        <ResizableTh colKey="nombre" width={porVencerColWidths.nombre} minWidth={120} onResize={resizePorVencerCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3">Nombre</ResizableTh>
                        {porVencerColumnConfig.find((c) => c.id === 'propietario')?.visible && <ResizableTh colKey="propietario" width={porVencerColWidths.propietario} minWidth={80} onResize={resizePorVencerCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Propietario</ResizableTh>}
                        {porVencerColumnConfig.find((c) => c.id === 'estado')?.visible && <ResizableTh colKey="estado" width={porVencerColWidths.estado} minWidth={80} onResize={resizePorVencerCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Estado</ResizableTh>}
                        {porVencerColumnConfig.find((c) => c.id === 'fechaCreacion')?.visible && <ResizableTh colKey="fechaCreacion" width={porVencerColWidths.fechaCreacion} minWidth={100} onResize={resizePorVencerCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Fecha de creación</ResizableTh>}
                        {porVencerColumnConfig.find((c) => c.id === 'numeroDocumento')?.visible && <ResizableTh colKey="numeroDocumento" width={porVencerColWidths.numeroDocumento} minWidth={80} onResize={resizePorVencerCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">N° Documento</ResizableTh>}
                        {porVencerColumnConfig.find((c) => c.id === 'ultimaModificacion')?.visible && <ResizableTh colKey="ultimaModificacion" width={porVencerColWidths.ultimaModificacion} minWidth={120} onResize={resizePorVencerCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Última modificación</ResizableTh>}
                        {porVencerColumnConfig.find((c) => c.id === 'tamano')?.visible && <ResizableTh colKey="tamano" width={porVencerColWidths.tamano} minWidth={60} onResize={resizePorVencerCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Tamaño</ResizableTh>}
                        <ResizableTh colKey="vence" width={porVencerColWidths.vence} minWidth={90} onResize={resizePorVencerCol} className="text-left text-xs font-semibold text-orange-500 px-3 py-3 whitespace-nowrap">Vence</ResizableTh>
                        {porVencerColumnConfig.find((c) => c.id === 'etiquetas')?.visible && <ResizableTh colKey="etiquetas" width={porVencerColWidths.etiquetas} minWidth={80} onResize={resizePorVencerCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Etiquetas</ResizableTh>}
                        {porVencerColumnConfig.find((c) => c.id === 'tipoDocumento')?.visible && <ResizableTh colKey="tipoDocumento" width={porVencerColWidths.tipoDocumento} minWidth={70} onResize={resizePorVencerCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Tipo</ResizableTh>}
                        {porVencerColumnConfig.find((c) => c.id === 'prioridad')?.visible && <ResizableTh colKey="prioridad" width={porVencerColWidths.prioridad} minWidth={70} onResize={resizePorVencerCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Prioridad</ResizableTh>}
                        <th className="sticky right-0 bg-muted/40 text-left text-xs font-semibold text-muted-foreground px-3 py-3 border-l border-border shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.06)] w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        let docs = porVencerDocuments.filter((d) => d.name.toLowerCase().includes(porVencerSearch.toLowerCase()));
                        docs = [...docs].sort((a, b) => {
                          if (porVencerSortOrder === 'nombre_asc') return a.name.localeCompare(b.name);
                          if (porVencerSortOrder === 'nombre_desc') return b.name.localeCompare(a.name);
                          if (porVencerSortOrder === 'estado_asc') return a.estado.localeCompare(b.estado);
                          if (porVencerSortOrder === 'fechaVencimiento_desc') return (b.fechaVencimiento || '').localeCompare(a.fechaVencimiento || '');
                          return (a.fechaVencimiento || '').localeCompare(b.fechaVencimiento || '');
                        });
                        return docs.map((doc) => (
                          <tr key={doc.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors group">
                            <td className="px-3 py-3 w-10">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${doc.estado === 'Rechazado' ? 'bg-red-50 border border-red-200' : doc.estado === 'Completado' ? 'bg-green-50 border border-green-200' : doc.estado === 'En proceso' ? 'bg-blue-50 border border-blue-200' : doc.estado === 'En espera' ? 'bg-orange-50 border border-orange-200' : doc.estado === 'Cancelado' ? 'bg-slate-50 border border-slate-200' : 'bg-gray-50 border border-gray-200'}`}>
                                <FileText size={16} className={getDocIconColor(doc.estado)} />
                              </div>
                            </td>
                            <td className="px-3 py-3 min-w-[200px]">
                              <div className="flex flex-col">
                                <button
                                  onClick={() => doc.isDraft ? router.push(`/crear-documento?draft=${doc.id}`) : router.push(`/visor-documento/${doc.id}`)}
                                  className="text-xs font-medium text-foreground hover:text-primary transition-colors text-left"
                                >
                                  {doc.name}
                                </button>
                                {doc.descripcion ? (
                                  <span className="text-xs text-muted-foreground">{doc.descripcion}</span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">{doc.fechaCreacion ? doc.fechaCreacion.split(' ')[0] : ''}</span>
                                )}
                              </div>
                            </td>
                            {porVencerColumnConfig.find((c) => c.id === 'propietario')?.visible && <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.ownerName || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Yo'}</span></td>}
                            {porVencerColumnConfig.find((c) => c.id === 'estado')?.visible && <td className="px-3 py-3"><div className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusDot(doc.estado)}`} /><span className="text-xs text-muted-foreground">{doc.estado}</span></div></td>}
                            {porVencerColumnConfig.find((c) => c.id === 'fechaCreacion')?.visible && <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.fechaCreacion || '—'}</span></td>}
                            {porVencerColumnConfig.find((c) => c.id === 'numeroDocumento')?.visible && <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.numeroOficio || '—'}</span></td>}
                            {porVencerColumnConfig.find((c) => c.id === 'ultimaModificacion')?.visible && <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.ultimaModificacion}</span></td>}
                            {porVencerColumnConfig.find((c) => c.id === 'tamano')?.visible && <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.tamano}</span></td>}
                            <td className="px-3 py-3"><span className="text-xs text-orange-600 font-medium">{doc.fechaVencimiento ? formatDate(doc.fechaVencimiento) : '—'}</span></td>
                            {porVencerColumnConfig.find((c) => c.id === 'etiquetas')?.visible && <td className="px-3 py-3"><div className="flex flex-wrap gap-1">{doc.etiquetas.length > 0 ? doc.etiquetas.slice(0, 2).map((tagId, i) => { const etiqueta = etiquetasList.find((e) => e.id === String(tagId) || e.nombre === String(tagId)); const label = etiqueta ? etiqueta.nombre : String(tagId); const color = etiqueta?.color || '#6366f1'; return <span key={i} className="px-1.5 py-0.5 text-xs rounded-full font-medium" style={{ backgroundColor: `${color}20`, color, border: `1px solid ${color}40` }}>{label}</span>; }) : <span className="text-xs text-muted-foreground">—</span>}</div></td>}
                            {porVencerColumnConfig.find((c) => c.id === 'tipoDocumento')?.visible && <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.tipoDocumentoNombre || '—'}</span></td>}
                            {porVencerColumnConfig.find((c) => c.id === 'prioridad')?.visible && <td className="px-3 py-3">{doc.esUrgente ? <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-600">Urgente</span> : <span className="text-xs text-muted-foreground">Normal</span>}</td>}
                            <td className="sticky right-0 bg-white px-3 py-3 border-l border-border shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.06)] w-10">
                              <button onClick={(e) => openContextMenu(e, doc)} className={`p-1.5 rounded hover:bg-muted transition-colors ${activeContextMenuDocId === doc.id && contextMenu.open ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`} title="Opciones">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                              </button>
                            </td>
                          </tr>
                        ));
                      })()}
                      {porVencerDocuments.length === 0 && <tr><td colSpan={10} className="px-4 py-12 text-center text-sm text-muted-foreground">No hay documentos por vencer en las próximas 72 horas.</td></tr>}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            </>
          )}

          {activeSection === 'papelera' && (
            <>
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                    <Trash2 size={22} className="text-muted-foreground" />
                    Papelera
                  </h1>
                  <p className="text-sm text-muted-foreground mt-1">Documentos eliminados recientemente</p>
                </div>
                {deletedDocuments.length > 0 && (
                  <button
                    onClick={openConfirmEmptyAll}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
                  >
                    <Trash2 size={15} />Vaciar papelera
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Buscar en papelera..."
                    value={papeleraSearch}
                    onChange={(e) => setPapeleraSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                  />
                </div>
              </div>
              <div className="bg-white border border-border rounded-xl overflow-hidden">
                {loadingPapelera ? (
                  <div className="flex items-center justify-center py-12 gap-3">
                    <svg className="animate-spin h-5 w-5 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    <span className="text-sm text-muted-foreground">Cargando papelera...</span>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                  <table className="w-full min-w-max">
                    <thead>
                      <tr className="border-b border-border">
                        <ResizableTh colKey="nombre" width={papeleraColWidths.nombre} minWidth={150} onResize={resizePapeleraCol} className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Nombre del documento</ResizableTh>
                        <ResizableTh colKey="tipo" width={papeleraColWidths.tipo} minWidth={70} onResize={resizePapeleraCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3">Tipo</ResizableTh>
                        <ResizableTh colKey="eliminadoPor" width={papeleraColWidths.eliminadoPor} minWidth={100} onResize={resizePapeleraCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3">Eliminado por</ResizableTh>
                        <ResizableTh colKey="fechaEliminacion" width={papeleraColWidths.fechaEliminacion} minWidth={100} onResize={resizePapeleraCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3">Fecha eliminación</ResizableTh>
                        <ResizableTh colKey="tamano" width={papeleraColWidths.tamano} minWidth={60} onResize={resizePapeleraCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3">Tamaño</ResizableTh>
                        <ResizableTh colKey="retencion" width={papeleraColWidths.retencion} minWidth={70} onResize={resizePapeleraCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3">Retención</ResizableTh>
                        <th className="sticky right-0 bg-white text-left text-xs font-semibold text-muted-foreground px-3 py-3 border-l border-border shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.06)]" style={{ width: `${papeleraColWidths.acciones}px` }}>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDeleted.map((doc) => (
                        <tr key={doc.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 min-w-[260px]">
                            <div className="flex items-start gap-2">
                              <FileText size={16} className="text-muted-foreground flex-shrink-0 mt-0.5" />
                              <div className="flex flex-col min-w-0">
                                <span className="text-xs font-medium text-foreground">{doc.name}</span>
                                {doc.descripcion && (
                                  <span className="text-xs text-muted-foreground">{doc.descripcion}</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.tipo}</span></td>
                          <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.eliminadoPor}</span></td>
                          <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.fechaEliminacion}</span></td>
                          <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.tamano}</span></td>
                          <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.retencion || '—'}</span></td>
                          <td className="sticky right-0 bg-white px-3 py-3 border-l border-border shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.06)]">
                            <div className="flex items-center gap-2 justify-end">
                              <button
                                onClick={() => handleRestore(doc.id)}
                                className="px-3 py-1.5 text-xs font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors whitespace-nowrap"
                              >
                                Restaurar
                              </button>
                              <button
                                onClick={() => openConfirmDelete(doc.id, doc.name)}
                                className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors whitespace-nowrap"
                              >
                                Eliminar permanentemente
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filteredDeleted.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-4 py-12 text-center text-sm text-muted-foreground">
                            {papeleraSearch ? 'No se encontraron documentos.' : 'La papelera está vacía.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
              {confirmDelete.open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                  <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setConfirmDelete({ open: false, docId: null, docName: '', isEmptyAll: false })} />
                  <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 z-10">
                    <button onClick={() => setConfirmDelete({ open: false, docId: null, docName: '', isEmptyAll: false })} className="absolute top-4 right-4 p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"><X size={16} /></button>
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mb-4"><AlertCircle size={24} className="text-red-600" /></div>
                    <h2 className="text-lg font-bold text-foreground mb-2">{confirmDelete.isEmptyAll ? 'Vaciar papelera' : 'Eliminar permanentemente'}</h2>
                    <p className="text-sm text-muted-foreground mb-6">{confirmDelete.isEmptyAll ? 'Se eliminarán permanentemente todos los documentos de la papelera. Esta acción no se puede deshacer.' : (<>¿Estás seguro de que deseas eliminar permanentemente <span className="font-semibold text-foreground">&ldquo;{confirmDelete.docName}&rdquo;</span>? Esta acción no se puede deshacer.</>)}</p>
                    <div className="flex items-center gap-3 justify-end">
                      <button onClick={() => setConfirmDelete({ open: false, docId: null, docName: '', isEmptyAll: false })} className="px-4 py-2 text-sm font-semibold text-foreground border border-border rounded-lg hover:bg-muted transition-colors">Cancelar</button>
                      <button onClick={handleConfirmPermanentDelete} className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors">{confirmDelete.isEmptyAll ? 'Vaciar papelera' : 'Eliminar permanentemente'}</button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Custom filter sections */}
          {customFilters.map((cf) => activeSection === `custom-${cf.id}` && (
            <React.Fragment key={cf.id}>
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                    <span className="text-2xl">{cf.icono}</span>
                    {cf.nombre}
                  </h1>
                  <p className="text-sm text-muted-foreground mt-1">{cf.descripcion || 'Filtro personalizado'}</p>
                </div>
                <button
                  onClick={async () => {
                    const updated = customFilters.filter((f) => f.id !== cf.id);
                    setCustomFilters(updated);
                    await saveCustomFilters(updated);
                    setActiveSection('inicio');
                    showToast(`Filtro "${cf.nombre}" eliminado`);
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                >
                  <X size={14} />Eliminar filtro
                </button>
              </div>

              {/* Toolbar: search, sort, view type, configure columns */}
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <div className="flex-1 min-w-[180px] relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder={`Buscar en ${cf.nombre}...`}
                    value={cfSearchQueries[cf.id] || ''}
                    onChange={(e) => setCfSearchQueries((prev) => ({ ...prev, [cf.id]: e.target.value }))}
                    className="w-full pl-9 pr-4 py-2 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                  />
                </div>
                <div className="relative">
                  <select
                    value={cfSortOrders[cf.id] || 'ultimaModificacion_desc'}
                    onChange={(e) => setCfSortOrders((prev) => ({ ...prev, [cf.id]: e.target.value }))}
                    style={{ fontFamily: 'inherit' }}
                    className="pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-white hover:bg-muted transition-colors text-foreground appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  >
                    <option value="ultimaModificacion_desc">Más reciente</option>
                    <option value="ultimaModificacion_asc">Más antiguo</option>
                    <option value="nombre_asc">Nombre A–Z</option>
                    <option value="nombre_desc">Nombre Z–A</option>
                    <option value="estado_asc">Estado</option>
                  </select>
                  <ArrowUpDown size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
                <div className="flex items-center border border-border rounded-lg overflow-hidden bg-white">
                  <button
                    onClick={() => setCfViewModes((prev) => ({ ...prev, [cf.id]: 'list' }))}
                    className={`p-2 transition-colors ${(cfViewModes[cf.id] || 'list') === 'list' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                    title="Vista lista"
                  >
                    <LayoutList size={16} />
                  </button>
                  <button
                    onClick={() => setCfViewModes((prev) => ({ ...prev, [cf.id]: 'grid' }))}
                    className={`p-2 transition-colors ${(cfViewModes[cf.id] || 'list') === 'grid' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                    title="Vista cuadrícula"
                  >
                    <LayoutGrid size={16} />
                  </button>
                </div>
                <div
                  className="relative"
                  ref={(el) => { cfColumnConfigRefs.current[cf.id] = el; }}
                >
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCfColumnConfigOpen((prev) => prev === cf.id ? null : cf.id);
                    }}
                    className={`p-2 border rounded-lg transition-colors ${cfColumnConfigOpen === cf.id ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-white hover:bg-muted text-foreground'}`}
                    title="Configurar columnas"
                  >
                    <SlidersHorizontal size={14} />
                  </button>
                  {cfColumnConfigOpen === cf.id && (
                    <div
                      className="absolute top-full right-0 mt-1 z-[200] bg-white border border-border rounded-xl shadow-xl p-3 min-w-[220px]"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Columnas visibles</p>
                      <div className="space-y-0.5 max-h-64 overflow-y-auto">
                        {/* Nombre - mandatory, always first, not draggable */}
                        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg bg-blue-50 border border-blue-100 select-none">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-muted-foreground/30 flex-shrink-0"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>
                          <span className="text-sm text-foreground font-medium flex-1">Nombre</span>
                          <span className="text-[10px] text-blue-600 font-semibold">Fijo</span>
                          <input type="checkbox" checked disabled className="rounded border-border accent-primary cursor-not-allowed flex-shrink-0 opacity-60" />
                        </div>
                        {(cfColumnConfigs[cf.id] || DEFAULT_CF_COLUMNS).filter((col) => col.id !== 'nombre' && col.id !== 'nombreDocumento').map((col, colIdx) => (
                          <div
                            key={col.id}
                            draggable
                            onDragStart={() => { cfColDragIdxRef.current[cf.id] = colIdx; setCfColDragIdx((p) => ({ ...p, [cf.id]: colIdx })); }}
                            onDragEnter={() => { cfColDragOverIdxRef.current[cf.id] = colIdx; setCfColDragOverIdx((p) => ({ ...p, [cf.id]: colIdx })); }}
                            onDragEnd={() => {
                              const from = cfColDragIdxRef.current[cf.id];
                              const to = cfColDragOverIdxRef.current[cf.id];
                              if (from !== null && from !== undefined && to !== null && to !== undefined && from !== to) {
                                const current = cfColumnConfigs[cf.id] || DEFAULT_CF_COLUMNS.map((c) => ({ ...c }));
                                const nonNombre = current.filter((c) => c.id !== 'nombre' && c.id !== 'nombreDocumento');
                                const updated = [...nonNombre];
                                const [moved] = updated.splice(from, 1);
                                updated.splice(to, 0, moved);
                                setCfColumnConfigs((prev) => ({ ...prev, [cf.id]: updated }));
                              }
                              cfColDragIdxRef.current[cf.id] = null;
                              cfColDragOverIdxRef.current[cf.id] = null;
                              setCfColDragIdx((p) => ({ ...p, [cf.id]: null }));
                              setCfColDragOverIdx((p) => ({ ...p, [cf.id]: null }));
                            }}
                            onDragOver={(e) => e.preventDefault()}
                            className={`flex items-center gap-2.5 px-2 py-2 rounded-lg cursor-grab active:cursor-grabbing transition-colors select-none ${cfColDragIdx[cf.id] === colIdx ? 'opacity-40 border border-blue-400 bg-blue-50' : cfColDragOverIdx[cf.id] === colIdx ? 'border border-blue-400 bg-blue-50' : 'hover:bg-muted'}`}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-muted-foreground/40 flex-shrink-0 cursor-grab"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>
                            <input
                              type="checkbox"
                              checked={col.visible}
                              onChange={() => {
                                const current = cfColumnConfigs[cf.id] || DEFAULT_CF_COLUMNS.map((c) => ({ ...c }));
                                const actualIdx = current.findIndex((c) => c.id === col.id);
                                const updated = current.map((c, i) => i === actualIdx ? { ...c, visible: !c.visible } : c);
                                setCfColumnConfigs((prev) => ({ ...prev, [cf.id]: updated }));
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="rounded border-border accent-primary cursor-pointer flex-shrink-0"
                            />
                            <span className="text-sm text-foreground">{col.label}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 pt-2 border-t border-border flex gap-2">
                        <button
                          onClick={() => { setCfColumnConfigs((prev) => ({ ...prev, [cf.id]: DEFAULT_CF_COLUMNS.map((c) => ({ ...c, visible: true })) })); }}
                          className="flex-1 text-xs text-primary hover:underline font-medium text-center py-1"
                        >
                          Mostrar todas
                        </button>
                        <button
                          onClick={() => { setCfColumnConfigs((prev) => ({ ...prev, [cf.id]: DEFAULT_CF_COLUMNS.map((c) => ({ ...c })) })); }}
                          className="flex-1 text-xs text-muted-foreground hover:text-foreground font-medium text-center py-1"
                        >
                          Restablecer
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Document list */}
              {(() => {
                const cfSearch = (cfSearchQueries[cf.id] || '').toLowerCase();
                const cfSort = cfSortOrders[cf.id] || 'ultimaModificacion_desc';
                const cfView = cfViewModes[cf.id] || 'list';
                const cfCols = cfColumnConfigs[cf.id] || DEFAULT_CF_COLUMNS;

                let docs = getCustomFilterDocuments(cf).filter((doc) =>
                  !cfSearch || doc.name.toLowerCase().includes(cfSearch)
                );

                docs = [...docs].sort((a, b) => {
                  if (cfSort === 'nombre_asc') return a.name.localeCompare(b.name);
                  if (cfSort === 'nombre_desc') return b.name.localeCompare(a.name);
                  if (cfSort === 'estado_asc') return a.estado.localeCompare(b.estado);
                  if (cfSort === 'ultimaModificacion_asc') return a.ultimaModificacion.localeCompare(b.ultimaModificacion);
                  return b.ultimaModificacion.localeCompare(a.ultimaModificacion);
                });

                if (cfView === 'grid') {
                  return (
                    <div>
                      {docs.length === 0 ? (
                        <div className="py-16 text-center text-sm text-muted-foreground">
                          {cfSearch ? 'No hay documentos que coincidan con la búsqueda.' : 'No hay documentos que coincidan con este filtro.'}
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                          {docs.map(renderDocGridCard)}
                        </div>
                      )}
                    </div>
                  );
                }

                const visibleCols = cfCols.filter((c) => c.visible);
                return (
                  <div className="bg-white border border-border rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                    <table className="w-full min-w-max">
                      <thead>
                        <tr className="border-b border-border bg-muted/40">
                          <th className="px-3 py-3" style={{ width: `${cfColWidths.checkbox}px` }}></th>
                          <ResizableTh colKey="nombre" width={cfColWidths.nombre} minWidth={120} onResize={resizeCfCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3">Nombre</ResizableTh>
                          {visibleCols.find((c) => c.id === 'propietario') && <ResizableTh colKey="propietario" width={cfColWidths.propietario} minWidth={80} onResize={resizeCfCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Propietario</ResizableTh>}
                          {visibleCols.find((c) => c.id === 'estado') && <ResizableTh colKey="estado" width={cfColWidths.estado} minWidth={80} onResize={resizeCfCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Estado</ResizableTh>}
                          {visibleCols.find((c) => c.id === 'fechaCreacion') && <ResizableTh colKey="fechaCreacion" width={cfColWidths.fechaCreacion} minWidth={100} onResize={resizeCfCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Fecha de creación</ResizableTh>}
                          {visibleCols.find((c) => c.id === 'numeroDocumento') && <ResizableTh colKey="numeroDocumento" width={cfColWidths.numeroDocumento} minWidth={80} onResize={resizeCfCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">N° Documento</ResizableTh>}
                          {visibleCols.find((c) => c.id === 'ultimaModificacion') && <ResizableTh colKey="ultimaModificacion" width={cfColWidths.ultimaModificacion} minWidth={120} onResize={resizeCfCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Última modificación</ResizableTh>}
                          {visibleCols.find((c) => c.id === 'tamano') && <ResizableTh colKey="tamano" width={cfColWidths.tamano} minWidth={60} onResize={resizeCfCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Tamaño</ResizableTh>}
                          {visibleCols.find((c) => c.id === 'etiquetas') && <ResizableTh colKey="etiquetas" width={cfColWidths.etiquetas} minWidth={80} onResize={resizeCfCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Etiquetas</ResizableTh>}
                          {visibleCols.find((c) => c.id === 'tipoDocumento') && <ResizableTh colKey="tipoDocumento" width={cfColWidths.tipoDocumento} minWidth={70} onResize={resizeCfCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Tipo</ResizableTh>}
                          {visibleCols.find((c) => c.id === 'folioInterno') && <ResizableTh colKey="folioInterno" width={cfColWidths.folioInterno} minWidth={70} onResize={resizeCfCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Folio</ResizableTh>}
                          {visibleCols.find((c) => c.id === 'fechaCompletado') && <ResizableTh colKey="fechaCompletado" width={cfColWidths.fechaCompletado} minWidth={100} onResize={resizeCfCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Completado</ResizableTh>}
                          {visibleCols.find((c) => c.id === 'fechaVencimiento') && <ResizableTh colKey="fechaVencimiento" width={cfColWidths.fechaVencimiento} minWidth={90} onResize={resizeCfCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Vencimiento</ResizableTh>}
                          {visibleCols.find((c) => c.id === 'prioridad') && <ResizableTh colKey="prioridad" width={cfColWidths.prioridad} minWidth={70} onResize={resizeCfCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Prioridad</ResizableTh>}
                          {visibleCols.find((c) => c.id === 'rutaGuardado') && <ResizableTh colKey="rutaGuardado" width={cfColWidths.rutaGuardado} minWidth={90} onResize={resizeCfCol} className="text-left text-xs font-semibold text-muted-foreground px-3 py-3 whitespace-nowrap">Ruta</ResizableTh>}
                          <th className="sticky right-0 bg-muted/40 text-left text-xs font-semibold text-muted-foreground px-3 py-3 border-l border-border shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.06)] w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {docs.map((doc) => (
                          <tr key={doc.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors group">
                            <td className="px-3 py-3 w-10">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${doc.estado === 'Rechazado' ? 'bg-red-50 border border-red-200' : doc.estado === 'Completado' ? 'bg-green-50 border border-green-200' : doc.estado === 'En proceso' ? 'bg-blue-50 border border-blue-200' : doc.estado === 'En espera' ? 'bg-orange-50 border border-orange-200' : doc.estado === 'Cancelado' ? 'bg-slate-50 border border-slate-200' : 'bg-gray-50 border border-gray-200'}`}>
                                <FileText size={16} className={getDocIconColor(doc.estado)} />
                              </div>
                            </td>
                            <td className="px-3 py-3 min-w-[200px]">
                              <div className="flex flex-col">
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => doc.isDraft ? router.push(`/crear-documento?draft=${doc.id}`) : router.push(`/visor-documento/${doc.id}`)}
                                    className="text-xs font-medium text-foreground hover:text-primary transition-colors text-left"
                                    title={doc.name}
                                  >
                                    {doc.name}
                                  </button>
                                  {doc.isFavorite && <Star size={12} className="text-yellow-400 fill-yellow-400 flex-shrink-0" />}
                                  {doc.esUrgente && <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" title="Urgente" />}
                                </div>
                                {doc.descripcion ? (
                                  <span className="text-xs text-muted-foreground">{doc.descripcion}</span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">{doc.fechaCreacion ? doc.fechaCreacion.split(' ')[0] : ''}</span>
                                )}
                              </div>
                            </td>
                            {visibleCols.find((c) => c.id === 'propietario') && <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.ownerName || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Yo'}</span></td>}
                            {visibleCols.find((c) => c.id === 'estado') && <td className="px-3 py-3"><div className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusDot(doc.estado)}`} /><span className="text-xs text-muted-foreground">{doc.estado}</span></div></td>}
                            {visibleCols.find((c) => c.id === 'fechaCreacion') && <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.fechaCreacion || '—'}</span></td>}
                            {visibleCols.find((c) => c.id === 'numeroDocumento') && <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.numeroOficio || '—'}</span></td>}
                            {visibleCols.find((c) => c.id === 'ultimaModificacion') && <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.ultimaModificacion}</span></td>}
                            {visibleCols.find((c) => c.id === 'tamano') && <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.tamano}</span></td>}
                            {visibleCols.find((c) => c.id === 'etiquetas') && <td className="px-3 py-3"><div className="flex flex-wrap gap-1">{doc.etiquetas.length > 0 ? doc.etiquetas.slice(0, 2).map((tagId, i) => { const etiqueta = etiquetasList.find((e) => e.id === String(tagId) || e.nombre === String(tagId)); const label = etiqueta ? etiqueta.nombre : String(tagId); const color = etiqueta?.color || '#6366f1'; return <span key={i} className="px-1.5 py-0.5 text-xs rounded-full font-medium" style={{ backgroundColor: `${color}20`, color, border: `1px solid ${color}40` }}>{label}</span>; }) : <span className="text-xs text-muted-foreground">—</span>}{doc.etiquetas.length > 2 && <span className="text-xs text-muted-foreground">+{doc.etiquetas.length - 2}</span>}</div></td>}
                            {visibleCols.find((c) => c.id === 'tipoDocumento') && <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.tipoDocumentoNombre || '—'}</span></td>}
                            {visibleCols.find((c) => c.id === 'folioInterno') && <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.folioInterno || '—'}</span></td>}
                            {visibleCols.find((c) => c.id === 'fechaCompletado') && <td className="px-3 py-3"><span className="text-xs text-muted-foreground">{doc.fechaCompletado || '—'}</span></td>}
                            {visibleCols.find((c) => c.id === 'fechaVencimiento') && <td className="px-3 py-3"><span className={`text-xs ${doc.fechaVencimiento ? 'text-orange-600 font-medium' : 'text-muted-foreground'}`}>{doc.fechaVencimiento ? formatDate(doc.fechaVencimiento) : '—'}</span></td>}
                            {visibleCols.find((c) => c.id === 'prioridad') && <td className="px-3 py-3">{doc.esUrgente ? <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-600">Urgente</span> : <span className="text-xs text-muted-foreground">Normal</span>}</td>}
                            {visibleCols.find((c) => c.id === 'rutaGuardado') && <td className="px-3 py-3"><span className="text-xs text-muted-foreground truncate max-w-[120px] block">{doc.rutaGuardado || '—'}</span></td>}
                            <td className="sticky right-0 bg-white px-3 py-3 border-l border-border shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.06)] w-10">
                              <button onClick={(e) => openContextMenu(e, doc)} className={`p-1.5 rounded hover:bg-muted transition-colors ${activeContextMenuDocId === doc.id && contextMenu.open ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`} title="Opciones">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                              </button>
                            </td>
                          </tr>
                        ))}
                        {docs.length === 0 && (
                          <tr>
                            <td colSpan={visibleCols.length + 3} className="px-4 py-12 text-center text-sm text-muted-foreground">
                              {cfSearch ? 'No hay documentos que coincidan con la búsqueda.' : 'No hay documentos que coincidan con este filtro.'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    </div>
                  </div>
                );
              })()}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Document context menu */}
      {renderDocContextMenu()}

      {/* Folder context menu */}
      {renderFolderContextMenu()}

      {/* Personalizar Vista Modal */}
      <PersonalizarVistaModal
        open={personalizarOpen}
        onClose={() => setPersonalizarOpen(false)}
        columns={columnConfig}
        filters={filterConfig}
        onColumnsChange={(cols) => {
          setColumnConfig(cols);
          savePreferences(cols, filterConfig);
        }}
        onFiltersChange={(fils) => {
          setFilterConfig(fils);
          savePreferences(columnConfig, fils);
        }}
        gridColumns={gridColumnConfig}
        onGridColumnsChange={(gridCols) => {
          setGridColumnConfig(gridCols);
          saveGridColumnPreferences(gridCols);
        }}
      />

      {/* Confirmation dialog for Mover a papelera */}
      {confirmPapelera.open && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setConfirmPapelera({ open: false, type: 'doc', id: null, name: '' })} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 z-10">
            <button onClick={() => setConfirmPapelera({ open: false, type: 'doc', id: null, name: '' })} className="absolute top-4 right-4 p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"><X size={16} /></button>
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mb-4"><Trash2 size={24} className="text-red-600" /></div>
            <h2 className="text-lg font-bold text-foreground mb-2">Mover a papelera</h2>
            <p className="text-sm text-muted-foreground mb-6">
              ¿Estás seguro de que deseas mover{' '}
              <span className="font-semibold text-foreground">&ldquo;{confirmPapelera.name}&rdquo;</span>{' '}
              a la papelera? Podrás restaurarlo desde la sección Papelera.
            </p>
            <div className="flex items-center gap-3 justify-end">
              <button onClick={() => setConfirmPapelera({ open: false, type: 'doc', id: null, name: '' })} className="px-4 py-2 text-sm font-semibold text-foreground border border-border rounded-lg hover:bg-muted transition-colors">Cancelar</button>
              <button onClick={handleConfirmPapelera} className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors">Mover a papelera</button>
            </div>
          </div>
        </div>
      )}

      {/* Crear Filtro Modal */}
      {showCrearFiltroModal && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center mb-5">
              <div className="flex items-center gap-2">
                <Filter size={18} className="text-primary" />
                <h2 className="text-base font-semibold text-foreground">Crear filtro personalizado</h2>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Nombre del filtro <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  autoFocus
                  value={nuevoFiltroNombre}
                  onChange={(e) => { setNuevoFiltroNombre(e.target.value); setNuevoFiltroError(''); }}
                  placeholder="Ej. Contratos urgentes"
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Descripción <span className="text-muted-foreground font-normal text-xs">(opcional)</span></label>
                <input
                  type="text"
                  value={nuevoFiltroDescripcion}
                  onChange={(e) => setNuevoFiltroDescripcion(e.target.value)}
                  placeholder="Ej. Documentos urgentes del área legal"
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Ícono</label>
                {!iconPickerOpen ? (
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 text-xl rounded-lg border-2 border-primary bg-primary/10 flex items-center justify-center">
                      {nuevoFiltroIcono}
                    </div>
                    <button onClick={() => setIconPickerOpen(true)} className="text-sm font-medium text-primary hover:underline">Cambiar</button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {['📁','⭐','🔥','📌','✅','🚨','📋','🗂️','💼','🔒','📄','📝','📊','📈','📉','🗃️','🗄️','📦','🏷️','🔖','⚡','🎯','💡','🔍','🔔','⏰','📅','🗓️','✉️','📨','💬','🤝','👥','🏢','🌐','🔗','⚙️','🛡️','🔑','💰','🧾','📜','🏆','🎖️','✍️','🖊️','📮','📬','🗺️','🧩'].map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => { setNuevoFiltroIcono(emoji); setIconPickerOpen(false); }}
                        className={`w-9 h-9 text-lg rounded-lg border-2 transition-colors flex items-center justify-center ${nuevoFiltroIcono === emoji ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40 hover:bg-muted'}`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Criterios de filtrado</label>
                <div className="border border-border rounded-xl p-3 bg-muted/20 space-y-2">
                  {nuevoFiltroCriterios.length > 0 && (
                    <div className="space-y-2 mb-2">
                      {nuevoFiltroCriterios.map((criterioId, idx) => {
                        const criterioLabels: Record<string, string> = {
                          estado: 'Estado', prioridad: 'Prioridad', tipoDocumento: 'Tipo de documento',
                          etiquetas: 'Etiquetas', fechaCreacion: 'Fecha de creación',
                          fechaUltimaModificacion: 'Fecha última modificación', fechaVencimiento: 'Fecha de vencimiento',
                          fechaCompletado: 'Fecha de completado', participantes: 'Participantes', propietario: 'Propietario',
                          estadoParticipacion: 'Estado de mi participación',
                        };
                        return (
                          <div
                            key={criterioId}
                            draggable
                            onDragStart={() => setDragCriterioIdx(idx)}
                            onDragOver={(e) => { e.preventDefault(); setDragOverCriterioIdx(idx); }}
                            onDragEnd={() => {
                              if (dragCriterioIdx !== null && dragOverCriterioIdx !== null && dragCriterioIdx !== dragOverCriterioIdx) {
                                const reordered = [...nuevoFiltroCriterios];
                                const [moved] = reordered.splice(dragCriterioIdx, 1);
                                reordered.splice(dragOverCriterioIdx, 0, moved);
                                setNuevoFiltroCriterios(reordered);
                              }
                              setDragCriterioIdx(null);
                              setDragOverCriterioIdx(null);
                            }}
                            className={`flex items-start gap-2 p-2 rounded-lg border bg-white transition-all ${dragOverCriterioIdx === idx ? 'border-primary bg-primary/5' : 'border-border'}`}
                          >
                            <div className="flex-shrink-0 mt-1 cursor-grab text-muted-foreground/50 hover:text-muted-foreground" title="Arrastrar para reordenar">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-muted-foreground mb-1">{criterioLabels[criterioId] || criterioId}</p>
                              {criterioId === 'estado' && (
                                <select value={nuevoFiltroFiltros['estado'] || ''} onChange={(e) => setNuevoFiltroFiltros((prev) => ({ ...prev, estado: e.target.value }))} style={{ fontFamily: 'inherit' }} className="w-full px-2 py-1.5 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors">
                                  <option value="">Cualquier estado</option>
                                  <option value="Borrador">Borrador</option>
                                  <option value="En proceso">En proceso</option>
                                  <option value="En espera">En espera</option>
                                  <option value="Completado">Completado</option>
                                  <option value="Rechazado">Rechazado</option>
                                  <option value="Cancelado">Cancelado</option>
                                  <option value="Vencido">Vencido</option>
                                </select>
                              )}
                              {criterioId === 'prioridad' && (
                                <select value={nuevoFiltroFiltros['prioridad'] || ''} onChange={(e) => setNuevoFiltroFiltros((prev) => ({ ...prev, prioridad: e.target.value }))} style={{ fontFamily: 'inherit' }} className="w-full px-2 py-1.5 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors">
                                  <option value="">Cualquier prioridad</option>
                                  <option value="urgente">Urgente</option>
                                  <option value="normal">Normal</option>
                                </select>
                              )}
                              {criterioId === 'tipoDocumento' && (
                                <select value={(nuevoFiltroFiltros['tipoDocumento'] || [])[0] || ''} onChange={(e) => setNuevoFiltroFiltros((prev) => ({ ...prev, tipoDocumento: e.target.value ? [e.target.value] : [] }))} style={{ fontFamily: 'inherit' }} className="w-full px-2 py-1.5 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors">
                                  <option value="">Cualquier tipo</option>
                                  {tiposDocumento.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                                </select>
                              )}
                              {criterioId === 'etiquetas' && (
                                <select value={(nuevoFiltroFiltros['etiquetas'] || [])[0] || ''} onChange={(e) => setNuevoFiltroFiltros((prev) => ({ ...prev, etiquetas: e.target.value ? [e.target.value] : [] }))} style={{ fontFamily: 'inherit' }} className="w-full px-2 py-1.5 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors">
                                  <option value="">Cualquier etiqueta</option>
                                  {etiquetasList.map((et) => <option key={et.id} value={et.nombre}>{et.nombre}</option>)}
                                </select>
                              )}
                              {criterioId === 'fechaCreacion' && (
                                <select value={nuevoFiltroFiltros['fechaCreacion'] || ''} onChange={(e) => setNuevoFiltroFiltros((prev) => ({ ...prev, fechaCreacion: e.target.value }))} style={{ fontFamily: 'inherit' }} className="w-full px-2 py-1.5 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors">
                                  <option value="">Cualquier fecha</option>
                                  <option value="today">Hoy</option>
                                  <option value="week">Últimos 7 días</option>
                                  <option value="month">Últimos 30 días</option>
                                  <option value="year">Último año</option>
                                </select>
                              )}
                              {criterioId === 'fechaUltimaModificacion' && (
                                <select value={nuevoFiltroFiltros['fechaUltimaModificacion'] || ''} onChange={(e) => setNuevoFiltroFiltros((prev) => ({ ...prev, fechaUltimaModificacion: e.target.value }))} style={{ fontFamily: 'inherit' }} className="w-full px-2 py-1.5 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors">
                                  <option value="">Cualquier fecha</option>
                                  <option value="today">Hoy</option>
                                  <option value="week">Últimos 7 días</option>
                                  <option value="month">Últimos 30 días</option>
                                  <option value="year">Último año</option>
                                </select>
                              )}
                              {criterioId === 'fechaVencimiento' && (
                                <select value={nuevoFiltroFiltros['fechaVencimiento'] || ''} onChange={(e) => setNuevoFiltroFiltros((prev) => ({ ...prev, fechaVencimiento: e.target.value }))} style={{ fontFamily: 'inherit' }} className="w-full px-2 py-1.5 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors">
                                  <option value="">Todos</option>
                                  <option value="vencido">Vencidos</option>
                                  <option value="proximos">Por vencer (72hrs)</option>
                                  <option value="sin_vencimiento">Sin vencimiento</option>
                                </select>
                              )}
                              {criterioId === 'fechaCompletado' && (
                                <select value={nuevoFiltroFiltros['fechaCompletado'] || ''} onChange={(e) => setNuevoFiltroFiltros((prev) => ({ ...prev, fechaCompletado: e.target.value }))} style={{ fontFamily: 'inherit' }} className="w-full px-2 py-1.5 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors">
                                  <option value="">Cualquier fecha</option>
                                  <option value="sin_completado">Sin completado</option>
                                  <option value="today">Hoy</option>
                                  <option value="week">Últimos 7 días</option>
                                  <option value="month">Últimos 30 días</option>
                                </select>
                              )}
                              {criterioId === 'participantes' && (
                                <select value={nuevoFiltroFiltros['participantes'] || ''} onChange={(e) => setNuevoFiltroFiltros((prev) => ({ ...prev, participantes: e.target.value }))} style={{ fontFamily: 'inherit' }} className="w-full px-2 py-1.5 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors">
                                  <option value="">Todos</option>
                                  <option value="yo">Yo</option>
                                </select>
                              )}
                              {criterioId === 'propietario' && (
                                <select value={nuevoFiltroFiltros['propietario'] || ''} onChange={(e) => setNuevoFiltroFiltros((prev) => ({ ...prev, propietario: e.target.value }))} style={{ fontFamily: 'inherit' }} className="w-full px-2 py-1.5 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors">
                                  <option value="">Todos</option>
                                  <option value="mios">Míos</option>
                                </select>
                              )}
                              {criterioId === 'estado' && (
                                <select value={nuevoFiltroFiltros['estado'] || ''} onChange={(e) => setNuevoFiltroFiltros((prev) => ({ ...prev, estado: e.target.value }))} style={{ fontFamily: 'inherit' }} className="w-full px-2 py-1.5 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors">
                                  <option value="">Cualquier estado</option>
                                  <option value="Borrador">Borrador</option>
                                  <option value="En proceso">En proceso</option>
                                  <option value="En espera">En espera</option>
                                  <option value="Completado">Completado</option>
                                  <option value="Rechazado">Rechazado</option>
                                  <option value="Cancelado">Cancelado</option>
                                  <option value="Vencido">Vencido</option>
                                </select>
                              )}
                              {criterioId === 'prioridad' && (
                                <select value={nuevoFiltroFiltros['prioridad'] || ''} onChange={(e) => setNuevoFiltroFiltros((prev) => ({ ...prev, prioridad: e.target.value }))} style={{ fontFamily: 'inherit' }} className="w-full px-2 py-1.5 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors">
                                  <option value="">Cualquier prioridad</option>
                                  <option value="urgente">Urgente</option>
                                  <option value="normal">Normal</option>
                                </select>
                              )}
                            </div>
                            <button
                              onClick={() => {
                                setNuevoFiltroCriterios((prev) => prev.filter((_, i) => i !== idx));
                                setNuevoFiltroFiltros((prev) => { const next = { ...prev }; delete next[criterioId]; return next; });
                              }}
                              className="flex-shrink-0 mt-1 p-1 rounded hover:bg-red-100 text-muted-foreground hover:text-red-500 transition-colors"
                              title="Eliminar criterio"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!showCriterioSelector ? (
                    <button
                      onClick={() => setShowCriterioSelector(true)}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-primary border border-dashed border-primary/40 rounded-lg hover:bg-primary/5 transition-colors"
                    >
                      <Plus size={14} />Agregar criterio
                    </button>
                  ) : (
                    <div className="border border-border rounded-lg bg-white shadow-sm overflow-hidden">
                      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Seleccionar criterio</p>
                        <button onClick={() => setShowCriterioSelector(false)} className="p-0.5 rounded hover:bg-muted text-muted-foreground transition-colors"><X size={12} /></button>
                      </div>
                      <div className="p-1">
                        {[
                          { id: 'estado', label: 'Estado', emoji: '🔵' },
                          { id: 'prioridad', label: 'Prioridad', emoji: '🚨' },
                          { id: 'tipoDocumento', label: 'Tipo de documento', emoji: '📄' },
                          { id: 'etiquetas', label: 'Etiquetas', emoji: '🏷️' },
                          { id: 'fechaCreacion', label: 'Fecha de creación', emoji: '📅' },
                          { id: 'fechaUltimaModificacion', label: 'Fecha última modificación', emoji: '🕐' },
                          { id: 'fechaVencimiento', label: 'Fecha de vencimiento', emoji: '⏰' },
                          { id: 'fechaCompletado', label: 'Fecha de completado', emoji: '✅' },
                          { id: 'participantes', label: 'Participantes', emoji: '👥' },
                          { id: 'propietario', label: 'Propietario', emoji: '👤' },
                        ]
                          .filter((c) => !nuevoFiltroCriterios.includes(c.id))
                          .map((criterio) => (
                            <button
                              key={criterio.id}
                              onClick={() => { setNuevoFiltroCriterios((prev) => [...prev, criterio.id]); setShowCriterioSelector(false); }}
                              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-primary/5 rounded-lg transition-colors text-left"
                            >
                              <span className="text-base">{criterio.emoji}</span>
                              {criterio.label}
                            </button>
                          ))}
                        {nuevoFiltroCriterios.length === 10 && (
                          <p className="text-xs text-muted-foreground text-center py-2">Todos los criterios han sido agregados</p>
                        )}
                      </div>
                    </div>
                  )}

                  {nuevoFiltroCriterios.length > 1 && (
                    <p className="text-xs text-muted-foreground text-center pt-1">💡 Arrastra los criterios para reordenarlos</p>
                  )}
                </div>
              </div>

              <div className="bg-primary/5 border border-primary/20 rounded-xl p-3">
                <p className="text-xs font-medium text-primary mb-1">Vista previa</p>
                <p className="text-sm text-foreground">
                  <span className="mr-1">{nuevoFiltroIcono}</span>
                  <span className="font-medium">{nuevoFiltroNombre || 'Sin nombre'}</span>
                  {' — '}
                  <span className="text-muted-foreground">
                    {(() => {
                      const count = realDocuments.filter((doc) => {
                        if (nuevoFiltroFiltros['estado'] && doc.estado !== nuevoFiltroFiltros['estado']) return false;
                        if (nuevoFiltroFiltros['prioridad'] === 'urgente' && !doc.esUrgente) return false;
                        if (nuevoFiltroFiltros['prioridad'] === 'normal' && doc.esUrgente) return false;
                        if (nuevoFiltroFiltros['tipoDocumento']?.length > 0 && !nuevoFiltroFiltros['tipoDocumento'].includes(doc.tipoDocumentoId || '')) return false;
                        return true;
                      }).length;
                      return `${count} documento(s) coinciden`;
                    })()}
                  </span>
                </p>
              </div>

              {nuevoFiltroError && <p className="text-xs text-red-500">{nuevoFiltroError}</p>}
            </div>

            <div className="flex items-center gap-2 justify-end mt-5">
              <button
                onClick={() => {
                  setShowCrearFiltroModal(false);
                  setNuevoFiltroNombre('');
                  setNuevoFiltroDescripcion('');
                  setNuevoFiltroIcono('📁');
                  setNuevoFiltroFiltros({});
                  setNuevoFiltroError('');
                  setNuevoFiltroCriterios([]);
                  setShowCriterioSelector(false);
                  setIconPickerOpen(true);
                }}
                className="px-4 py-2 text-sm font-medium text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  const nombre = nuevoFiltroNombre.trim();
                  if (!nombre) { setNuevoFiltroError('El nombre del filtro es obligatorio.'); return; }
                  const newFilter: CustomFilter = {
                    id: Date.now().toString(),
                    nombre,
                    descripcion: nuevoFiltroDescripcion.trim() || undefined,
                    icono: nuevoFiltroIcono,
                    filtros: nuevoFiltroFiltros,
                  };
                  const updated = [...customFilters, newFilter];
                  setCustomFilters(updated);
                  await saveCustomFilters(updated);
                  setActiveSection(`custom-${newFilter.id}`);
                  setShowCrearFiltroModal(false);
                  setNuevoFiltroNombre('');
                  setNuevoFiltroDescripcion('');
                  setNuevoFiltroIcono('📁');
                  setNuevoFiltroFiltros({});
                  setNuevoFiltroError('');
                  setNuevoFiltroCriterios([]);
                  setShowCriterioSelector(false);
                  setIconPickerOpen(true);
                  showToast(`Filtro "${nombre}" creado`);
                }}
                className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
              >
                Crear filtro
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Document Modal */}
      {renameModal.open && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2"><FileText size={18} className="text-primary" /><h2 className="text-base font-semibold text-foreground">Renombrar documento</h2></div>
              <button onClick={() => setRenameModal({ open: false, docId: null, currentName: '', newName: '' })} className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground"><X size={16} /></button>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-foreground mb-1.5">Nuevo nombre <span className="text-red-500">*</span></label>
              <input
                type="text"
                autoFocus
                value={renameModal.newName}
                onChange={(e) => setRenameModal((prev) => ({ ...prev, newName: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveRename()}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
              />
            </div>
            <div className="flex items-center gap-2 justify-end">
              <button onClick={() => setRenameModal({ open: false, docId: null, currentName: '', newName: '' })} className="px-4 py-2 text-sm font-medium text-foreground border border-border rounded-lg hover:bg-muted transition-colors">Cancelar</button>
              <button onClick={handleSaveRename} className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors">Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Folder Modal */}
      {renameFolderModal.open && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2"><Folder size={18} className="text-primary" /><h2 className="text-base font-semibold text-foreground">Renombrar carpeta</h2></div>
              <button onClick={() => setRenameFolderModal({ open: false, carpetaId: null, currentName: '', newName: '' })} className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground"><X size={16} /></button>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-foreground mb-1.5">Nuevo nombre <span className="text-red-500">*</span></label>
              <input
                type="text"
                autoFocus
                value={renameFolderModal.newName}
                onChange={(e) => setRenameFolderModal((prev) => ({ ...prev, newName: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveRenameFolder()}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
              />
            </div>
            <div className="flex items-center gap-2 justify-end">
              <button onClick={() => setRenameFolderModal({ open: false, carpetaId: null, currentName: '', newName: '' })} className="px-4 py-2 text-sm font-medium text-foreground border border-border rounded-lg hover:bg-muted transition-colors">Cancelar</button>
              <button onClick={handleSaveRenameFolder} className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors">Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* Move Document Modal */}
      {moveModal.open && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2"><Move size={18} className="text-primary" /><h2 className="text-base font-semibold text-foreground">Mover {moveModal.isBulk ? `${selectedRows.length} documento(s)` : `"${moveModal.docName}"`}</h2></div>
              <button onClick={() => setMoveModal({ open: false, docId: null, docName: '', isBulk: false })} className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground"><X size={16} /></button>
            </div>
            <p className="text-sm text-muted-foreground mb-3">Selecciona la carpeta destino:</p>
            <div className="max-h-48 overflow-y-auto border border-border rounded-lg divide-y divide-border">
              <button
                onClick={() => handleMoverACarpeta(null, 'Raíz')}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
              >
                <Home size={15} className="text-muted-foreground flex-shrink-0" />
                <span className="font-medium">Raíz (sin carpeta)</span>
              </button>
              {carpetas.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleMoverACarpeta(c.id, c.name)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
                >
                  <Folder size={15} className="text-yellow-500 flex-shrink-0" />
                  <span className="truncate">{c.name}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 justify-end mt-4">
              <button onClick={() => setMoveModal({ open: false, docId: null, docName: '', isBulk: false })} className="px-4 py-2 text-sm font-medium text-foreground border border-border rounded-lg hover:bg-muted transition-colors">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Move Folder Modal */}
      {moveFolderModal.open && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2"><Move size={18} className="text-primary" /><h2 className="text-base font-semibold text-foreground">Mover carpeta &ldquo;{moveFolderModal.carpetaName}&rdquo;</h2></div>
              <button onClick={() => setMoveFolderModal({ open: false, carpetaId: null, carpetaName: '' })} className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground"><X size={16} /></button>
            </div>
            <p className="text-sm text-muted-foreground mb-3">Selecciona la carpeta destino:</p>
            <div className="max-h-48 overflow-y-auto border border-border rounded-lg divide-y divide-border">
              <button
                onClick={() => handleSaveMoveFolder(null, 'Raíz')}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
              >
                <Home size={15} className="text-muted-foreground flex-shrink-0" />
                <span className="font-medium">Raíz (sin carpeta padre)</span>
              </button>
              {carpetas.filter((c) => c.id !== moveFolderModal.carpetaId).map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleSaveMoveFolder(c.id, c.name)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
                >
                  <Folder size={15} className="text-yellow-500 flex-shrink-0" />
                  <span className="truncate">{c.name}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 justify-end mt-4">
              <button onClick={() => setMoveFolderModal({ open: false, carpetaId: null, carpetaName: '' })} className="px-4 py-2 text-sm font-medium text-foreground border border-border rounded-lg hover:bg-muted transition-colors">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Crear Carpeta Modal */}
      {showCarpetaModal && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Folder size={18} className="text-primary" />
                <h2 className="text-base font-semibold text-foreground">Crear carpeta</h2>
              </div>
              <button onClick={handleCloseCarpetaModal} className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Nombre <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  autoFocus
                  value={nuevaCarpetaNombre}
                  onChange={(e) => { setNuevaCarpetaNombre(e.target.value); setCarpetaError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleCrearCarpeta()}
                  placeholder="Ej. Contratos 2024"
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Descripción</label>
                <input
                  type="text"
                  value={nuevaCarpetaDescripcion}
                  onChange={(e) => setNuevaCarpetaDescripcion(e.target.value)}
                  placeholder="Descripción de la carpeta"
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Grupo de tipo de documento <span className="text-red-500">*</span></label>
                <select
                  value={nuevaCarpetaGrupoId}
                  onChange={(e) => { setNuevaCarpetaGrupoId(e.target.value); setCarpetaError(''); }}
                  style={{ fontFamily: 'inherit' }}
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors bg-white"
                >
                  <option value="">Seleccionar grupo...</option>
                  {gruposDocumento.map((g) => (
                    <option key={g.id} value={g.id}>{g.nombre}</option>
                  ))}
                </select>
              </div>
              {carpetaError && (
                <p className="text-xs text-red-500">{carpetaError}</p>
              )}
            </div>
            <div className="flex items-center gap-2 justify-end mt-5">
              <button onClick={handleCloseCarpetaModal} className="px-4 py-2 text-sm font-medium text-foreground border border-border rounded-lg hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button
                onClick={handleCrearCarpeta}
                disabled={crearCarpetaLoading}
                className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {crearCarpetaLoading && (
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                Crear carpeta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[600] bg-foreground text-background text-sm font-medium px-5 py-3 rounded-xl shadow-xl animate-fade-in">
          {toastMsg}
        </div>
      )}
    </AppLayout>
  );
}