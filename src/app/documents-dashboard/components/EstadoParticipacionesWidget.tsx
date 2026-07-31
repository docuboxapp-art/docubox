'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { useDocumentRealtime } from '@/hooks/useDocumentRealtime';

const PERIOD_OPTIONS = [
  { value: '7d', label: 'Últimos 7 días' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: '90d', label: 'Últimos 90 días' },
  { value: 'all', label: 'Todo el tiempo' },
];

function getPeriodStartDate(period: string): Date | null {
  const now = new Date();
  if (period === '7d') return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (period === '30d') return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (period === '90d') return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  return null;
}

function PeriodFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = PERIOD_OPTIONS.find((o) => o.value === value) || PERIOD_OPTIONS[1];

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
        className="flex items-center gap-1.5 px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white hover:bg-slate-50 transition-colors text-slate-700 font-700"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-muted-foreground flex-shrink-0"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <span>{selected.label}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-muted-foreground"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-border rounded-xl shadow-lg min-w-[160px] py-1">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
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

export default function EstadoParticipacionesWidget() {
  const { user } = useAuth();
  const [period, setPeriod] = useState('30d');
  // participaciones: docs where I am a participant (from API, bypasses RLS)
  const [participaciones, setParticipaciones] = useState<any[]>([]);
  // ownedDocs: docs I own (direct Supabase query is fine since owner can see their own docs)
  const [ownedDocs, setOwnedDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'mis_participaciones' | 'participantes_en_mis_docs'>(
    'mis_participaciones'
  );

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    // Fetch participaciones via API (uses service client, bypasses RLS)
    const fetchParticipaciones = fetch(`/api/documentos/mis-participaciones?t=${Date.now()}`)
      .then((r) => r.json())
      .then((data) => data.participaciones ?? [])
      .catch(() => []);

    // Fetch owned docs via Supabase (RLS allows owner to see their own docs)
    const supabase = createClient();
    const fetchOwned = supabase
      .from('documentos')
      .select('id, estado, fecha_vencimiento, created_at, participantes, owner_id, es_urgente')
      .eq('owner_id', user.id)
      .is('deleted_at', null)
      .then(({ data }) => data ?? []);

    Promise.all([fetchParticipaciones, fetchOwned]).then(([parts, owned]) => {
      setParticipaciones(parts);
      setOwnedDocs(owned);
      setLoading(false);
    });
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Real-time: refresh on any documentos/participantes change for this user
  useDocumentRealtime(user?.id, fetchData, 'estado-participaciones-widget');

  const periodStart = getPeriodStartDate(period);

  // Filter participaciones by period
  const filteredParticipaciones = periodStart
    ? participaciones.filter((p: any) => {
        const created = p.receivedAt ? new Date(p.receivedAt) : null;
        return created && created >= periodStart;
      })
    : participaciones;

  // Filter owned docs by period
  const filteredOwned = periodStart
    ? ownedDocs.filter((d: any) => {
        const created = d.created_at ? new Date(d.created_at) : null;
        return created && created >= periodStart;
      })
    : ownedDocs;

  const now = new Date();
  const in72h = new Date(now.getTime() + 72 * 60 * 60 * 1000);

  // Count mis participaciones from API data
  let sinRevisarCount = 0,
    enRevisionCount = 0,
    firmadoCount = 0,
    rechazadoCount = 0,
    aprobadoCount = 0,
    canceladoCount = 0,
    urgenteCount = 0,
    vencidaCount = 0;

  filteredParticipaciones.forEach((p: any) => {
    const fechaVenc = p.expiresAt ? new Date(p.expiresAt) : null;
    const isVencido = p.status === 'vencido' || (fechaVenc && fechaVenc < now);
    const isUrgente = fechaVenc && fechaVenc >= now && fechaVenc <= in72h;

    const sub = (p.mySignatureStatus ?? '').toLowerCase();

    if (isVencido) {
      vencidaCount++;
    } else if (isUrgente) {
      urgenteCount++;
    } else if (sub === 'sin revisión' || sub === 'sin_revisar') sinRevisarCount++;
    else if (sub === 'en revisión' || sub === 'en_revision') enRevisionCount++;
    else if (sub === 'firmado') firmadoCount++;
    else if (sub === 'rechazado') rechazadoCount++;
    else if (sub === 'aprobado') aprobadoCount++;
    else if (sub === 'cancelado') canceladoCount++;
    else enRevisionCount++; // default
  });

  // Count participantes en mis docs from owned docs
  let partSinRevisarCount = 0,
    partEnRevisionCount = 0,
    partFirmadoCount = 0,
    partRechazadoCount = 0,
    partAprobadoCount = 0,
    partUrgenteCount = 0,
    partVencidaCount = 0;

  filteredOwned.forEach((d: any) => {
    const parts: any[] = d.participantes || [];
    const fechaVenc = d.fecha_vencimiento ? new Date(d.fecha_vencimiento) : null;
    const isVencido = fechaVenc && fechaVenc < now;
    const isUrgente = fechaVenc && fechaVenc >= now && fechaVenc <= in72h;

    parts.forEach((p: any) => {
      const pId = p.id || p.user_id || p.userId;
      const pEmail = (p.email || '').toLowerCase();
      if (pId === user?.id || pEmail === (user?.email || '').toLowerCase()) return; // skip self
      const sub = p.sub_estado || 'sin_revisar';
      if (isVencido) {
        partVencidaCount++;
      } else if (isUrgente) {
        partUrgenteCount++;
      } else if (sub === 'sin_revisar') partSinRevisarCount++;
      else if (sub === 'en_revision') partEnRevisionCount++;
      else if (sub === 'firmo' || sub === 'firmado') partFirmadoCount++;
      else if (sub === 'rechazo' || sub === 'rechazado') partRechazadoCount++;
      else if (sub === 'aprobo' || sub === 'aprobado') partAprobadoCount++;
      else partSinRevisarCount++;
    });
  });

  const misParticipacionesItems = [
    {
      label: 'Sin revisar',
      count: sinRevisarCount,
      color: 'text-amber-700',
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      dot: 'bg-amber-400',
      desc: 'Documentos que no has abierto',
    },
    {
      label: 'En revisión',
      count: enRevisionCount,
      color: 'text-cyan-700',
      bg: 'bg-cyan-50',
      border: 'border-cyan-200',
      dot: 'bg-cyan-500',
      desc: 'Abiertos sin participación',
    },
    {
      label: 'Firmé',
      count: firmadoCount,
      color: 'text-green-700',
      bg: 'bg-green-50',
      border: 'border-green-200',
      dot: 'bg-green-500',
      desc: 'Documentos firmados',
    },
    {
      label: 'Rechacé',
      count: rechazadoCount,
      color: 'text-red-700',
      bg: 'bg-red-50',
      border: 'border-red-200',
      dot: 'bg-red-500',
      desc: 'Participación rechazada',
    },
    {
      label: 'Aprobé',
      count: aprobadoCount,
      color: 'text-blue-700',
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      dot: 'bg-blue-500',
      desc: 'Documentos aprobados',
    },
    {
      label: 'Cancelé',
      count: canceladoCount,
      color: 'text-slate-600',
      bg: 'bg-slate-100',
      border: 'border-slate-300',
      dot: 'bg-slate-400',
      desc: 'Documentos cancelados',
    },
    {
      label: 'Urgente',
      count: urgenteCount,
      color: 'text-rose-700',
      bg: 'bg-rose-50',
      border: 'border-rose-300',
      dot: 'bg-rose-500',
      desc: 'Vencen en menos de 72h',
    },
    {
      label: 'Vencida',
      count: vencidaCount,
      color: 'text-gray-600',
      bg: 'bg-gray-100',
      border: 'border-gray-300',
      dot: 'bg-gray-500',
      desc: 'Participación expirada',
    },
  ];

  const participantesEnMisDocsItems = [
    {
      label: 'Sin revisar',
      count: partSinRevisarCount,
      color: 'text-amber-700',
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      dot: 'bg-amber-400',
      desc: 'No han abierto el documento',
    },
    {
      label: 'En revisión',
      count: partEnRevisionCount,
      color: 'text-cyan-700',
      bg: 'bg-cyan-50',
      border: 'border-cyan-200',
      dot: 'bg-cyan-500',
      desc: 'Abierto sin participar',
    },
    {
      label: 'Han firmado',
      count: partFirmadoCount,
      color: 'text-green-700',
      bg: 'bg-green-50',
      border: 'border-green-200',
      dot: 'bg-green-500',
      desc: 'Han firmado el documento',
    },
    {
      label: 'Han rechazado',
      count: partRechazadoCount,
      color: 'text-red-700',
      bg: 'bg-red-50',
      border: 'border-red-200',
      dot: 'bg-red-500',
      desc: 'Han rechazado el documento',
    },
    {
      label: 'Han aprobado',
      count: partAprobadoCount,
      color: 'text-blue-700',
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      dot: 'bg-blue-500',
      desc: 'Han aprobado el documento',
    },
    {
      label: 'Urgente',
      count: partUrgenteCount,
      color: 'text-rose-700',
      bg: 'bg-rose-50',
      border: 'border-rose-300',
      dot: 'bg-rose-500',
      desc: 'Vencen en menos de 72h',
    },
    {
      label: 'Vencida',
      count: partVencidaCount,
      color: 'text-gray-600',
      bg: 'bg-gray-100',
      border: 'border-gray-300',
      dot: 'bg-gray-500',
      desc: 'Plazo de participación expirado',
    },
  ];

  const items =
    activeTab === 'mis_participaciones' ? misParticipacionesItems : participantesEnMisDocsItems;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-[0_18px_45px_-35px_rgba(15,23,42,0.55)] transition-all duration-200">
      <div className="px-5 pt-4 pb-0 border-b border-slate-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[13px] font-700 text-slate-900">Estado de participaciones</h2>
          <PeriodFilter value={period} onChange={setPeriod} />
        </div>
        <div className="flex items-center gap-0">
          <button
            onClick={() => setActiveTab('mis_participaciones')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === 'mis_participaciones'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Mis participaciones
          </button>
          <button
            onClick={() => setActiveTab('participantes_en_mis_docs')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === 'participantes_en_mis_docs'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Participantes en mis docs
          </button>
        </div>
      </div>
      <div className="p-5">
        {loading ? (
          <div className="flex items-center gap-2 py-2">
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
            <span className="text-sm text-muted-foreground">Cargando...</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {items.map((s) => (
              <div
                key={s.label}
                className={`${s.bg} border ${s.border} rounded-2xl p-3.5 flex flex-col gap-1.5 relative overflow-hidden min-h-[92px] justify-between shadow-sm hover:shadow-md transition-all`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${s.dot}`} />
                  <span className={`text-xs font-semibold ${s.color}`}>{s.label}</span>
                </div>
                <span className={`text-2xl font-bold ${s.color}`}>{s.count}</span>
                <span className="text-[10px] text-muted-foreground leading-tight">{s.desc}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
