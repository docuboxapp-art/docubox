'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { CaseWorkspace, SectionHeader } from '../components/CaseUI';

type ReviewItem = { id: string; case_file_id: string; title: string; status: string };

export default function RevisionDocumentalPage() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    createClient()
      .from('case_file_requirements')
      .select('id,case_file_id,title,status')
      .in('status', ['uploaded', 'in_review', 'observed'])
      .order('updated_at', { ascending: false })
      .then(({ data, error: loadError }) => {
        if (!cancelled) {
          setItems(data || []);
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
          title="Revisión documental"
          description="Documentos de expedientes que requieren atención."
        />
        <section className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:border-border dark:bg-card">
          {error ? (
            <p role="alert" className="p-8 text-center text-sm text-amber-700">
              No se pudo cargar la revisión documental.
            </p>
          ) : items.length ? (
            items.map((item) => (
              <Link
                key={item.id}
                href={`/expedientes/${item.case_file_id}?tab=documentos`}
                className="flex items-center justify-between gap-4 p-4 hover:bg-slate-50 dark:hover:bg-muted/30"
              >
                <span className="text-sm font-medium">{item.title}</span>
                <span className="text-xs text-slate-500">
                  {item.status === 'observed' ? 'Observado' : 'En revisión'}
                </span>
              </Link>
            ))
          ) : (
            <p className="p-8 text-center text-sm text-slate-500">
              No hay documentos pendientes de revisión.
            </p>
          )}
        </section>
      </CaseWorkspace>
    </AppLayout>
  );
}
