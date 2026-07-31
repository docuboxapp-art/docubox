'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FileText, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentRealtime } from '@/hooks/useDocumentRealtime';

interface DocItem {
  id: string;
  name: string;
  esUrgente: boolean;
}

export default function DocumentosSinRevisionWidget() {
  const { user } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<
    'no_revisados_por_mi' | 'no_revisados_por_participantes'
  >('no_revisados_por_mi');
  const [propiosDocs, setPropiosDocs] = useState<DocItem[]>([]);
  const [participantesDocs, setParticipantesDocs] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDocs = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const supabase = createClient();
    try {
      // Fetch participaciones via API (uses service client, bypasses RLS)
      const fetchParticipaciones = fetch(`/api/documentos/mis-participaciones?t=${Date.now()}`)
        .then((r) => r.json())
        .then((data) => (data.participaciones ?? []) as any[])
        .catch(() => [] as any[]);

      // Fetch owned docs (RLS allows owner to see their own docs)
      const fetchOwned = supabase
        .from('documentos')
        .select('id, nombre, estado, participantes, es_urgente, owner_id')
        .eq('estado', 'en_proceso')
        .eq('owner_id', user.id)
        .is('deleted_at', null)
        .then(({ data }) => data ?? []);

      const [participaciones, ownedData] = await Promise.all([fetchParticipaciones, fetchOwned]);

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
          const isCurrentUser = pId === user.id || pEmail === (user.email || '').toLowerCase();
          return !isCurrentUser && (!p.sub_estado || p.sub_estado === 'sin_revisar');
        });
        if (hasParticipantSinRevisar && participantes.length < 10) {
          participantes.push({ id: d.id, name: d.nombre || d.id, esUrgente });
        }
      });

      setPropiosDocs(propios);
      setParticipantesDocs(participantes);
    } catch (_) {
      // silent
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Real-time: refresh on any documentos/participantes change for this user
  useDocumentRealtime(user?.id, loadDocs, 'sin-revision-widget');

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  const docs = activeTab === 'no_revisados_por_mi' ? propiosDocs : participantesDocs;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-[0_18px_45px_-35px_rgba(15,23,42,0.55)] transition-all duration-200">
      <div className="px-5 pt-4 pb-0 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[13px] font-700 text-slate-900">Documentos sin revisión</h2>
          <button
            onClick={loadDocs}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white hover:bg-slate-50 transition-colors text-slate-700 font-700 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Actualizar
          </button>
        </div>
        <div className="flex items-center gap-0">
          <button
            onClick={() => setActiveTab('no_revisados_por_mi')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
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
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
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
        ) : docs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            {activeTab === 'no_revisados_por_mi'
              ? 'No tienes documentos pendientes de revisión.'
              : 'Todos los participantes han revisado los documentos.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {docs.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-3 px-3 py-3 rounded-xl border border-slate-200 hover:border-primary/30 hover:bg-primary/5 transition-colors cursor-pointer group"
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
    </div>
  );
}
