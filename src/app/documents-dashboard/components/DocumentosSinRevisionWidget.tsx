'use client';

import React, { useMemo, useState } from 'react';
import { FileText, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface DocItem {
  id: string;
  name: string;
  esUrgente: boolean;
}

export default function DocumentosSinRevisionWidget({
  ownedDocs,
  participaciones,
  loading,
  onRefresh,
  userId,
  userEmail,
}: {
  ownedDocs: any[];
  participaciones: any[];
  loading: boolean;
  onRefresh: () => void;
  userId: string;
  userEmail: string;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<
    'no_revisados_por_mi' | 'no_revisados_por_participantes'
  >('no_revisados_por_mi');
  const { propiosDocs, participantesDocs } = useMemo(() => {
    const ownedData = ownedDocs.filter((document: any) => document.estado === 'en_proceso');
    const propios: DocItem[] = [];
    const participantes: DocItem[] = [];

      // No revisados por mí: participaciones where my sub_estado is sin_revisar
      participaciones.forEach((p: any) => {
        if (p.status !== 'en-progreso' && p.status !== 'pendiente') return;
        const sub = (p.mySignatureStatus ?? '').toLowerCase();
        const isSinRevisar = sub === 'sin revisión' || sub === 'sin_revisar';
        if (isSinRevisar && propios.length < 10) {
          propios.push({
            id: p.supabaseId ?? p.id,
            name: p.documentName || p.id,
            esUrgente: p.priority === 'Urgente',
          });
        }
      });

      // No revisados por participantes: owned docs where other participants have sin_revisar
      ownedData.forEach((d: any) => {
        const parts: any[] = d.participantes || [];
        const esUrgente = !!d.es_urgente;
        const hasParticipantSinRevisar = parts.some((p: any) => {
          const pId = p.id || p.user_id || p.userId;
          const pEmail = (p.email || '').toLowerCase();
          const isCurrentUser = pId === userId || pEmail === userEmail;
          return !isCurrentUser && (!p.sub_estado || p.sub_estado === 'sin_revisar');
        });
        if (hasParticipantSinRevisar && participantes.length < 10) {
          participantes.push({ id: d.id, name: d.nombre || d.id, esUrgente });
        }
      });

    return { propiosDocs: propios, participantesDocs: participantes };
  }, [ownedDocs, participaciones, userEmail, userId]);

  const docs = activeTab === 'no_revisados_por_mi' ? propiosDocs : participantesDocs;

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-700 text-slate-950">Documentos sin revisión</h2>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-600 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Actualizar
          </button>
        </div>
      </div>
      <div className="px-5">
        <div className="grid grid-cols-2">
          <button
            onClick={() => setActiveTab('no_revisados_por_mi')}
            className={`flex min-w-0 items-center justify-center gap-1 border-b-2 px-2 py-2.5 text-center text-[11px] font-600 leading-tight transition-colors -mb-px ${
              activeTab === 'no_revisados_por_mi'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            No revisados por mí
            <span
              className={`ml-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-full ${activeTab === 'no_revisados_por_mi' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}
            >
              {propiosDocs.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('no_revisados_por_participantes')}
            className={`flex min-w-0 items-center justify-center gap-1 border-b-2 px-2 py-2.5 text-center text-[11px] font-600 leading-tight transition-colors -mb-px ${
              activeTab === 'no_revisados_por_participantes'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            No revisados por participantes
            <span
              className={`ml-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-full ${activeTab === 'no_revisados_por_participantes' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}
            >
              {participantesDocs.length}
            </span>
          </button>
        </div>
      </div>
      <div className="p-4">
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
            {activeTab === 'no_revisados_por_mi'
              ? 'No tienes documentos pendientes de revisión.'
              : 'Todos los participantes han revisado los documentos.'}
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {docs.map((doc) => (
              <div
                key={doc.id}
                className="group flex cursor-pointer items-center gap-3 px-1 py-3 transition-colors hover:bg-slate-50"
                onClick={() => router.push(`/visor-documento/${doc.id}`)}
              >
                <FileText size={16} className="text-amber-500 flex-shrink-0" />
                <span className="text-sm text-foreground font-medium truncate flex-1 group-hover:text-primary transition-colors">
                  {doc.name}
                </span>
                <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full flex-shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                  Sin revisar
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
      </div>
    </section>
  );
}
