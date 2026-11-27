'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Loader2, Search } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import AppLogo from '@/components/ui/AppLogo';
import { caseRequest } from '@/lib/case-files/runtime-client';
import LaunchDialog from './LaunchDialog';
type Choice = {
  id: string;
  name: string;
  description: string;
  case_type: string;
  publication_version: number;
};
export default function TemplateChooser({ initialContactId }: { initialContactId?: string }) {
  const { loading: authLoading } = useAuth();
  const { activeWorkspace, loading: workspaceLoading, refreshWorkspaces } = useWorkspace(),
    router = useRouter(),
    [items, setItems] = useState<Choice[]>([]),
    [selected, setSelected] = useState(''),
    [query, setQuery] = useState(''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!activeWorkspace?.id) {
      if (!workspaceLoading && !authLoading) {
        const timer = window.setTimeout(() => {
          setLoading(false);
          setError('Selecciona un espacio de trabajo activo para lanzar un expediente.');
        }, 0);
        return () => window.clearTimeout(timer);
      }
      return;
    }
    let live = true;
    caseRequest<Choice[]>(`/api/expedientes/catalogo?workspaceId=${activeWorkspace.id}`)
      .then((v) => {
        if (live) {
          setItems(v);
          setError('');
        }
      })
      .catch(() => {
        if (live) setError('No se pudieron cargar los tipos publicados.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [activeWorkspace?.id, workspaceLoading, authLoading, retry]);
  const visible = items.filter((i) =>
    `${i.name} ${i.case_type}`.toLowerCase().includes(query.toLowerCase())
  );
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-5">
        <AppLogo />
      </header>
      <LaunchDialog
        title="Selecciona un expediente publicado"
        description="Elige la estructura que utilizarás para este lanzamiento."
        onClose={() => router.push('/expedientes')}
        footer={
          <>
            <button
              onClick={() => router.push('/expedientes')}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm"
            >
              Cancelar
            </button>
            <button
              disabled={!selected || loading}
              onClick={() =>
                router.replace(
                  `/expedientes/lanzar?${new URLSearchParams({ tipo: selected, ...(initialContactId && { contact: initialContactId }) })}`
                )
              }
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Continuar
            </button>
          </>
        }
      >
        <label className="relative block">
          <Search size={17} className="absolute left-3 top-3 text-slate-400" />
          <input
            type="search"
            aria-label="Buscar tipo de expediente"
            placeholder="Buscar expedientes..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 w-full rounded-lg border border-slate-200 pl-10 pr-3 text-sm"
          />
        </label>
        {loading ? (
          <div className="flex justify-center p-12">
            <Loader2 className="animate-spin text-primary" />
          </div>
        ) : error ? (
          <p role="alert" className="mt-5 text-sm text-red-600">
            {error}
            <button
              className="ml-3 underline"
              onClick={() => {
                setLoading(true);
                if (!activeWorkspace?.id) void refreshWorkspaces();
                setRetry((v) => v + 1);
              }}
            >
              Reintentar
            </button>
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {visible.map((i) => (
              <button
                key={i.id}
                onClick={() => setSelected(i.id)}
                aria-pressed={selected === i.id}
                className={`flex w-full gap-3 rounded-lg border p-4 text-left ${selected === i.id ? 'border-primary bg-blue-50' : 'border-slate-200'}`}
              >
                <FileText size={22} className="shrink-0 text-primary" />
                <span>
                  <span className="block text-sm font-semibold">
                    {i.name}
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      v{i.publication_version}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {i.case_type || 'Sin especificar'}
                  </span>
                  {i.description && (
                    <span className="mt-2 block text-sm text-slate-500">{i.description}</span>
                  )}
                </span>
              </button>
            ))}
            {!visible.length && (
              <p className="py-10 text-center text-sm text-slate-500">
                {items.length
                  ? 'No hay expedientes publicados con esta búsqueda.'
                  : 'No hay expedientes publicados para lanzar en este espacio.'}
              </p>
            )}
          </div>
        )}
      </LaunchDialog>
    </div>
  );
}
