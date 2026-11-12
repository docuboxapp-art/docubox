'use client';

import { useEffect, useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { CaseWorkspace, SectionHeader } from '../components/CaseUI';

type AuditEvent = {
  id: string;
  actor_label: string;
  action: string;
  affected_object_type: string;
  occurred_at: string;
};

export default function AuditoriaExpedientesPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    createClient()
      .from('case_file_audit_events')
      .select('id,actor_label,action,affected_object_type,occurred_at')
      .order('occurred_at', { ascending: false })
      .limit(100)
      .then(({ data, error: loadError }) => {
        if (!cancelled) {
          setEvents(data || []);
          setError(Boolean(loadError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <AppLayout noPadding>
      <CaseWorkspace>
        <SectionHeader
          title="Auditoría de expedientes"
          description="Actividad registrada en los expedientes de tu espacio."
        />
        <section className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card">
          {error ? (
            <p role="alert" className="p-8 text-center text-sm text-amber-700">
              No se pudo cargar la auditoría.
            </p>
          ) : events.length ? (
            events.map((event) => (
              <div
                key={event.id}
                className="grid gap-2 p-4 text-sm md:grid-cols-[180px_1fr_180px_160px]"
              >
                <span className="text-slate-500">
                  {new Date(event.occurred_at).toLocaleString('es-MX')}
                </span>
                <span className="font-medium">{event.action}</span>
                <span>{event.actor_label}</span>
                <span className="text-slate-500">{event.affected_object_type}</span>
              </div>
            ))
          ) : (
            <p className="p-8 text-center text-sm text-slate-500">
              No hay eventos de expedientes registrados.
            </p>
          )}
        </section>
      </CaseWorkspace>
    </AppLayout>
  );
}
