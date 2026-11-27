'use client';

import { BottomNotice } from '@/components/ui/BottomNotice';
import { useEffect, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Columns3,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  Pencil,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import WorkspacePageHeader from '@/components/workspaces/WorkspacePageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createClient } from '@/lib/supabase/client';
import {
  DATASETS,
  reportPeriods,
  type ReportConfig,
  type ReportDefinition,
} from '@/lib/reporting/catalog';
import { getReportDefinition, type ReportClient } from '@/lib/reporting/client';
import type { ListDirection } from '@/lib/workspaces/list-order';
import {
  displayReportValue,
  reportConfigIssue,
  runReport,
  searchableReportText,
  selectedReportFields,
} from '@/lib/reporting/engine';
import { ReportPresentation, reportViews } from '../../components/ReportPresentation';
import { reportButton, reportCard, reportControl, reportError } from '../../components/styles';
import TablePagination, { useTablePagination } from '@/components/workspaces/TablePagination';
import { useReportData } from '../../components/useReportData';

const exports = [
  ['pdf', 'PDF', FileText],
  ['xlsx', 'Excel', FileSpreadsheet],
  ['csv', 'CSV', Download],
  ['json', 'JSON', FileJson],
] as const;
type FileFormat = (typeof exports)[number][0];

const closeLink = (
  <Link href="/reportes" className={reportButton}>
    <X size={16} aria-hidden="true" />
    Cerrar
  </Link>
);

export default function ReportViewer({ reportId }: { reportId: string }) {
  const { user, loading: authLoading } = useAuth();
  const { activeWorkspace, loading: workspaceLoading } = useWorkspace();
  return (
    <AppLayout>
      {!authLoading && !workspaceLoading && user && activeWorkspace ? (
        <ReportViewLoader
          key={[user.id, activeWorkspace.id, reportId].join(':')}
          reportId={reportId}
          workspaceId={activeWorkspace.id}
          userId={user.id}
        />
      ) : (
        <>
          <WorkspacePageHeader title="Informe" description="Resultados del espacio de trabajo.">
            {closeLink}
          </WorkspacePageHeader>
          <p role="status" className={reportCard + ' p-6 text-sm text-muted-foreground'}>
            {authLoading || workspaceLoading
              ? 'Cargando el espacio de trabajo…'
              : 'Selecciona un espacio de trabajo para consultar el informe.'}
          </p>
        </>
      )}
    </AppLayout>
  );
}

function ReportViewLoader({
  reportId,
  workspaceId,
  userId,
}: {
  reportId: string;
  workspaceId: string;
  userId: string;
}) {
  const db = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<{ report?: ReportDefinition; error?: string } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void getReportDefinition(db, workspaceId, reportId, controller.signal)
      .then((report) => {
        if (controller.signal.aborted) return;
        setStatus(report ? { report } : { error: 'No se encontró el informe en este espacio.' });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setStatus({ error: error.message });
      });
    return () => controller.abort();
  }, [db, reportId, workspaceId, revision]);

  return status?.report ? (
    <ReportResult db={db} report={status.report} userId={userId} workspaceId={workspaceId} />
  ) : (
    <>
      <WorkspacePageHeader title="Informe" description="Resultados del espacio de trabajo.">
        {closeLink}
      </WorkspacePageHeader>
      {status?.error ? (
        <p role="alert" className={reportError}>
          {status.error}{' '}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => {
              setStatus(null);
              setRevision((value) => value + 1);
            }}
          >
            Reintentar
          </button>
        </p>
      ) : (
        <p role="status" className={reportCard + ' p-8 text-sm text-muted-foreground'}>
          Cargando informe…
        </p>
      )}
    </>
  );
}

function ReportResult({
  db,
  report,
  workspaceId,
  userId,
}: {
  db: ReportClient;
  report: ReportDefinition;
  workspaceId: string;
  userId: string;
}) {
  const [period, setPeriod] = useState<ReportConfig['period'] | 'configured'>('configured');
  const [search, setSearch] = useState('');
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [sort, setSort] = useState<{ field: string; direction: ListDirection } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const columnPanelId = useId();
  const effective = useMemo(
    () => ({ ...report.config, period: period === 'configured' ? report.config.period : period }),
    [report, period]
  );
  const { data, error, loading, reload } = useReportData(
    db,
    workspaceId,
    report.dataset,
    effective
  );
  const issue = data ? reportConfigIssue(effective, data.fields) : '';
  const view =
    reportViews.find((option) => option.id === report.config.visualization) ?? reportViews[0];
  const ViewIcon = view.icon;
  const isTable = view.id === 'table';
  const selected = useMemo(
    () => (data ? selectedReportFields(effective, data.fields) : []),
    [effective, data]
  );
  const columns = useMemo(
    () => selected.filter((field) => !isTable || !hiddenColumns.includes(field.id)),
    [selected, hiddenColumns, isTable]
  );
  const activeSort =
    isTable && sort && columns.some((field) => field.id === sort.field) ? sort : null;
  const rows = useMemo(() => {
    if (!data || issue) return [];
    const config = activeSort
      ? { ...effective, sortBy: activeSort.field, sortDirection: activeSort.direction }
      : effective;
    const filtered = runReport(data.rows, config, data.fields);
    const term = searchableReportText(search);
    const group = isTable ? null : data.fields.find((field) => field.id === effective.groupBy);
    const searchFields = group ? [...selected, group] : selected;
    return term
      ? filtered.filter((row) =>
          searchFields.some((field) =>
            searchableReportText(displayReportValue(row[field.id], field)).includes(term)
          )
        )
      : filtered;
  }, [activeSort, data, effective, issue, isTable, search, selected]);

  const pagination = useTablePagination(rows.length);
  const setPage = pagination.onPageChange;
  const pageRows = rows.slice(pagination.start, pagination.end);
  const canExport = Boolean(data && !data.truncated && !issue && rows.length && columns.length);
  const editor = report.system
    ? '/reportes/constructor?preset=' + report.id
    : report.created_by === userId
      ? '/reportes/constructor?report=' + report.id
      : '';

  async function download(format: FileFormat) {
    if (!canExport || exporting) return;
    setExporting(true);
    setExportError('');
    try {
      const { exportReport } = await import('@/lib/reporting/export');
      await exportReport(report.name, columns, rows, format);
    } catch {
      setExportError('No fue posible exportar el informe. Intenta nuevamente.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <WorkspacePageHeader
        title={report.name}
        description={report.description || DATASETS[report.dataset].label}
      >
        {editor && (
          <Link href={editor} className={reportButton}>
            <Pencil size={15} aria-hidden="true" />
            {report.system ? 'Personalizar copia' : 'Editar configuración'}
          </Link>
        )}
        {closeLink}
      </WorkspacePageHeader>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">
            {report.system ? 'Creado por Docubox' : 'Personalizado'}
          </span>
          <span>{DATASETS[report.dataset].label}</span>
          {data && !issue && (
            <span>
              · {rows.length} {rows.length === 1 ? 'registro' : 'registros'}
            </span>
          )}
          {data?.generatedAt && (
            <span>· Actualizado {new Date(data.generatedAt).toLocaleString('es-MX')}</span>
          )}
        </div>

        <div className={reportCard + ' flex flex-wrap items-center gap-2 p-3'}>
          <label className="relative min-w-[12rem] flex-1 basis-full sm:basis-52">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              aria-label="Buscar dentro del informe"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Buscar en resultados…"
              className={reportControl + ' w-full bg-muted/30 pl-9'}
            />
          </label>
          {report.config.dateField && (
            <select
              aria-label="Periodo de visualización"
              value={period}
              onChange={(event) => {
                setPeriod(event.target.value as typeof period);
                setPage(1);
              }}
              className={reportControl}
            >
              <option value="configured">Periodo configurado</option>
              {reportPeriods.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          )}
          <button type="button" onClick={reload} disabled={loading} className={reportButton}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
            Actualizar
          </button>
          {isTable && (
            <button
              type="button"
              onClick={() => setColumnsOpen((value) => !value)}
              aria-expanded={columnsOpen}
              aria-controls={columnPanelId}
              disabled={!selected.length}
              className={reportButton}
            >
              <Columns3 size={15} aria-hidden="true" />
              Columnas
            </button>
          )}
        </div>

        {isTable && columnsOpen && selected.length > 0 && (
          <div id={columnPanelId} className={reportCard + ' flex flex-wrap gap-2 p-3'}>
            {selected.map((field) => {
              const visible = !hiddenColumns.includes(field.id);
              return (
                <label
                  key={field.id}
                  className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={visible}
                    disabled={visible && columns.length === 1}
                    onChange={() =>
                      setHiddenColumns((current) =>
                        visible ? [...current, field.id] : current.filter((id) => id !== field.id)
                      )
                    }
                  />
                  {field.label}
                </label>
              );
            })}
          </div>
        )}

        <div className={reportCard + ' flex flex-wrap items-center justify-between gap-3 p-3'}>
          <span
            aria-label={'Visualización guardada: ' + view.label}
            className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-sm font-medium text-primary"
          >
            <ViewIcon size={16} aria-hidden="true" />
            {view.label}
          </span>
          <div
            role="group"
            aria-label="Exportar datos del informe"
            className="flex flex-wrap gap-2"
          >
            {exports.map(([format, label, Icon]) => (
              <button
                key={format}
                type="button"
                onClick={() => void download(format)}
                disabled={!canExport || exporting}
                className={reportButton}
              >
                <Icon size={14} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </div>
        {exportError && <BottomNotice message={exportError} tone="critical" onClose={() => setExportError('')} />}
        {(error || issue) && (
          <p role="alert" className={reportError}>
            {error || issue}
          </p>
        )}
        {data?.truncated && (
          <p
            role="status"
            className="rounded-md border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200"
          >
            Resultados parciales por el límite de consulta. Prueba un periodo más corto antes de
            exportar.
          </p>
        )}
        {loading ? (
          <p role="status" className={reportCard + ' p-8 text-sm text-muted-foreground'}>
            Preparando informe…
          </p>
        ) : (
          data &&
          !issue && (
            <section
              aria-label="Resultados del informe"
              className={reportCard + ' min-w-0 p-3 sm:p-5'}
            >
              <ReportPresentation
                rows={rows}
                config={effective}
                fields={data.fields}
                columns={columns}
                pageRows={pageRows}
                tableSort={
                  activeSort ?? { field: effective.sortBy, direction: effective.sortDirection }
                }
                onTableSort={(field, direction) => {
                  setSort({ field, direction });
                  setPage(1);
                }}
              />
              {isTable && (
                <div className="mt-4 overflow-hidden rounded-lg border border-border">
                  <TablePagination {...pagination} />
                </div>
              )}
            </section>
          )
        )}
      </div>
    </>
  );
}
