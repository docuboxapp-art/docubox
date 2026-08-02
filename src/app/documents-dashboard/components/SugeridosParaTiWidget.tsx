'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FileText } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentRealtime } from '@/hooks/useDocumentRealtime';

interface SuggestedDoc {
  id: string;
  name: string;
  esUrgente: boolean;
}

export default function SugeridosParaTiWidget() {
  const { user } = useAuth();
  const router = useRouter();
  const [docs, setDocs] = useState<SuggestedDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDocs = useCallback(async () => {
    if (!user) return;

    const supabase = createClient();

    const fetchParticipaciones = fetch(`/api/documentos/mis-participaciones?t=${Date.now()}`)
      .then((r) => r.json())
      .then((data) => (data.participaciones ?? []) as any[])
      .catch(() => [] as any[]);

    const fetchOwned = supabase
      .from('documentos')
      .select('id, nombre, estado, participantes, es_urgente')
      .eq('estado', 'en_proceso')
      .eq('owner_id', user.id)
      .is('deleted_at', null)
      .then(({ data }) => data ?? []);

    Promise.all([fetchParticipaciones, fetchOwned]).then(([participaciones, ownedData]) => {
      const sugeridos: SuggestedDoc[] = [];
      const addedIds = new Set<string>();

      participaciones.forEach((p: any) => {
        if (p.status !== 'en-progreso' && p.status !== 'pendiente') return;
        const sub = (p.mySignatureStatus ?? '').toLowerCase();
        const notReviewed =
          sub === 'sin revisión' ||
          sub === 'sin_revisar' ||
          sub === 'en revisión' ||
          sub === 'en_revision';
        if (notReviewed && !addedIds.has(p.supabaseId ?? p.id)) {
          sugeridos.push({
            id: p.supabaseId ?? p.id,
            name: p.documentName || p.id,
            esUrgente: p.priority === 'Urgente',
          });
          addedIds.add(p.supabaseId ?? p.id);
        }
      });

      ownedData.forEach((d: any) => {
        if (addedIds.has(d.id)) return;
        const parts: any[] = d.participantes || [];
        const esUrgente = !!d.es_urgente;
        const tieneSinRevisar = parts.some(
          (p: any) => !p.sub_estado || p.sub_estado === 'sin_revisar'
        );
        if (esUrgente || tieneSinRevisar) {
          sugeridos.push({ id: d.id, name: d.nombre || d.id, esUrgente });
          addedIds.add(d.id);
        }
      });

      sugeridos.sort((a, b) => {
        if (a.esUrgente && !b.esUrgente) return -1;
        if (!a.esUrgente && b.esUrgente) return 1;
        return 0;
      });

      setDocs(sugeridos.slice(0, 10));
      setLoading(false);
    });
  }, [user]);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  // Real-time: refresh on any documentos/participantes change for this user
  useDocumentRealtime(user?.id, loadDocs, 'sugeridos-widget');

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <h2 className="text-sm font-700 text-slate-950">Sugeridos para ti</h2>
      </div>
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
      ) : docs.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          No hay documentos sugeridos en este momento.
        </p>
      ) : (
        <div className="divide-y divide-slate-100 px-4 py-1">
          {docs.map((doc) => (
            <div
              key={doc.id}
              className="group flex cursor-pointer items-center gap-3 px-1 py-3 transition-colors hover:bg-slate-50"
              onClick={() => router.push(`/visor-documento/${doc.id}`)}
            >
              <FileText size={16} className="text-blue-500 flex-shrink-0" />
              <span className="text-sm text-foreground font-medium truncate flex-1 group-hover:text-primary transition-colors">
                {doc.name}
              </span>
              {doc.esUrgente && (
                <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full flex-shrink-0">
                  Urgente
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
