'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  BarChart3, FileText, CheckCircle2, Clock, XCircle, AlertTriangle,
  Download, Calendar, TrendingUp, TrendingDown, Users, Shield,
  RefreshCw, ChevronDown, Activity, PieChart, FileCheck, Wifi,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart as RechartsPie, Pie, Cell, Legend,
} from 'recharts';
import Icon from '@/components/ui/AppIcon';


// ── Types ─────────────────────────────────────────────────────────────────────

interface DocStats {
  total: number;
  borrador: number;
  en_proceso: number;
  completado: number;
  cancelado: number;
  vencido: number;
}

interface MonthlyData {
  mes: string;
  creados: number;
  completados: number;
  cancelados: number;
}

interface TipoData {
  name: string;
  value: number;
  color: string;
}

interface ParticipantStat {
  nombre: string;
  email: string;
  total: number;
  firmados: number;
}

interface AuditEntry {
  id: string;
  action: string;
  documento_nombre: string | null;
  created_at: string;
}

interface RecentDoc {
  id: string;
  nombre: string;
  estado: string;
  created_at: string;
  tipo_documento_id: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  borrador: '#94a3b8',
  en_proceso: '#3b82f6',
  completado: '#22c55e',
  cancelado: '#ef4444',
  vencido: '#f59e0b',
};

const STATUS_LABELS: Record<string, string> = {
  borrador: 'Borrador',
  en_proceso: 'En Proceso',
  completado: 'Completado',
  cancelado: 'Cancelado',
  vencido: 'Vencido',
};

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const TIPO_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

function StatCard({
  icon: IconComp,
  label,
  value,
  sub,
  color,
  trend,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  sub?: string;
  color: string;
  trend?: { value: number; positive: boolean };
}) {
  const Icon = IconComp as React.ElementType;
  return (
    <div className="bg-white rounded-xl border border-border p-5 flex flex-col gap-3 shadow-sm">
      <div className="flex items-center justify-between">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
          <Icon size={20} className="text-white" />
        </div>
        {trend && (
          <span className={`flex items-center gap-1 text-xs font-semibold ${trend.positive ? 'text-green-600' : 'text-red-500'}`}>
            {trend.positive ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {Math.abs(trend.value)}%
          </span>
        )}
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
        <p className="text-sm font-medium text-foreground mt-0.5">{label}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ReportesPage() {
  const { user } = useAuth();
  const supabase = createClient();
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [period, setPeriod] = useState<'7d' | '30d' | '90d' | '1y'>('30d');
  const [stats, setStats] = useState<DocStats>({ total: 0, borrador: 0, en_proceso: 0, completado: 0, cancelado: 0, vencido: 0 });
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
  const [tipoData, setTipoData] = useState<TipoData[]>([]);
  const [participantStats, setParticipantStats] = useState<ParticipantStat[]>([]);
  const [recentDocs, setRecentDocs] = useState<RecentDoc[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [totalParticipants, setTotalParticipants] = useState(0);
  const [showPeriodMenu, setShowPeriodMenu] = useState(false);
  const [tipoNombres, setTipoNombres] = useState<Record<string, string>>({});

  const getPeriodStart = useCallback(() => {
    const now = new Date();
    if (period === '7d') return new Date(now.getTime() - 7 * 86400000).toISOString();
    if (period === '30d') return new Date(now.getTime() - 30 * 86400000).toISOString();
    if (period === '90d') return new Date(now.getTime() - 90 * 86400000).toISOString();
    return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString();
  }, [period]);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const periodStart = getPeriodStart();

      // ── 1. Fetch tipo_documento names ──────────────────────────────────────
      const { data: tiposRaw } = await supabase
        .from('tipo_documento')
        .select('id, nombre');
      const tiposMap: Record<string, string> = {};
      (tiposRaw || []).forEach((t: { id: string; nombre: string }) => {
        tiposMap[t.id] = t.nombre;
      });
      setTipoNombres(tiposMap);

      // ── 2. Document stats ──────────────────────────────────────────────────
      const { data: docs } = await supabase
        .from('documentos')
        .select('id, nombre, estado, created_at, tipo_documento_id, participantes, es_urgente')
        .eq('owner_id', user.id)
        .gte('created_at', periodStart)
        .order('created_at', { ascending: false });

      const allDocs = docs || [];

      const docStats: DocStats = {
        total: allDocs.length,
        borrador: allDocs.filter(d => d.estado === 'borrador').length,
        en_proceso: allDocs.filter(d => d.estado === 'en_proceso' || d.estado === 'enviado').length,
        completado: allDocs.filter(d => d.estado === 'completado').length,
        cancelado: allDocs.filter(d => d.estado === 'cancelado').length,
        vencido: allDocs.filter(d => d.estado === 'vencido').length,
      };
      setStats(docStats);

      // ── 3. Recent docs ─────────────────────────────────────────────────────
      setRecentDocs(allDocs.slice(0, 8).map(d => ({
        id: d.id,
        nombre: d.nombre,
        estado: d.estado,
        created_at: d.created_at,
        tipo_documento_id: d.tipo_documento_id,
      })));

      // ── 4. Monthly data ────────────────────────────────────────────────────
      const monthMap: Record<string, MonthlyData> = {};
      const now = new Date();
      const monthCount = period === '7d' ? 1 : period === '30d' ? 1 : period === '90d' ? 3 : 12;
      for (let i = monthCount - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthMap[key] = { mes: MONTH_NAMES[d.getMonth()], creados: 0, completados: 0, cancelados: 0 };
      }
      allDocs.forEach(doc => {
        const d = new Date(doc.created_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (monthMap[key]) {
          monthMap[key].creados++;
          if (doc.estado === 'completado') monthMap[key].completados++;
          if (doc.estado === 'cancelado') monthMap[key].cancelados++;
        }
      });
      setMonthlyData(Object.values(monthMap));

      // ── 5. Tipo documento distribution ────────────────────────────────────
      const tipoCount: Record<string, number> = {};
      allDocs.forEach(doc => {
        const tipoId = doc.tipo_documento_id;
        const tipoLabel = tipoId ? (tiposMap[tipoId] || `Tipo ${tipoId.slice(0, 6)}`) : 'Sin tipo';
        tipoCount[tipoLabel] = (tipoCount[tipoLabel] || 0) + 1;
      });
      const tipoArr: TipoData[] = Object.entries(tipoCount).map(([name, value], i) => ({
        name,
        value,
        color: TIPO_COLORS[i % TIPO_COLORS.length],
      }));
      setTipoData(tipoArr);

      // ── 6. Participant stats from participantes JSONB ──────────────────────
      const participantMap: Record<string, ParticipantStat> = {};
      allDocs.forEach(doc => {
        const parts = Array.isArray(doc.participantes) ? doc.participantes : [];
        parts.forEach((p: { nombre?: string; email?: string; estado?: string }) => {
          const email = p.email || 'desconocido';
          if (!participantMap[email]) {
            participantMap[email] = { nombre: p.nombre || email, email, total: 0, firmados: 0 };
          }
          participantMap[email].total++;
          if (p.estado === 'firmado' || p.estado === 'completado') {
            participantMap[email].firmados++;
          }
        });
      });
      const partArr = Object.values(participantMap).sort((a, b) => b.total - a.total).slice(0, 5);
      setParticipantStats(partArr);
      setTotalParticipants(Object.keys(participantMap).length);

      // ── 7. Audit / activity log ────────────────────────────────────────────
      const { data: auditRaw } = await supabase
        .from('security_audit_log')
        .select('id, action, documento_nombre, created_at')
        .eq('user_id', user.id)
        .gte('created_at', periodStart)
        .order('created_at', { ascending: false })
        .limit(10);

      if (auditRaw && auditRaw.length > 0) {
        setAuditEntries(auditRaw.map(e => ({
          id: e.id,
          action: e.action || '',
          documento_nombre: e.documento_nombre || null,
          created_at: e.created_at,
        })));
      } else {
        // Fallback: use login_activity_log
        const { data: loginLogs } = await supabase
          .from('login_activity_log')
          .select('id, action, created_at')
          .eq('user_id', user.id)
          .gte('created_at', periodStart)
          .order('created_at', { ascending: false })
          .limit(10);

        if (loginLogs && loginLogs.length > 0) {
          setAuditEntries(loginLogs.map(l => ({
            id: l.id,
            action: l.action || 'login',
            documento_nombre: null,
            created_at: l.created_at,
          })));
        } else {
          // Final fallback: use docs as activity
          setAuditEntries(
            allDocs.slice(0, 10).map(d => ({
              id: d.id,
              action: 'documento_creado',
              documento_nombre: d.nombre,
              created_at: d.created_at,
            }))
          );
        }
      }
    } catch (err) {
      console.error('Error fetching report data:', err);
    } finally {
      setLoading(false);
    }
  }, [user, getPeriodStart, supabase]);

  // ── Real-time subscription ─────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`reportes-realtime-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'documentos',
          filter: `owner_id=eq.${user.id}`,
        },
        () => {
          // Re-fetch data on any change to documentos
          fetchData();
        }
      )
      .subscribe((status) => {
        setIsLive(status === 'SUBSCRIBED');
      });

    realtimeChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      realtimeChannelRef.current = null;
      setIsLive(false);
    };
  }, [user, supabase, fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const completionRate = stats.total > 0 ? Math.round((stats.completado / stats.total) * 100) : 0;
  const periodLabel = { '7d': 'Últimos 7 días', '30d': 'Últimos 30 días', '90d': 'Últimos 90 días', '1y': 'Último año' }[period];

  const handleExportCSV = () => {
    const rows = [
      ['Estado', 'Cantidad'],
      ['Borrador', stats.borrador],
      ['En Proceso', stats.en_proceso],
      ['Completado', stats.completado],
      ['Cancelado', stats.cancelado],
      ['Vencido', stats.vencido],
      ['Total', stats.total],
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reporte-documentos-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout noPadding>
      <div className="px-4 sm:px-6 lg:px-8 pt-2 pb-4 md:pb-6 w-full space-y-6 min-h-[calc(100vh-8rem)]">
        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <BarChart3 size={24} className="text-primary" />
              Reportes e Informes
            </h1>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
              Análisis de actividad y métricas de documentos
              {isLive && (
                <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium">
                  <Wifi size={12} className="animate-pulse" />
                  En vivo
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Period selector */}
            <div className="relative">
              <button
                onClick={() => setShowPeriodMenu(!showPeriodMenu)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-white border border-border rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Calendar size={15} className="text-muted-foreground" />
                {periodLabel}
                <ChevronDown size={14} className="text-muted-foreground" />
              </button>
              {showPeriodMenu && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-border rounded-lg shadow-lg z-20 min-w-[160px]">
                  {(['7d', '30d', '90d', '1y'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => { setPeriod(p); setShowPeriodMenu(false); }}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors first:rounded-t-lg last:rounded-b-lg ${period === p ? 'text-primary font-semibold' : 'text-foreground'}`}
                    >
                      {{ '7d': 'Últimos 7 días', '30d': 'Últimos 30 días', '90d': 'Últimos 90 días', '1y': 'Último año' }[p]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={fetchData}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-white border border-border rounded-lg hover:bg-gray-50 transition-colors"
              title="Actualizar datos"
            >
              <RefreshCw size={15} className={`text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-2 px-3 py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Download size={15} />
              Exportar CSV
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="flex flex-col items-center gap-3">
              <RefreshCw size={28} className="text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">Cargando datos del reporte…</p>
            </div>
          </div>
        ) : (
          <>
            {/* ── KPI Cards ── */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 2xl:grid-cols-6 gap-4 2xl:gap-5">
              <StatCard icon={FileText} label="Total Documentos" value={stats.total} color="bg-blue-500" />
              <StatCard icon={Clock} label="En Proceso" value={stats.en_proceso} color="bg-blue-400" />
              <StatCard
                icon={CheckCircle2}
                label="Completados"
                value={stats.completado}
                sub={`${completionRate}% tasa`}
                color="bg-green-500"
              />
              <StatCard icon={FileCheck} label="Borradores" value={stats.borrador} color="bg-slate-400" />
              <StatCard icon={XCircle} label="Cancelados" value={stats.cancelado} color="bg-red-500" />
              <StatCard icon={AlertTriangle} label="Vencidos" value={stats.vencido} color="bg-amber-500" />
            </div>

            {/* ── Charts Row 1 ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 2xl:grid-cols-3 gap-6">
              {/* Monthly bar chart */}
              <div className="lg:col-span-2 bg-white rounded-xl border border-border p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                    <Activity size={16} className="text-primary" />
                    Actividad Mensual
                  </h2>
                  <span className="text-xs text-muted-foreground">{periodLabel}</span>
                </div>
                {monthlyData.length === 0 ? (
                  <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Sin datos para este período</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={monthlyData} barSize={14} barGap={4}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                        cursor={{ fill: '#f8fafc' }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="creados" name="Creados" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="completados" name="Completados" fill="#22c55e" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="cancelados" name="Cancelados" fill="#ef4444" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Status pie chart */}
              <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
                <h2 className="text-base font-semibold text-foreground flex items-center gap-2 mb-4">
                  <PieChart size={16} className="text-primary" />
                  Estado de Documentos
                </h2>
                {stats.total === 0 ? (
                  <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Sin documentos</div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={160}>
                      <RechartsPie>
                        <Pie
                          data={[
                            { name: 'Borrador', value: stats.borrador },
                            { name: 'En Proceso', value: stats.en_proceso },
                            { name: 'Completado', value: stats.completado },
                            { name: 'Cancelado', value: stats.cancelado },
                            { name: 'Vencido', value: stats.vencido },
                          ].filter(d => d.value > 0)}
                          cx="50%"
                          cy="50%"
                          innerRadius={45}
                          outerRadius={70}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {['#94a3b8', '#3b82f6', '#22c55e', '#ef4444', '#f59e0b'].map((color, i) => (
                            <Cell key={i} fill={color} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                      </RechartsPie>
                    </ResponsiveContainer>
                    <div className="space-y-1.5 mt-2">
                      {Object.entries(STATUS_LABELS).map(([key, label]) => {
                        const count = stats[key as keyof DocStats] as number;
                        if (count === 0) return null;
                        return (
                          <div key={key} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: STATUS_COLORS[key] }} />
                              <span className="text-muted-foreground">{label}</span>
                            </div>
                            <span className="font-semibold text-foreground tabular-nums">{count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ── Tipo Documento Distribution ── */}
            {tipoData.length > 0 && (
              <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
                <h2 className="text-base font-semibold text-foreground flex items-center gap-2 mb-4">
                  <FileText size={16} className="text-primary" />
                  Distribución por Tipo de Documento
                </h2>
                <div className="flex flex-wrap gap-3">
                  {tipoData.map((t, i) => (
                    <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-border">
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: t.color }} />
                      <span className="text-sm text-foreground font-medium truncate max-w-[160px]">{t.name}</span>
                      <span className="text-sm font-bold text-foreground tabular-nums ml-1">{t.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Charts Row 2 ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-2 gap-6">
              {/* Participants table */}
              <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                    <Users size={16} className="text-primary" />
                    Participantes Frecuentes
                  </h2>
                  <span className="text-xs text-muted-foreground bg-gray-100 px-2 py-0.5 rounded-full">{totalParticipants} únicos</span>
                </div>
                {participantStats.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Sin participantes en este período</div>
                ) : (
                  <div className="space-y-3">
                    {participantStats.map((p) => (
                      <div key={p.email} className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-[11px] font-bold text-primary">{p.nombre[0]?.toUpperCase()}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{p.nombre}</p>
                          <p className="text-xs text-muted-foreground truncate">{p.email}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-semibold text-foreground tabular-nums">{p.total}</p>
                          <p className="text-[10px] text-muted-foreground">{p.firmados} firmados</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent documents */}
              <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                    <FileText size={16} className="text-primary" />
                    Documentos Recientes
                  </h2>
                  <a href="/mis-documentos" className="text-xs text-primary hover:underline font-medium">Ver todos</a>
                </div>
                {recentDocs.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Sin documentos en este período</div>
                ) : (
                  <div className="space-y-2">
                    {recentDocs.map(doc => (
                      <div key={doc.id} className="flex items-center gap-3 py-1.5 border-b border-border last:border-0">
                        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                          <FileText size={14} className="text-blue-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{doc.nombre}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {new Date(doc.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </p>
                        </div>
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                          style={{
                            background: `${STATUS_COLORS[doc.estado] || '#94a3b8'}20`,
                            color: STATUS_COLORS[doc.estado] || '#94a3b8',
                          }}
                        >
                          {STATUS_LABELS[doc.estado] || doc.estado}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── Completion Rate Banner ── */}
            <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                      <TrendingUp size={16} className="text-primary" />
                      Tasa de Completación
                    </h2>
                    <span className="text-2xl font-bold text-foreground tabular-nums">{completionRate}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-3">
                    <div
                      className="h-3 rounded-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-700"
                      style={{ width: `${completionRate}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                    <span>{stats.completado} completados de {stats.total} totales</span>
                    <span>{periodLabel}</span>
                  </div>
                </div>
                <div className="flex gap-4 sm:gap-6 flex-shrink-0">
                  <div className="text-center">
                    <p className="text-xl font-bold text-green-600 tabular-nums">{stats.completado}</p>
                    <p className="text-[10px] text-muted-foreground">Completados</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-blue-500 tabular-nums">{stats.en_proceso}</p>
                    <p className="text-[10px] text-muted-foreground">En Proceso</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-amber-500 tabular-nums">{stats.vencido}</p>
                    <p className="text-[10px] text-muted-foreground">Vencidos</p>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Audit / Activity Log ── */}
            <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                  <Shield size={16} className="text-primary" />
                  Registro de Actividad
                </h2>
                <span className="text-xs text-muted-foreground">{auditEntries.length} eventos</span>
              </div>
              {auditEntries.length === 0 ? (
                <div className="flex items-center justify-center h-20 text-muted-foreground text-sm">Sin actividad registrada</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground">Acción</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground">Documento</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-muted-foreground">Fecha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditEntries.map(entry => (
                        <tr key={entry.id} className="border-b border-border last:border-0 hover:bg-gray-50 transition-colors">
                          <td className="py-2 px-3">
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                              <Activity size={12} className="text-primary flex-shrink-0" />
                              {(entry.action || '').replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-xs text-muted-foreground max-w-[200px] truncate">
                            {entry.documento_nombre || '—'}
                          </td>
                          <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(entry.created_at).toLocaleDateString('es-MX', {
                              day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
