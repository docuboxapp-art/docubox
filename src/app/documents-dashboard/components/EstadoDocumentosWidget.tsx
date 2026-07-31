'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
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

export default function EstadoDocumentosWidget() {
  const { user } = useAuth();
  const [period, setPeriod] = useState('30d');
  const [rawDocs, setRawDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();
    setLoading(true);
    try {
      // Fetch owned documents
      const { data: ownedDocs } = await supabase
        .from('documentos')
        .select('id, estado, fecha_vencimiento, created_at')
        .eq('owner_id', user.id)
        .is('deleted_at', null);

      // Fetch participant documents via API
      let participantDocs: any[] = [];
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token;
        const partRes = await fetch(`/api/documentos/mis-participaciones?t=${Date.now()}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (partRes.ok) {
          const partJson = await partRes.json();
          participantDocs = (partJson.participaciones || []).map((p: any) => ({
            id: p.supabaseId,
            estado:
              p.status === 'en-progreso'
                ? 'en_proceso'
                : p.status === 'en-espera'
                  ? 'en_espera'
                  : p.status === 'completado'
                    ? 'completado'
                    : p.status === 'cancelado'
                      ? 'cancelado'
                      : p.status === 'rechazado'
                        ? 'rechazado'
                        : 'en_proceso',
            fecha_vencimiento: p.expiresAt || null,
            created_at: p.receivedAt,
          }));
        }
      } catch (_) {
        /* ignore participant fetch errors */
      }

      // Merge: deduplicate by id (owned docs take priority)
      const ownedIds = new Set((ownedDocs ?? []).map((d: any) => d.id));
      const uniqueParticipant = participantDocs.filter((p) => !ownedIds.has(p.id));
      setRawDocs([...(ownedDocs ?? []), ...uniqueParticipant]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Real-time: refresh on any documentos/participantes change for this user
  useDocumentRealtime(user?.id, fetchAll, 'estado-docs-widget');

  const periodStart = getPeriodStartDate(period);
  const filteredDocs = periodStart
    ? rawDocs.filter((d) => {
        const created = d.created_at ? new Date(d.created_at) : null;
        return created && created >= periodStart;
      })
    : rawDocs;

  const now = new Date();
  const counts = {
    borrador: 0,
    en_proceso: 0,
    en_espera: 0,
    completado: 0,
    rechazado: 0,
    cancelado: 0,
    vencido: 0,
  };
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
    {
      label: 'Borrador',
      count: counts.borrador,
      color: 'text-slate-700',
      bg: 'bg-white',
      border: 'border-slate-200',
      iconBg: 'bg-slate-100',
      icon: (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-slate-500"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      ),
    },
    {
      label: 'En progreso',
      count: counts.en_proceso,
      color: 'text-blue-700',
      bg: 'bg-blue-50/50',
      border: 'border-blue-200',
      iconBg: 'bg-blue-100',
      icon: (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-blue-600"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      ),
    },
    {
      label: 'En espera',
      count: counts.en_espera,
      color: 'text-orange-700',
      bg: 'bg-orange-50/50',
      border: 'border-orange-200',
      iconBg: 'bg-orange-100',
      icon: (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-orange-600"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      ),
    },
    {
      label: 'Completado',
      count: counts.completado,
      color: 'text-emerald-700',
      bg: 'bg-emerald-50/50',
      border: 'border-emerald-200',
      iconBg: 'bg-emerald-100',
      icon: (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-emerald-600"
        >
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      ),
    },
    {
      label: 'Rechazado',
      count: counts.rechazado,
      color: 'text-red-700',
      bg: 'bg-red-50/50',
      border: 'border-red-200',
      iconBg: 'bg-red-100',
      icon: (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-red-600"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      ),
    },
    {
      label: 'Cancelado',
      count: counts.cancelado,
      color: 'text-slate-600',
      bg: 'bg-white',
      border: 'border-slate-200',
      iconBg: 'bg-slate-100',
      icon: (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-slate-500"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        </svg>
      ),
    },
    {
      label: 'Vencido',
      count: counts.vencido,
      color: 'text-pink-700',
      bg: 'bg-pink-50/50',
      border: 'border-pink-200',
      iconBg: 'bg-pink-100',
      icon: (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-pink-600"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      ),
    },
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-[0_18px_45px_-35px_rgba(15,23,42,0.55)] transition-all duration-200">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[13px] font-700 text-slate-900">Estado de los documentos</h2>
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-4">
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
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {items.map((s) => (
            <div
              key={s.label}
              className={`${s.bg} border ${s.border} rounded-2xl p-4 flex flex-col gap-2 min-h-[106px] justify-between shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5`}
            >
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
      )}
    </div>
  );
}
