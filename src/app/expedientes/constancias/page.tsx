'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { CaseWorkspace, SectionHeader } from '../components/CaseUI';

type Certificate = {
  id: string;
  case_file_id: string;
  certificate_number: string;
  closed_at: string;
};

export default function ConstanciasPage() {
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    createClient()
      .from('case_file_closure_certificates')
      .select('id,case_file_id,certificate_number,closed_at')
      .order('closed_at', { ascending: false })
      .then(({ data, error: loadError }) => {
        if (!cancelled) {
          setCertificates(data || []);
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
          title="Constancias de cierre"
          description="Constancias generadas por expedientes cerrados."
        />
        <section className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card">
          {error ? (
            <p role="alert" className="p-8 text-center text-sm text-amber-700">
              No se pudieron cargar las constancias.
            </p>
          ) : certificates.length ? (
            certificates.map((item) => (
              <Link
                key={item.id}
                href={`/expedientes/${item.case_file_id}?tab=cierre`}
                className="flex items-center justify-between gap-4 p-4 hover:bg-slate-50 dark:hover:bg-muted/30"
              >
                <span className="text-sm font-medium">{item.certificate_number}</span>
                <span className="text-xs text-slate-500">
                  {new Date(item.closed_at).toLocaleDateString('es-MX')}
                </span>
              </Link>
            ))
          ) : (
            <p className="p-8 text-center text-sm text-slate-500">
              No hay constancias de cierre generadas.
            </p>
          )}
        </section>
      </CaseWorkspace>
    </AppLayout>
  );
}
