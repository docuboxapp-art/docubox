'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  XCircle,
  Upload,
  Send,
  AlertTriangle,
  Clock,
  Shield,
  FileText,
  UserCheck,
  Bell,
  Eye,
  Lock,
  RefreshCw,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Search,
  AlertCircle,
  Activity,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';

// ─── Types ────────────────────────────────────────────────────────────────────

type TimeFilter = 'hoy' | '7dias' | '30dias' | '90dias' | 'todos';

interface AuditEvent {
  id: string;
  action_code: string;
  action_category: string;
  action_description_es: string;
  action_result: 'exitoso' | 'fallido' | 'parcial' | 'pendiente';
  actor_name: string | null;
  actor_email: string | null;
  actor_role: string;
  document_status_at_action: string | null;
  is_legal_event: boolean;
  action_at: string;
  document_id: string;
  document_name?: string;
}

interface ExpirationAlert {
  id: string;
  nombre: string;
  fecha_vencimiento: string;
  estado: string;
  daysLeft: number;
}

interface AuditLogEntry {
  id: string;
  accion: string;
  documento_nombre: string;
  documento_id: string | null;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  let h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'p.m.' : 'a.m.';
  h = h % 12 || 12;
  return `${dd}/${mm}/${yyyy} ${String(h).padStart(2, '0')}:${min} ${ampm}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Ahora mismo';
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Ayer';
  return `Hace ${days} días`;
}

function getDaysLeft(fechaVencimiento: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const exp = new Date(fechaVencimiento);
  exp.setHours(0, 0, 0, 0);
  return Math.ceil((exp.getTime() - now.getTime()) / 86400000);
}

// ─── Event Icon Config ────────────────────────────────────────────────────────

function getEventConfig(
  actionCode: string,
  category: string
): { icon: React.ReactNode; bg: string; dot: string } {
  if (actionCode.includes('firma_completada') || actionCode.includes('aprobacion_otorgada')) {
    return {
      icon: <CheckCircle2 size={13} className="text-emerald-600" />,
      bg: 'bg-emerald-50',
      dot: 'bg-emerald-500',
    };
  }
  if (
    actionCode.includes('rechazada') ||
    actionCode.includes('rechazado') ||
    actionCode.includes('fallido') ||
    actionCode.includes('denegado')
  ) {
    return {
      icon: <XCircle size={13} className="text-red-600" />,
      bg: 'bg-red-50',
      dot: 'bg-red-500',
    };
  }
  if (actionCode.includes('documento_creado') || actionCode.includes('subido')) {
    return {
      icon: <Upload size={13} className="text-blue-600" />,
      bg: 'bg-blue-50',
      dot: 'bg-blue-500',
    };
  }
  if (
    actionCode.includes('invitacion') ||
    actionCode.includes('recordatorio') ||
    actionCode.includes('notificacion')
  ) {
    return {
      icon: <Send size={13} className="text-primary" />,
      bg: 'bg-primary/10',
      dot: 'bg-primary',
    };
  }
  if (actionCode.includes('vencido') || actionCode.includes('vencimiento')) {
    return {
      icon: <Clock size={13} className="text-orange-600" />,
      bg: 'bg-orange-50',
      dot: 'bg-orange-500',
    };
  }
  if (actionCode.includes('nom151') || actionCode.includes('blockchain')) {
    return {
      icon: <Shield size={13} className="text-teal-600" />,
      bg: 'bg-teal-50',
      dot: 'bg-teal-500',
    };
  }
  if (actionCode.includes('participante')) {
    return {
      icon: <UserCheck size={13} className="text-violet-600" />,
      bg: 'bg-violet-50',
      dot: 'bg-violet-500',
    };
  }
  if (
    actionCode.includes('abierto') ||
    actionCode.includes('visto') ||
    actionCode.includes('descarga')
  ) {
    return {
      icon: <Eye size={13} className="text-slate-600" />,
      bg: 'bg-slate-100',
      dot: 'bg-slate-400',
    };
  }
  if (category === 'seguridad') {
    return {
      icon: <Lock size={13} className="text-red-600" />,
      bg: 'bg-red-50',
      dot: 'bg-red-500',
    };
  }
  if (actionCode.includes('firma_iniciada') || actionCode.includes('otp')) {
    return {
      icon: <RefreshCw size={13} className="text-amber-600" />,
      bg: 'bg-amber-50',
      dot: 'bg-amber-500',
    };
  }
  return {
    icon: <FileText size={13} className="text-gray-500" />,
    bg: 'bg-gray-100',
    dot: 'bg-gray-400',
  };
}

function getResultBadge(result: string) {
  switch (result) {
    case 'exitoso':
      return (
        <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
          Exitoso
        </span>
      );
    case 'fallido':
      return (
        <span className="text-[10px] font-medium text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full">
          Fallido
        </span>
      );
    case 'parcial':
      return (
        <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
          Parcial
        </span>
      );
    case 'pendiente':
      return (
        <span className="text-[10px] font-medium text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">
          Pendiente
        </span>
      );
    default:
      return null;
  }
}

// ─── Category Labels ──────────────────────────────────────────────────────────

const TIME_LABELS: Record<TimeFilter, string> = {
  hoy: 'Hoy',
  '7dias': 'Últimos 7 días',
  '30dias': 'Últimos 30 días',
  '90dias': 'Últimos 90 días',
  todos: 'Todo el historial',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ActivityAuditLog() {
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();

  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLogEntries, setAuditLogEntries] = useState<AuditLogEntry[]>([]);
  const [expirationAlerts, setExpirationAlerts] = useState<ExpirationAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const [timeFilter, setTimeFilter] = useState<TimeFilter>('30dias');
  const [searchQuery, setSearchQuery] = useState('');
  const [showTimeDropdown, setShowTimeDropdown] = useState(false);
  const [activeTab, setActiveTab] = useState<'actividad' | 'alertas'>('actividad');
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState<10 | 30 | 50 | 100>(10);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const supabase = createClient();

    // Time range calculation
    const now = new Date();
    let fromDate: Date | null = null;
    if (timeFilter === 'hoy') {
      fromDate = new Date(now);
      fromDate.setHours(0, 0, 0, 0);
    } else if (timeFilter === '7dias') {
      fromDate = new Date(now.getTime() - 7 * 86400000);
    } else if (timeFilter === '30dias') {
      fromDate = new Date(now.getTime() - 30 * 86400000);
    } else if (timeFilter === '90dias') {
      fromDate = new Date(now.getTime() - 90 * 86400000);
    }

    try {
      // 1. Load activity: document-related events only (no login/access logs)
      const activityEntries: AuditLogEntry[] = [];

      // 1a. Document lifecycle events from documentos table (owned by user)
      let docsQuery = supabase
        .from('documentos')
        .select('id, nombre, estado, created_at, updated_at, ultimo_paso')
        .eq('owner_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(30);
      if (fromDate) docsQuery = docsQuery.gte('created_at', fromDate.toISOString());
      const { data: docsData } = await docsQuery;
      if (docsData) {
        for (const doc of docsData) {
          // Creation event
          if (!fromDate || new Date(doc.created_at) >= fromDate) {
            activityEntries.push({
              id: `doc_created_${doc.id}`,
              accion: 'Documento creado',
              documento_nombre: doc.nombre || doc.id,
              documento_id: doc.id,
              created_at: doc.created_at,
            });
          }
          // State change event (if updated_at differs from created_at)
          if (doc.updated_at && doc.updated_at !== doc.created_at) {
            const estadoLabel: Record<string, string> = {
              borrador: 'Guardado como borrador',
              en_proceso: 'Documento enviado a participantes',
              en_espera: 'Documento en espera de firma',
              completado: 'Documento completado',
              rechazado: 'Documento rechazado',
              cancelado: 'Documento cancelado',
              vencido: 'Documento vencido',
            };
            activityEntries.push({
              id: `doc_updated_${doc.id}`,
              accion: estadoLabel[doc.estado] || `Estado actualizado: ${doc.estado}`,
              documento_nombre: doc.nombre || doc.id,
              documento_id: doc.id,
              created_at: doc.updated_at,
            });
          }
        }
      }

      // 1b. Participation events (documents where user is a participant)
      const { data: partDocs } = await supabase
        .from('documentos')
        .select('id, nombre, participantes, updated_at')
        .neq('owner_id', user.id)
        .not('participantes', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(20);
      if (partDocs) {
        for (const doc of partDocs) {
          const parts: any[] = Array.isArray(doc.participantes) ? doc.participantes : [];
          const myPart = parts.find((p: any) => p.user_id === user.id || p.email === user.email);
          if (myPart && myPart.sub_estado && myPart.sub_estado !== 'sin_revisar') {
            const subEstadoLabel: Record<string, string> = {
              en_revision: 'Documento revisado',
              firmo: 'Documento firmado',
              rechazo: 'Documento rechazado',
              aprobo: 'Documento aprobado',
              cancelo: 'Participación cancelada',
            };
            activityEntries.push({
              id: `part_${doc.id}_${myPart.sub_estado}`,
              accion: subEstadoLabel[myPart.sub_estado] || `Participación: ${myPart.sub_estado}`,
              documento_nombre: doc.nombre || doc.id,
              documento_id: doc.id,
              created_at: doc.updated_at,
            });
          }
        }
      }

      // Sort all activity entries by date descending and deduplicate
      const seen = new Set<string>();
      const uniqueEntries = activityEntries
        .filter((e) => {
          if (seen.has(e.id)) return false;
          seen.add(e.id);
          return true;
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 80);
      setAuditLogEntries(uniqueEntries);

      // 2. Load expiration alerts from documentos
      const workspaceId = activeWorkspace?.id;
      if (workspaceId) {
        const alertQuery = supabase
          .from('documentos')
          .select('id, nombre, fecha_vencimiento, estado')
          .eq('workspace_id', workspaceId)
          .not('fecha_vencimiento', 'is', null)
          .in('estado', ['en_proceso', 'en_espera', 'borrador'])
          .order('fecha_vencimiento', { ascending: true });
        const { data: alertData, error: alertError } = await alertQuery;
        if (!alertError && alertData) {
          const alerts: ExpirationAlert[] = alertData.map((d: any) => ({
            id: d.id,
            nombre: d.nombre || 'Sin nombre',
            fecha_vencimiento: d.fecha_vencimiento,
            estado: d.estado,
            daysLeft: getDaysLeft(d.fecha_vencimiento),
          }));
          setExpirationAlerts(alerts);
        }
      }
    } catch (_) {
      // silent
    } finally {
      setLoading(false);
    }
  }, [user, activeWorkspace, timeFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  // ─── Filtered data ──────────────────────────────────────────────────────────

  const filteredAuditLog = auditLogEntries.filter((item) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.accion?.toLowerCase().includes(q) || item.documento_nombre?.toLowerCase().includes(q)
    );
  });
  const auditPageCount = Math.max(1, Math.ceil(filteredAuditLog.length / auditPageSize));
  const activeAuditPage = Math.min(auditPage, auditPageCount);
  const auditPageStart = (activeAuditPage - 1) * auditPageSize;
  const visibleAuditLog = filteredAuditLog.slice(auditPageStart, auditPageStart + auditPageSize);

  // ─── Render ─────────────────────────────────────────────────────────────────

  const overdueCount = expirationAlerts.filter((a) => a.daysLeft < 0).length;
  const urgentCount = expirationAlerts.filter((a) => a.daysLeft >= 0 && a.daysLeft <= 3).length;

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      {/* Header */}
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-sm font-700 text-slate-950">Bitácora de actividad y auditoría</h2>
          <button
            onClick={loadData}
            disabled={loading}
            className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-600 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Actualizar
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-5">
        <div className="flex items-center gap-5">
          {(
            [
              { key: 'actividad', label: 'Actividad', count: filteredAuditLog.length },
              {
                key: 'alertas',
                label: 'Alertas de Vencimiento',
                count: expirationAlerts.length,
                urgent: overdueCount + urgentCount,
              },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
                setAuditPage(1);
              }}
              className={`flex items-center gap-1.5 border-b-2 px-0 py-2.5 text-sm font-600 transition-colors -mb-px ${
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                    activeTab === tab.key
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {tab.count}
                </span>
              )}
              {'urgent' in tab && tab.urgent > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">
                  {tab.urgent} urgente{tab.urgent > 1 ? 's' : ''}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            placeholder="Buscar eventos..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setAuditPage(1);
            }}
            className="h-8 w-full rounded-md border border-slate-200 bg-white pl-8 pr-3 text-xs transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
          />
        </div>

        {/* Time filter */}
        <div className="relative">
          <button
            onClick={() => {
              setShowTimeDropdown((v) => !v);
            }}
            className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-600 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            <Calendar size={12} className="text-muted-foreground" />
            {TIME_LABELS[timeFilter]}
            <ChevronDown size={11} className="text-muted-foreground" />
          </button>
          {showTimeDropdown && (
            <div className="absolute left-0 top-full z-50 mt-1 min-w-[168px] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-[0_14px_35px_-20px_rgba(15,23,42,0.4)]">
              {(Object.keys(TIME_LABELS) as TimeFilter[]).map((key) => (
                <button
                  key={key}
                  onClick={() => {
                    setTimeFilter(key);
                    setAuditPage(1);
                    setShowTimeDropdown(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors ${timeFilter === key ? 'text-primary font-semibold' : 'text-foreground'}`}
                >
                  {TIME_LABELS[key]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="divide-y divide-slate-100">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10">
            <svg
              className="animate-spin h-4 w-4 text-primary"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <span className="text-sm text-muted-foreground">Cargando registros...</span>
          </div>
        ) : (
          <>
            {/* ── Tab: Actividad ── */}
            {activeTab === 'actividad' && (
              <>
                {filteredAuditLog.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-2">
                    <Activity size={28} className="text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">
                      No hay actividad en el período seleccionado.
                    </p>
                  </div>
                ) : (
                  visibleAuditLog.map((item) => {
                    const cfg = getEventConfig(item.accion?.toLowerCase() || '', '');
                    return (
                      <div
                        key={item.id}
                        className="px-5 py-3.5 transition-colors hover:bg-slate-50/80"
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${cfg.bg}`}
                          >
                            {cfg.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-foreground">{item.accion}</p>
                            {item.documento_nombre && (
                              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                                {item.documento_nombre}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {timeAgo(item.created_at)}
                            </span>
                            <span className="text-[10px] text-muted-foreground/60">
                              {formatDateTime(item.created_at)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                {filteredAuditLog.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
                    <span className="text-xs text-slate-500">
                      Mostrando {auditPageStart + 1}-
                      {Math.min(auditPageStart + auditPageSize, filteredAuditLog.length)} de{' '}
                      {filteredAuditLog.length} eventos
                    </span>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-xs text-slate-500">
                        Registros por página
                        <select
                          value={auditPageSize}
                          onChange={(event) => {
                            setAuditPageSize(Number(event.target.value) as 10 | 30 | 50 | 100);
                            setAuditPage(1);
                          }}
                          className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-600 text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                          aria-label="Registros por página"
                        >
                          {[10, 30, 50, 100].map((size) => (
                            <option key={size} value={size}>
                              {size}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={() => setAuditPage((page) => Math.max(1, page - 1))}
                        disabled={activeAuditPage === 1}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                        title="Página anterior"
                        aria-label="Página anterior"
                      >
                        <ChevronLeft size={15} />
                      </button>
                      <span className="min-w-12 text-center text-xs font-600 text-slate-700">
                        {activeAuditPage} de {auditPageCount}
                      </span>
                      <button
                        type="button"
                        onClick={() => setAuditPage((page) => Math.min(auditPageCount, page + 1))}
                        disabled={activeAuditPage === auditPageCount}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                        title="Página siguiente"
                        aria-label="Página siguiente"
                      >
                        <ChevronRight size={15} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── Tab: Alertas de Vencimiento ── */}
            {activeTab === 'alertas' && (
              <>
                {expirationAlerts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-2">
                    <Bell size={28} className="text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">
                      No hay documentos próximos a vencer.
                    </p>
                    <p className="text-xs text-muted-foreground/70">
                      Se muestran documentos que vencen en los próximos 7 días.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Summary pills */}
                    <div className="px-5 py-3 bg-muted/20 flex items-center gap-2 flex-wrap">
                      {overdueCount > 0 && (
                        <span className="flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full">
                          <AlertCircle size={11} />
                          {overdueCount} vencido{overdueCount > 1 ? 's' : ''}
                        </span>
                      )}
                      {urgentCount > 0 && (
                        <span className="flex items-center gap-1 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-full">
                          <AlertTriangle size={11} />
                          {urgentCount} urgente{urgentCount > 1 ? 's' : ''} (≤72 horas)
                        </span>
                      )}
                      {expirationAlerts.filter((a) => a.daysLeft > 3 && a.daysLeft <= 7).length >
                        0 && (
                        <span className="flex items-center gap-1 text-xs font-medium text-orange-700 bg-orange-50 border border-orange-200 px-2.5 py-1 rounded-full">
                          <Clock size={11} />
                          {
                            expirationAlerts.filter((a) => a.daysLeft > 3 && a.daysLeft <= 7).length
                          }{' '}
                          vence en 4–7 días
                        </span>
                      )}
                      {expirationAlerts.filter((a) => a.daysLeft > 7).length > 0 && (
                        <span className="flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
                          <Clock size={11} />
                          {expirationAlerts.filter((a) => a.daysLeft > 7).length} próximos
                        </span>
                      )}
                    </div>

                    {expirationAlerts.map((alert) => {
                      const isOverdue = alert.daysLeft < 0;
                      const isUrgent72h = alert.daysLeft >= 0 && alert.daysLeft <= 3;
                      const isSoon = alert.daysLeft > 3 && alert.daysLeft <= 7;
                      const borderColor = isOverdue
                        ? 'border-l-red-500'
                        : isUrgent72h
                          ? 'border-l-rose-500'
                          : isSoon
                            ? 'border-l-orange-400'
                            : 'border-l-amber-300';
                      const bgColor = isOverdue
                        ? 'bg-red-50/40'
                        : isUrgent72h
                          ? 'bg-rose-50/40'
                          : isSoon
                            ? 'bg-orange-50/30'
                            : 'bg-amber-50/20';
                      const iconColor = isOverdue
                        ? 'text-red-600'
                        : isUrgent72h
                          ? 'text-rose-600'
                          : isSoon
                            ? 'text-orange-500'
                            : 'text-amber-500';
                      const iconBg = isOverdue
                        ? 'bg-red-100'
                        : isUrgent72h
                          ? 'bg-rose-100'
                          : isSoon
                            ? 'bg-orange-100'
                            : 'bg-amber-50';

                      return (
                        <div
                          key={alert.id}
                          className={`px-5 py-3.5 border-l-4 ${borderColor} ${bgColor} hover:brightness-[0.98] transition-all`}
                        >
                          <div className="flex items-start gap-3">
                            <div
                              className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${iconBg}`}
                            >
                              {isOverdue ? (
                                <AlertCircle size={13} className={iconColor} />
                              ) : isUrgent72h ? (
                                <AlertTriangle size={13} className={iconColor} />
                              ) : (
                                <Clock size={13} className={iconColor} />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-xs font-semibold text-foreground truncate">
                                  {alert.nombre}
                                </p>
                                {isUrgent72h && (
                                  <span className="text-[10px] font-bold text-rose-700 bg-rose-100 border border-rose-200 px-1.5 py-0.5 rounded-full flex-shrink-0">
                                    ⚡ Urgente
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                <span className={`text-[11px] font-medium ${iconColor}`}>
                                  {isOverdue
                                    ? `Venció hace ${Math.abs(alert.daysLeft)} día${Math.abs(alert.daysLeft) !== 1 ? 's' : ''}`
                                    : alert.daysLeft === 0
                                      ? '⚠️ Vence hoy'
                                      : alert.daysLeft === 1
                                        ? 'Vence mañana'
                                        : `Vence en ${alert.daysLeft} día${alert.daysLeft !== 1 ? 's' : ''}`}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  ·{' '}
                                  {new Date(alert.fecha_vencimiento).toLocaleDateString('es-MX', {
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric',
                                  })}
                                </span>
                              </div>
                            </div>
                            <div className="flex-shrink-0">
                              <span
                                className={`text-[10px] font-medium px-2 py-0.5 rounded-full capitalize ${
                                  alert.estado === 'en_proceso'
                                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                    : alert.estado === 'en_espera'
                                      ? 'bg-orange-50 text-orange-700 border border-orange-200'
                                      : 'bg-gray-100 text-gray-600 border border-gray-200'
                                }`}
                              >
                                {alert.estado.replace('_', ' ')}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/40 px-5 py-3">
        <p className="text-[11px] text-muted-foreground">
          {activeTab === 'actividad' &&
            `${filteredAuditLog.length} evento${filteredAuditLog.length !== 1 ? 's' : ''} · ${TIME_LABELS[timeFilter]}`}
          {activeTab === 'alertas' &&
            `${expirationAlerts.length} documento${expirationAlerts.length !== 1 ? 's' : ''} con vencimiento · ${urgentCount} urgente${urgentCount !== 1 ? 's' : ''} (≤72h)`}
        </p>
      </div>
    </section>
  );
}
