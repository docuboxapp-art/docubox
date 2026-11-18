'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import OrganizationRecordActions from './OrganizationRecordActions';

type Row = {
  id: string;
  certificate_id: string;
  member_id: string | null;
  unit_id: string | null;
  document_types: string[];
  amount_limit: number | null;
};
type Option = { value: string; label: string };
export default function OrganizationCertificateAccess({ workspaceId }: { workspaceId: string }) {
  const { session } = useAuth();
  const accessToken = session?.access_token;
  const [rows, setRows] = useState<Row[]>([]);
  const [options, setOptions] = useState<Record<string, Option[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(
        `/api/organizacion/catalog?workspace_id=${workspaceId}&resource=certificate_access`,
        { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudieron consultar los permisos.');
      setRows(result.data || []);
      setOptions(result.options || {});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron consultar los permisos.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, accessToken]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  const label = (kind: string, id: string | null) =>
    options[kind]?.find((item) => item.value === id)?.label || 'Registro vinculado';
  return (
    <section className="rounded-lg border border-border bg-background overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
        <div>
          <h3 className="font-medium">Permisos de uso de certificados</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Define el miembro o equipo autorizado y sus límites.
          </p>
        </div>
        <OrganizationRecordActions
          resource="certificate_access"
          onSaved={load}
          label="Nuevo permiso"
        />
      </div>
      {error && (
        <p role="alert" className="p-5 text-sm text-red-600">
          {error}
        </p>
      )}
      {loading ? (
        <p className="p-10 text-center text-sm text-muted-foreground">Consultando permisos...</p>
      ) : rows.length ? (
        <div className="divide-y divide-border">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-4 p-5">
              <div className="min-w-0">
                <p className="text-sm font-medium">{label('certificates', row.certificate_id)}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {label(row.member_id ? 'members' : 'units', row.member_id || row.unit_id)} ·{' '}
                  {row.document_types?.join(', ') || 'Todos los tipos'} ·{' '}
                  {row.amount_limit === null
                    ? 'Sin límite monetario'
                    : Number(row.amount_limit).toLocaleString('es-MX')}
                </p>
              </div>
              <OrganizationRecordActions resource="certificate_access" id={row.id} onSaved={load} />
            </div>
          ))}
        </div>
      ) : (
        <p className="p-10 text-center text-sm text-muted-foreground">
          No hay permisos individuales o de equipo registrados.
        </p>
      )}
    </section>
  );
}
