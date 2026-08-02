'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import ReportsWorkspace, {
  ReportAuditEntry,
  ReportDocument,
  ReportMonthlyData,
  ReportParticipant,
  ReportStats,
} from './components/ReportsWorkspace';

type Period = '7d' | '30d' | '90d' | '1y';

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const EMPTY_STATS: ReportStats = {
  total: 0,
  borrador: 0,
  en_proceso: 0,
  completado: 0,
  cancelado: 0,
  vencido: 0,
};

export default function ReportesPage() {
  const { user } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [period, setPeriod] = useState<Period>('30d');
  const [stats, setStats] = useState<ReportStats>(EMPTY_STATS);
  const [documents, setDocuments] = useState<ReportDocument[]>([]);
  const [monthlyData, setMonthlyData] = useState<ReportMonthlyData[]>([]);
  const [participants, setParticipants] = useState<ReportParticipant[]>([]);
  const [auditEntries, setAuditEntries] = useState<ReportAuditEntry[]>([]);
  const [typeNames, setTypeNames] = useState<Record<string, string>>({});

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
      const [{ data: typesRaw }, { data: docsRaw }, { data: auditRaw }] = await Promise.all([
        supabase.from('tipo_documento').select('id, nombre'),
        supabase
          .from('documentos')
          .select('id, nombre, estado, created_at, tipo_documento_id, participantes, es_urgente')
          .eq('owner_id', user.id)
          .gte('created_at', periodStart)
          .order('created_at', { ascending: false }),
        supabase
          .from('security_audit_log')
          .select('id, action, documento_nombre, created_at')
          .eq('user_id', user.id)
          .gte('created_at', periodStart)
          .order('created_at', { ascending: false })
          .limit(100),
      ]);

      const mappedTypeNames: Record<string, string> = {};
      (typesRaw || []).forEach((type: { id: string; nombre: string }) => {
        mappedTypeNames[type.id] = type.nombre;
      });
      setTypeNames(mappedTypeNames);

      const allDocuments = (docsRaw || []) as ReportDocument[];
      setDocuments(allDocuments);
      setStats({
        total: allDocuments.length,
        borrador: allDocuments.filter((document) => document.estado === 'borrador').length,
        en_proceso: allDocuments.filter((document) => document.estado === 'en_proceso' || document.estado === 'enviado').length,
        completado: allDocuments.filter((document) => document.estado === 'completado').length,
        cancelado: allDocuments.filter((document) => document.estado === 'cancelado').length,
        vencido: allDocuments.filter((document) => document.estado === 'vencido').length,
      });

      const now = new Date();
      const monthMap: Record<string, ReportMonthlyData> = {};

      const firstMonth = new Date(periodStart);
      const monthCursor = new Date(firstMonth.getFullYear(), firstMonth.getMonth(), 1);
      const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      while (monthCursor <= currentMonth) {
        const key = `${monthCursor.getFullYear()}-${String(monthCursor.getMonth() + 1).padStart(2, '0')}`;
        monthMap[key] = {
          mes: MONTH_NAMES[monthCursor.getMonth()],
          creados: 0,
          completados: 0,
          cancelados: 0,
        };
        monthCursor.setMonth(monthCursor.getMonth() + 1);
      }

      allDocuments.forEach((document) => {
        const date = new Date(document.created_at);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!monthMap[key]) return;
        monthMap[key].creados += 1;
        if (document.estado === 'completado') monthMap[key].completados += 1;
        if (document.estado === 'cancelado') monthMap[key].cancelados += 1;
      });
      setMonthlyData(Object.values(monthMap));

      const participantMap = new Map<string, ReportParticipant>();
      allDocuments.forEach((document) => {
        const documentParticipants = Array.isArray(document.participantes) ? document.participantes : [];
        documentParticipants.forEach((participant: { nombre?: string; email?: string; estado?: string }) => {
          const email = participant.email || 'sin-correo';
          const current = participantMap.get(email) || {
            nombre: participant.nombre || email,
            email,
            total: 0,
            firmados: 0,
          };
          current.total += 1;
          if (participant.estado === 'firmado' || participant.estado === 'completado') current.firmados += 1;
          participantMap.set(email, current);
        });
      });
      setParticipants(Array.from(participantMap.values()).sort((a, b) => b.total - a.total));

      if (auditRaw?.length) {
        setAuditEntries(auditRaw.map((entry) => ({
          id: entry.id,
          action: entry.action || 'evento',
          documento_nombre: entry.documento_nombre || null,
          created_at: entry.created_at,
        })));
      } else {
        const { data: loginLogs } = await supabase
          .from('login_activity_log')
          .select('id, action, created_at')
          .eq('user_id', user.id)
          .gte('created_at', periodStart)
          .order('created_at', { ascending: false })
          .limit(100);

        if (loginLogs?.length) {
          setAuditEntries(loginLogs.map((entry) => ({
            id: entry.id,
            action: entry.action || 'inicio_sesion',
            documento_nombre: null,
            created_at: entry.created_at,
          })));
        } else {
          setAuditEntries(allDocuments.map((document) => ({
            id: document.id,
            action: 'documento_creado',
            documento_nombre: document.nombre,
            created_at: document.created_at,
          })));
        }
      }
    } catch (error) {
      console.error('Error loading reporting data:', error);
      setDocuments([]);
      setMonthlyData([]);
      setParticipants([]);
      setAuditEntries([]);
      setStats(EMPTY_STATS);
    } finally {
      setLoading(false);
    }
  }, [getPeriodStart, period, supabase, user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
        fetchData
      )
      .subscribe((status) => setIsLive(status === 'SUBSCRIBED'));

    return () => {
      supabase.removeChannel(channel);
      setIsLive(false);
    };
  }, [fetchData, supabase, user]);

  return (
    <AppLayout noPadding>
      <div className="-mx-4 -my-4 min-h-[calc(100vh-4rem)] bg-[#f6f8fb] px-4 py-4 sm:px-5 md:-my-6 md:py-5 lg:px-6">
        <ReportsWorkspace
          loading={loading}
          isLive={isLive}
          period={period}
          onPeriodChange={setPeriod}
          onRefresh={fetchData}
          stats={stats}
          documents={documents}
          monthlyData={monthlyData}
          participants={participants}
          auditEntries={auditEntries}
          typeNames={typeNames}
        />
      </div>
    </AppLayout>
  );
}
