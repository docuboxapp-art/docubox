'use client';

import { PaginatedTableScrollArea } from '@/components/workspaces/TableScrollArea';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  ClipboardList,
  FileCheck2,
  FolderClosed,
  Loader2,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useTableOrdering } from '@/components/workspaces/useTableOrdering';
import { tableDate } from '@/lib/workspaces/list-order';
import {
  contactContributionOrigins,
  type ContactResource,
  type ContactResourceKind,
} from '@/lib/contacts/detail';
import { createClient } from '@/lib/supabase/client';
import {
  ContactPanelHeading,
  contactButton,
  contactCard,
  contactControl,
} from './contact-detail-ui';

const panels = {
  formularios: {
    title: 'Formularios del contacto',
    column: 'Formulario',
    context: 'Participación',
    date: 'Última actividad',
    icon: ClipboardList,
    empty: 'No hay formularios independientes asociados a este contacto en el espacio actual.',
  },
  expedientes: {
    title: 'Expedientes del contacto',
    column: 'Expediente',
    context: 'Rol',
    date: 'Última actividad',
    icon: FolderClosed,
    empty: 'No hay expedientes asociados a este contacto en el espacio actual.',
  },
  identidad: {
    title: 'Validaciones de identidad',
    column: 'Registro asociado',
    context: 'Proceso',
    date: 'Fecha de validación',
    icon: ShieldCheck,
    empty: 'No hay validaciones de identidad asociadas a este contacto en el espacio actual.',
  },
  aportada: {
    title: 'Documentación aportada',
    column: 'Documento aportado',
    context: 'Origen',
    date: 'Fecha de registro',
    icon: FileCheck2,
    empty: 'No hay documentación aportada por este contacto en el espacio actual.',
  },
};

const tones: Record<ContactResource['tone'], string> = {
  success: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  danger: 'bg-destructive/10 text-destructive',
  neutral: 'bg-muted text-muted-foreground',
};

export function ContactResourcesPanel({
  contactId,
  hasEmail,
  kind,
}: {
  contactId: string;
  hasEmail: boolean;
  kind: ContactResourceKind;
}) {
  const { activeWorkspace, loading } = useWorkspace();
  const workspaceId = activeWorkspace?.id;
  return (
    <ResourceList
      key={`${contactId}:${kind}:${workspaceId}`}
      {...{ contactId, workspaceId, hasEmail, kind, loading }}
    />
  );
}

function ResourceList({
  contactId,
  workspaceId,
  hasEmail,
  kind,
  loading,
}: {
  contactId: string;
  workspaceId?: string;
  hasEmail: boolean;
  kind: ContactResourceKind;
  loading: boolean;
}) {
  const config = panels[kind];
  const [result, setResult] = useState<{ rows: ContactResource[]; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [origin, setOrigin] = useState('');
  const showsOrigin = kind === 'aportada';

  useEffect(() => {
    if (!workspaceId || !hasEmail) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ workspaceId, tipo: kind });
    async function load() {
      try {
        const {
          data: { session },
        } = await createClient().auth.getSession();
        if (!session) throw new Error('Inicia sesión para consultar esta información.');
        const response = await fetch(
          `/api/contactos/${encodeURIComponent(contactId)}/actividad?${query}`,
          {
            headers: { Authorization: `Bearer ${session.access_token}` },
            cache: 'no-store',
            signal: controller.signal,
          }
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(payload?.data))
          throw new Error(payload?.error || 'No se pudo consultar esta información.');
        if (!controller.signal.aborted) setResult({ rows: payload.data });
      } catch (error) {
        if (!controller.signal.aborted)
          setResult({
            rows: [],
            error:
              error instanceof Error ? error.message : 'No se pudo consultar esta información.',
          });
      }
    }
    void load();
    return () => controller.abort();
  }, [contactId, hasEmail, kind, retry, workspaceId]);

  const rows = result?.rows || [];
  const statuses = [...new Set(rows.map((item) => item.status))].sort((left, right) =>
    left.localeCompare(right, 'es')
  );
  const needle = search.trim().toLocaleLowerCase('es-MX');
  const visible = rows
    .filter(
      (item) =>
        (!status || item.status === status) &&
        (!origin || item.origin === origin) &&
        `${item.title} ${item.reference || ''} ${item.context} ${item.description || ''} ${item.origin ? contactContributionOrigins[item.origin] : ''}`
          .toLocaleLowerCase('es-MX')
          .includes(needle)
    )
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date));
  const { orderedRows, sortHeading } = useTableOrdering(visible, {
    title: (row) => row.title,
    context: (row) => (row.origin ? contactContributionOrigins[row.origin] : row.context),
    status: (row) => row.status,
    progress: (row) => row.progress,
    date: (row) => tableDate(row.date),
  });

  return (
    <section className={contactCard}>
      <ContactPanelHeading title={config.title} icon={config.icon} />
      {!hasEmail ? (
        <p className="px-4 py-7 text-sm text-muted-foreground">
          El contacto necesita un correo para identificar su actividad.
        </p>
      ) : !workspaceId && !loading ? (
        <p className="px-4 py-7 text-sm text-muted-foreground">
          Selecciona un espacio de trabajo para consultar esta información.
        </p>
      ) : !result ? (
        <p
          role="status"
          className="flex items-center gap-2 px-4 py-7 text-sm text-muted-foreground"
        >
          <Loader2 size={16} className="animate-spin text-primary" aria-hidden="true" />{' '}
          Consultando…
        </p>
      ) : result.error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-muted-foreground"
        >
          <p>{result.error}</p>
          <button
            type="button"
            className={contactButton}
            onClick={() => {
              setStatus('');
              setOrigin('');
              setResult(null);
              setRetry((value) => value + 1);
            }}
          >
            Reintentar
          </button>
        </div>
      ) : !rows.length ? (
        <p className="px-4 py-7 text-sm text-muted-foreground">{config.empty}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
            <label className="relative min-w-0 flex-1 basis-48">
              <span className="sr-only">Buscar en {config.title.toLowerCase()}</span>
              <Search
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                size={15}
                aria-hidden="true"
              />
              <input
                type="search"
                className={`${contactControl} w-full pl-9`}
                placeholder="Buscar por nombre o folio…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            {showsOrigin && (
              <select
                aria-label="Origen"
                className={contactControl}
                value={origin}
                onChange={(event) => setOrigin(event.target.value)}
              >
                <option value="">Todos los orígenes</option>
                {Object.entries(contactContributionOrigins).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
            <select
              aria-label="Estado"
              className={contactControl}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">Todos los estados</option>
              {statuses.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            <PaginatedTableScrollArea items={orderedRows} label="Registros relacionados con el contacto">
              {(pageRows) => (
                <table className="w-full min-w-[35rem] text-left text-sm">
                  <thead className="workspace-table-heading">
                    <tr>
                      <th className="px-4 py-3" {...sortHeading('title', config.column)} />
                      <th className="px-4 py-3" {...sortHeading('context', config.context)} />
                      <th className="px-4 py-3" {...sortHeading('status', 'Estado')} />
                      {kind === 'expedientes' && (
                        <th className="px-4 py-3" {...sortHeading('progress', 'Avance', 'desc')} />
                      )}
                      <th className="px-4 py-3" {...sortHeading('date', config.date, 'asc')} />
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        Abrir
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pageRows.map((row) => (
                      <tr key={row.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium text-foreground">
                          {row.title}
                          {row.description && (
                            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                              {row.description}
                            </span>
                          )}
                          {row.reference && !showsOrigin && (
                            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                              {row.reference}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {row.origin && (
                            <span className="mb-1 block text-xs font-medium text-foreground">
                              {contactContributionOrigins[row.origin]}
                            </span>
                          )}
                          {row.context}
                          {row.reference && showsOrigin && (
                            <span className="mt-0.5 block text-xs">{row.reference}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${tones[row.tone]}`}
                          >
                            {row.status}
                          </span>
                        </td>
                        {kind === 'expedientes' && (
                          <td className="px-4 py-3 text-muted-foreground">
                            {typeof row.progress === 'number' ? `${row.progress}%` : '—'}
                          </td>
                        )}
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {row.date
                            ? new Date(row.date).toLocaleDateString('es-MX', { dateStyle: 'medium' })
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {row.action && (
                            <Link
                              href={row.action.href}
                              aria-label={`${row.action.label} ${row.title}`}
                              title={row.action.label}
                              className={`${contactButton} min-w-9 px-0 text-primary`}
                            >
                              <ArrowUpRight size={16} aria-hidden="true" />
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </PaginatedTableScrollArea>
            {!visible.length && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No hay registros que coincidan con los filtros.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
