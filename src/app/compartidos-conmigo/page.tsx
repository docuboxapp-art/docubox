'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Eye, RefreshCw } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

type SharedDocument = {
  id: string;
  name: string;
  ownerName: string;
  completedAt: string | null;
  accessLevel: 'view' | 'download' | 'evidence';
};

const levelLabels = {
  view: 'Solo visualizar',
  download: 'Visualizar y descargar',
  evidence: 'Documento y evidencias',
};

export default function SharedDocumentsPage() {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<SharedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    let active = true;
    const load = async () => {
      try {
        const { data } = await createClient().auth.getSession();
        const response = await fetch('/api/documentos/compartidos-conmigo', {
          headers: { Authorization: `Bearer ${data.session?.access_token || ''}` },
          cache: 'no-store',
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'No fue posible cargar los documentos.');
        if (active) setDocuments(payload.documents || []);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Error al cargar.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [user]);

  return <AppLayout>
    <div className="mx-auto w-full max-w-5xl px-5 py-6">
      <h1 className="text-xl font-semibold text-slate-900">Compartidos conmigo</h1>
      {loading ? <div className="mt-8 flex items-center gap-2 text-sm text-slate-500"><RefreshCw size={16} className="animate-spin" /> Cargando documentos…</div>
        : error ? <p className="mt-6 text-sm text-red-700" role="alert">{error}</p>
        : documents.length === 0 ? <p className="mt-8 text-sm text-slate-500">No tienes documentos compartidos.</p>
        : <div className="mt-5 divide-y divide-slate-200 border-y border-slate-200">
          {documents.map((document) => <Link key={document.id} href={`/visor-documento/${document.id}`}
            className="flex items-center gap-3 py-4 hover:bg-slate-50">
            <FileText size={18} className="shrink-0 text-blue-600" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">{document.name}</p>
              <p className="text-xs text-slate-500">Compartido por {document.ownerName}</p>
            </div>
            <span className="hidden text-xs text-slate-500 sm:inline">{levelLabels[document.accessLevel] || 'Solo visualizar'}</span>
            <Eye size={16} className="shrink-0 text-slate-500" />
          </Link>)}
        </div>}
    </div>
  </AppLayout>;
}
