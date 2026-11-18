'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
type Item = {
  id: string;
  documento_id: string;
  nombre: string;
  estado: string;
  created_at: string;
  fecha_completado: string | null;
};
export default function OrganizationDirectoryHistory({
  workspaceId,
  personId,
}: {
  workspaceId: string;
  personId: string;
}) {
  const { session } = useAuth();
  const accessToken = session?.access_token;
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoading(true);
      setError('');
      try {
        const response = await fetch(
          `/api/organizacion/directory-history?workspace_id=${workspaceId}&person_id=${personId}&page=${page}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: 'no-store',
            signal: controller.signal,
          }
        );
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'No se pudo consultar el historial.');
        if (active) {
          setData(result.data || []);
          setTotal(result.total || 0);
        }
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : 'No se pudo consultar el historial.');
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [workspaceId, personId, page, accessToken]);
  return (
    <div>
      {error ? (
        <p role="alert" className="p-5 text-sm text-red-600">
          {error}
        </p>
      ) : loading ? (
        <p className="p-10 text-center text-sm text-muted-foreground">
          Consultando documentos vinculados...
        </p>
      ) : data.length ? (
        <div className="divide-y divide-border">
          {data.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <p className="text-sm font-medium">{item.nombre}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.estado} · {new Date(item.created_at).toLocaleDateString('es-MX')}
                </p>
              </div>
              <Link
                href={`/visor-documento/${encodeURIComponent(item.documento_id || item.id)}`}
                className="text-sm text-primary"
              >
                Consultar documento
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <p className="p-10 text-center text-sm text-muted-foreground">
          No hay documentos de esta organización vinculados a esta persona.
        </p>
      )}
      {!error && total > 50 && (
        <div className="flex items-center justify-end gap-3 border-t border-border p-4 text-sm">
          <button
            type="button"
            disabled={page === 0 || loading}
            onClick={() => setPage((value) => value - 1)}
            className="organization-secondary-button"
          >
            Anterior
          </button>
          <span>
            {page + 1} de {Math.ceil(total / 50)}
          </span>
          <button
            type="button"
            disabled={(page + 1) * 50 >= total || loading}
            onClick={() => setPage((value) => value + 1)}
            className="organization-secondary-button"
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
