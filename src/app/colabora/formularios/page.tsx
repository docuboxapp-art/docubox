'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ClipboardList, Loader2, Plus, RefreshCw, Search, Send, ListChecks } from 'lucide-react';
import { useTableOrdering } from '@/components/workspaces/useTableOrdering';
import ResizableTableHeader from '@/components/workspaces/ResizableTableHeader';
import TableScrollArea from '@/components/workspaces/TableScrollArea';
import TablePagination, { useTablePagination } from '@/components/workspaces/TablePagination';
import { orderedTableCells } from '@/components/workspaces/useColumnReorder';
import { useTableColumnLayout } from '@/components/workspaces/useTableColumnLayout';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCollaboration } from '@/contexts/CollaborationContext';
import { useCollaborationApi } from '@/lib/collaboration/client';
import { tableDate } from '@/lib/workspaces/list-order';

type FormRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  updated_at: string;
  version_number: number;
  response_count: number;
  request_count: number;
};
const statusLabel: Record<string, string> = {
  draft: 'Borrador',
  published: 'Publicado',
  paused: 'Pausado',
  archived: 'Archivado',
};
const columns = [
  { id: 'name', label: 'Formulario' },
  { id: 'status', label: 'Estado' },
  { id: 'requests', label: 'Solicitudes', defaultDirection: 'desc' },
  { id: 'responses', label: 'Respuestas', defaultDirection: 'desc' },
  { id: 'updated', label: 'Actualización', defaultDirection: 'desc' },
] as const;
export default function CollaborationFormsPage() {
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const { can } = useCollaboration();
  const api = useCollaborationApi();
  const tableLayout = useTableColumnLayout(columns, {
    table: 'colabora-formularios',
    userId: user?.id,
    workspaceId: activeWorkspace?.id,
    primaryId: 'name',
  });
  const [data, setData] = useState<FormRow[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!activeWorkspace?.id) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoading(true);
      setError('');
      try {
        const result = await api<{ data: FormRow[] }>(
          `/api/colabora/forms?workspace_id=${activeWorkspace.id}`
        );
        if (active) setData(result.data);
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error ? cause.message : 'No se pudieron consultar los formularios.'
          );
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [activeWorkspace?.id, api, revision]);
  const rows = data.filter(
    (row) =>
      (!status || row.status === status) &&
      `${row.name} ${row.description || ''}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase())
  );
  const { orderedRows, sortHeading } = useTableOrdering(rows, {
    name: (row) => row.name,
    status: (row) => statusLabel[row.status] || row.status,
    requests: (row) => row.request_count,
    responses: (row) => row.response_count,
    updated: (row) => tableDate(row.updated_at),
  });
  const pagination = useTablePagination(orderedRows.length, JSON.stringify([search, status]));
  const pageRows = orderedRows.slice(pagination.start, pagination.end);
  return (
    <div className="app-page-width space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div>
          <h2 className="text-xl font-medium">Formularios</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Solicita formularios al equipo o a invitados y consulta sus respuestas desde Colabora.
          </p>
        </div>
        {can('requests.create', true) && (
          <Link href="/formularios/nuevo" className="colabora-primary-button">
            <Plus size={16} />
            Nuevo formulario
          </Link>
        )}
      </header>
      <section className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-4">
        <label className="relative min-w-48 flex-1">
          <Search size={16} className="absolute left-3 top-3 text-muted-foreground" />
          <input
            aria-label="Buscar formularios"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar formularios..."
            className="colabora-input pl-9"
          />
        </label>
        <select
          aria-label="Estado del formulario"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-10 rounded-md border border-border bg-background px-3 text-sm"
        >
          <option value="">Todos los estados</option>
          {Object.entries(statusLabel).map(([key, label]) => (
            <option key={key} value={key}>
              {label} ({data.filter((row) => row.status === key).length})
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Actualizar formularios"
          onClick={() => setRevision((value) => value + 1)}
          className="colabora-icon-button"
          disabled={loading}
        >
          <RefreshCw size={16} />
        </button>
      </section>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      <section className="overflow-hidden rounded-lg border border-border bg-background">
        {loading ? (
          <div className="grid min-h-64 place-items-center">
            <Loader2 size={23} className="animate-spin text-primary" />
          </div>
        ) : rows.length ? (
          <TableScrollArea
            label="Tabla de formularios de Colabora"
            footer={<TablePagination {...pagination} />}
          >
            <table className="workspace-actions-table w-full text-left text-sm">
              <thead className="workspace-table-heading">
                <tr>
                  {tableLayout.columns.map((column) => {
                    const { id, label } = column;
                    const heading = sortHeading(
                      id,
                      label,
                      'defaultDirection' in column ? column.defaultDirection : 'asc'
                    );
                    return (
                      <ResizableTableHeader
                        key={id}
                        {...tableLayout.headerProps(column)}
                        className="px-5 py-3"
                        ariaSort={heading['aria-sort']}
                      >
                        {heading.children}
                      </ResizableTableHeader>
                    );
                  })}
                  <th scope="col" className="workspace-table-actions py-3">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border xl:divide-y-0">
                {pageRows.map((row) => (
                  <tr key={row.id}>
                    {orderedTableCells(tableLayout.columns, {
                      name: (
                        <td className="px-5 py-4">
                          <div className="flex items-start gap-3">
                            <ClipboardList size={18} className="mt-1 shrink-0 text-primary" />
                            <div>
                              <p className="font-medium">{row.name}</p>
                              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                                {row.description || `Versión ${row.version_number || 1}`}
                              </p>
                            </div>
                          </div>
                        </td>
                      ),
                      status: (
                        <td className="px-5 py-4">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs ${row.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground'}`}
                          >
                            {statusLabel[row.status] || row.status}
                          </span>
                        </td>
                      ),
                      requests: <td className="px-5 py-4">{row.request_count}</td>,
                      responses: <td className="px-5 py-4">{row.response_count}</td>,
                      updated: (
                        <td className="px-5 py-4 text-xs text-muted-foreground">
                          {new Date(row.updated_at).toLocaleDateString('es-MX')}
                        </td>
                      ),
                    })}
                    <td className="workspace-table-actions py-4">
                      <div className="inline-flex items-center gap-2">
                        <Link
                          aria-label={`Ver respuestas de ${row.name}`}
                          href={`/formularios/respuestas?id=${row.id}`}
                          className="colabora-icon-button"
                          title="Ver respuestas"
                        >
                          <ListChecks size={16} />
                        </Link>
                        {can('requests.create', true) && row.status === 'published' && (
                          <Link
                            aria-label={`Solicitar ${row.name}`}
                            href={`/colabora/solicitudes?new=1&form_id=${row.id}`}
                            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-primary"
                          >
                            <Send size={15} />
                            Solicitar
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollArea>
        ) : (
          <div className="p-14 text-center text-sm text-muted-foreground">
            {search || status
              ? 'No hay formularios con esos filtros.'
              : 'Los formularios de tu organización aparecerán aquí.'}
          </div>
        )}
      </section>
    </div>
  );
}
