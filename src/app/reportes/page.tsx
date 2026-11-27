'use client';

import { BottomNotice } from '@/components/ui/BottomNotice';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  BarChart3,
  ChevronDown,
  FileText,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import WorkspacePageHeader from '@/components/workspaces/WorkspacePageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useSummaryExpansion } from '@/hooks/useSummaryExpansion';
import { createClient } from '@/lib/supabase/client';
import {
  DATASETS,
  datasetIds,
  type DatasetId,
  type ReportDefinition,
} from '@/lib/reporting/catalog';
import { fetchReportCount, listReportPresets, listSavedReports } from '@/lib/reporting/client';
import { searchableReportText } from '@/lib/reporting/engine';
import { compareListDates } from '@/lib/workspaces/list-order';
import { reportCard, reportControl, reportError, reportPrimary } from './components/styles';

export default function ReportesPage() {
  const { user, loading: authLoading } = useAuth();
  const { activeWorkspace, loading: workspaceLoading } = useWorkspace();
  return (
    <AppLayout>
      <WorkspacePageHeader
        title="Reportes"
        description="Consulta informes del espacio y crea análisis con datos actualizados."
      >
        {activeWorkspace && user && (
          <Link href="/reportes/constructor" className={reportPrimary}>
            <Plus size={16} aria-hidden="true" />
            Crear informe
          </Link>
        )}
      </WorkspacePageHeader>
      {authLoading || workspaceLoading ? (
        <p role="status" className={reportCard + ' p-6 text-sm text-muted-foreground'}>
          Cargando el espacio de trabajo…
        </p>
      ) : activeWorkspace && user ? (
        <ReportLibrary
          key={user.id + ':' + activeWorkspace.id}
          workspaceId={activeWorkspace.id}
          userId={user.id}
        />
      ) : (
        <p className={reportCard + ' p-6 text-sm text-muted-foreground'}>
          Selecciona un espacio de trabajo para consultar sus informes.
        </p>
      )}
    </AppLayout>
  );
}

function ReportLibrary({ workspaceId, userId }: { workspaceId: string; userId: string }) {
  const db = useMemo(() => createClient(), []);
  const [reports, setReports] = useState<ReportDefinition[] | null>(null);
  const [revision, setRevision] = useState(0);
  const [loadingError, setLoadingError] = useState('');
  const [actionError, setActionError] = useState('');
  const [removing, setRemoving] = useState('');
  const [summaryOpen, toggleSummary] = useSummaryExpansion('reports-summary-metrics', true);
  const [counts, setCounts] = useState<(number | null)[] | null>(null);
  const [query, setQuery] = useState('');
  const [dataset, setDataset] = useState<DatasetId | 'all'>('all');
  const [origin, setOrigin] = useState<'all' | 'system' | 'user'>('all');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [view, setView] = useState<'grid' | 'list'>('grid');

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void Promise.allSettled([
      listReportPresets(db, signal),
      listSavedReports(db, workspaceId, signal),
    ]).then(([presets, saved]) => {
      if (signal.aborted) return;
      setLoadingError(
        [presets, saved]
          .flatMap((result) => (result.status === 'rejected' ? [result.reason.message] : []))
          .join(' ')
      );
      setReports([
        ...(presets.status === 'fulfilled'
          ? presets.value.filter((item) => item.listed !== false)
          : []),
        ...(saved.status === 'fulfilled' ? saved.value : []),
      ]);
    });
    return () => controller.abort();
  }, [db, workspaceId, revision]);

  useEffect(() => {
    if (!summaryOpen) return;
    const controller = new AbortController();
    void Promise.allSettled([
      fetchReportCount(db, workspaceId, 'documentos', controller.signal),
      fetchReportCount(db, workspaceId, 'tareas', controller.signal),
    ]).then((results) => {
      if (!controller.signal.aborted)
        setCounts(
          results.map((result) => (result.status === 'fulfilled' ? result.value.total : null))
        );
    });
    return () => controller.abort();
  }, [db, workspaceId, summaryOpen, revision]);

  const availableModules = datasetIds.filter((id) =>
    reports?.some((report) => report.dataset === id)
  );
  const filtered = useMemo(() => {
    const term = searchableReportText(query);
    return (reports || [])
      .filter(
        (report) =>
          (dataset === 'all' || report.dataset === dataset) &&
          (origin === 'all' || (origin === 'system' ? report.system : !report.system)) &&
          (!term ||
            searchableReportText(
              [report.name, report.description, DATASETS[report.dataset].label].join(' ')
            ).includes(term))
      )
      .sort((a, b) => {
        if (sort === 'recent') {
          const byDate = compareListDates(
            a.updated_at || a.created_at,
            b.updated_at || b.created_at,
            'desc'
          );
          if (byDate) return byDate;
          // Presets share no modification date and arrive in their published order.
          if (a.system && b.system) return 0;
          if (Boolean(a.system) !== Boolean(b.system)) return a.system ? -1 : 1;
        }
        return a.name.localeCompare(b.name, 'es') || a.id.localeCompare(b.id);
      });
  }, [dataset, origin, query, reports, sort]);

  async function remove(report: ReportDefinition) {
    if (report.system || report.created_by !== userId || removing) return;
    if (!window.confirm('¿Eliminar el informe “' + report.name + '”?')) return;
    setRemoving(report.id);
    setActionError('');
    try {
      const result = await db
        .from('report_definitions')
        .delete()
        .eq('id', report.id)
        .eq('created_by', userId)
        .eq('workspace_id', workspaceId)
        .select('id')
        .maybeSingle();
      if (result.error || !result.data) throw new Error();
      setReports((current) => (current || []).filter((item) => item.id !== report.id));
    } catch {
      setActionError('No se pudo eliminar el informe. Intenta nuevamente.');
    } finally {
      setRemoving('');
    }
  }

  const metrics = [
    {
      label: 'Informes disponibles',
      value: reports?.length ?? '…',
      icon: BarChart3,
      tone: 'bg-primary/10 text-primary',
    },
    {
      label: 'Documentos analizados',
      value: counts ? (counts[0] ?? '—') : '…',
      icon: FileText,
      tone: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
    },
    {
      label: 'Tareas activas',
      value: counts ? (counts[1] ?? '—') : '…',
      icon: List,
      tone: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    },
  ];

  return (
    <div className="space-y-4">
      <section className={reportCard}>
        <button
          type="button"
          onClick={toggleSummary}
          aria-expanded={summaryOpen}
          aria-controls="reports-summary"
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        >
          <span>
            <span className="block text-sm font-semibold">Resumen de reportes</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Datos del espacio de trabajo actual.
            </span>
          </span>
          <ChevronDown size={17} className={summaryOpen ? 'rotate-180' : ''} aria-hidden="true" />
        </button>
        {summaryOpen && (
          <div
            id="reports-summary"
            className="grid gap-px border-t border-border bg-border sm:grid-cols-3"
          >
            {metrics.map(({ label, value, icon: Icon, tone }) => (
              <div
                key={label}
                className="flex min-h-20 min-w-0 items-center gap-3 bg-card px-5 py-3"
              >
                <span className={'grid size-9 shrink-0 place-items-center rounded-md ' + tone}>
                  <Icon size={17} aria-hidden="true" />
                </span>
                <span>
                  <strong className="block text-xl font-semibold tabular-nums">{value}</strong>
                  <span className="text-xs text-muted-foreground">{label}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className={reportCard + ' flex flex-wrap items-center gap-2 p-3'}>
        <label className="relative min-w-[12rem] flex-1 basis-full sm:basis-48">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            aria-label="Buscar informes"
            placeholder="Buscar informes…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={reportControl + ' w-full bg-muted/30 pl-9'}
          />
        </label>
        <select
          aria-label="Filtrar módulo"
          value={dataset}
          onChange={(event) => setDataset(event.target.value as typeof dataset)}
          className={reportControl}
        >
          <option value="all">Todos los módulos</option>
          {availableModules.map((id) => (
            <option key={id} value={id}>
              {DATASETS[id].label}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar origen"
          value={origin}
          onChange={(event) => setOrigin(event.target.value as typeof origin)}
          className={reportControl}
        >
          <option value="all">Todos los informes</option>
          <option value="system">Creados por Docubox</option>
          <option value="user">Personalizados</option>
        </select>
        <select
          aria-label="Ordenar"
          value={sort}
          onChange={(event) => setSort(event.target.value as typeof sort)}
          className={reportControl}
        >
          <option value="recent">Más recientes</option>
          <option value="name">Nombre</option>
        </select>
        <div
          role="group"
          aria-label="Vista de la biblioteca"
          className="flex h-9 items-center rounded-md border border-border p-0.5"
        >
          {(
            [
              ['list', List, 'Lista'],
              ['grid', LayoutGrid, 'Cuadrícula'],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              aria-label={label}
              aria-pressed={view === id}
              onClick={() => setView(id)}
              className={
                'grid size-8 place-items-center rounded focus-visible:outline-primary ' +
                (view === id
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/50')
              }
            >
              <Icon size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      {actionError && <BottomNotice message={actionError} tone="critical" onClose={() => setActionError('')} />}
      {loadingError && (
        <p role="alert" className={reportError}>
          {loadingError}
          {loadingError && (
            <>
              {' '}
              <button
                type="button"
                onClick={() => setRevision((value) => value + 1)}
                className="font-medium underline"
              >
                Reintentar
              </button>
            </>
          )}
        </p>
      )}
      {!reports ? (
        <p role="status" className={reportCard + ' p-8 text-sm text-muted-foreground'}>
          Cargando informes…
        </p>
      ) : filtered.length === 0 ? (
        <p className={reportCard + ' p-10 text-center text-sm text-muted-foreground'}>
          No hay informes que coincidan con los filtros.
        </p>
      ) : (
        <div className={view === 'grid' ? 'grid gap-3 md:grid-cols-2 xl:grid-cols-3' : 'space-y-2'}>
          {filtered.map((report) => (
            <article
              key={report.id}
              className={reportCard + ' flex min-w-0 items-start gap-2 p-4 hover:border-primary/30'}
            >
              <Link
                href={'/reportes/ver/' + report.id}
                className="group flex min-w-0 flex-1 items-start gap-3 rounded focus-visible:outline-primary"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                  <BarChart3 size={18} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 className="break-words text-sm font-semibold group-hover:text-primary">
                    {report.name}
                  </h2>
                  {report.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {report.description}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {DATASETS[report.dataset].label} ·{' '}
                    {report.system ? 'Creado por Docubox' : 'Personalizado'}
                  </p>
                </div>
              </Link>
              {!report.system && report.created_by === userId && (
                <div className="flex shrink-0 gap-1">
                  <Link
                    href={'/reportes/constructor?report=' + report.id}
                    aria-label={'Editar ' + report.name}
                    className="rounded-md p-2 text-muted-foreground hover:bg-muted focus-visible:outline-primary"
                  >
                    <Pencil size={15} aria-hidden="true" />
                  </Link>
                  <button
                    type="button"
                    disabled={Boolean(removing)}
                    onClick={() => void remove(report)}
                    aria-label={'Eliminar ' + report.name}
                    className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-primary disabled:opacity-50"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {reports && (
        <p className="text-right text-xs text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? 'informe visible' : 'informes visibles'}
        </p>
      )}
    </div>
  );
}
