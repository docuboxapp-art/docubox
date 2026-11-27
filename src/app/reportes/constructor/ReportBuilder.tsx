'use client';

import { toast } from 'sonner';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, Save, X } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import WorkspacePageHeader from '@/components/workspaces/WorkspacePageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createClient } from '@/lib/supabase/client';
import {
  DATASETS,
  defaultConfig,
  reportableDatasets,
  type DatasetId,
  type ReportConfig,
  type ReportDefinition,
  type ReportField,
  type Visualization,
} from '@/lib/reporting/catalog';
import { getReportDefinition, type ReportClient } from '@/lib/reporting/client';
import { reportConfigIssue, runReport, selectedReportFields } from '@/lib/reporting/engine';
import { ReportPresentation, ReportVisualizationButtons } from '../components/ReportPresentation';
import {
  reportButton,
  reportCard,
  reportControl,
  reportError,
  reportPrimary,
} from '../components/styles';
import { useReportData } from '../components/useReportData';
import { ReportConditions } from './ReportConditions';

const descriptionText = 'Define los datos, las condiciones y la presentación del informe.';
const closeLink = (
  <Link href="/reportes" className={reportButton}>
    <X size={16} aria-hidden="true" />
    Cerrar
  </Link>
);

export default function ReportBuilder({
  reportId,
  presetId,
}: {
  reportId: string | null;
  presetId: string | null;
}) {
  const { user, loading: authLoading } = useAuth();
  const { activeWorkspace, loading: workspaceLoading } = useWorkspace();
  return (
    <AppLayout>
      {!authLoading && !workspaceLoading && user && activeWorkspace ? (
        <EditorLoader
          key={[user.id, activeWorkspace.id, reportId, presetId].join(':')}
          workspaceId={activeWorkspace.id}
          userId={user.id}
          organization={activeWorkspace.workspaceType === 'business'}
          reportId={reportId}
          presetId={presetId}
        />
      ) : (
        <EditorMessage loading={authLoading || workspaceLoading}>
          Selecciona un espacio de trabajo para crear un informe.
        </EditorMessage>
      )}
    </AppLayout>
  );
}

function EditorMessage({ loading, children }: { loading?: boolean; children?: string }) {
  return (
    <>
      <WorkspacePageHeader title="Constructor de informes" description={descriptionText}>
        {closeLink}
      </WorkspacePageHeader>
      <p
        role={loading ? 'status' : 'alert'}
        className={loading ? reportCard + ' p-6 text-sm text-muted-foreground' : reportError}
      >
        {loading ? 'Cargando la configuración…' : children}
      </p>
    </>
  );
}

function EditorLoader({
  workspaceId,
  userId,
  organization,
  reportId,
  presetId,
}: {
  workspaceId: string;
  userId: string;
  organization: boolean;
  reportId: string | null;
  presetId: string | null;
}) {
  const db = useMemo(() => createClient(), []);
  const id = reportId || presetId;
  const [status, setStatus] = useState<{ report?: ReportDefinition; error?: string } | null>(null);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    void getReportDefinition(db, workspaceId, id, controller.signal)
      .then((report) => {
        if (controller.signal.aborted) return;
        const permitted =
          report && (reportId ? !report.system && report.created_by === userId : report.system);
        setStatus(
          permitted
            ? { report }
            : { error: 'El informe no está disponible para esta acción en tu espacio.' }
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted) setStatus({ error: error.message });
      });
    return () => controller.abort();
  }, [db, id, workspaceId, userId, reportId]);

  if (id && !status?.report)
    return <EditorMessage loading={!status}>{status?.error}</EditorMessage>;
  return (
    <ReportEditor
      db={db}
      initial={status?.report}
      reportId={reportId}
      workspaceId={workspaceId}
      userId={userId}
      organization={organization}
    />
  );
}

function resetFormScope(config: ReportConfig, formId: string): ReportConfig {
  const base = defaultConfig('respuestas');
  const baseField = (id: string) => !id.startsWith('respuesta.');
  const fields = config.fields.filter(baseField);
  return {
    ...config,
    formId: formId || undefined,
    fields: fields.length ? fields : base.fields,
    conditions: config.conditions.filter((condition) => baseField(condition.field)),
    dateField: baseField(config.dateField) ? config.dateField : base.dateField,
    sortBy: baseField(config.sortBy) ? config.sortBy : base.sortBy,
    groupBy: baseField(config.groupBy)
      ? config.groupBy
      : config.visualization === 'line'
        ? 'enviado'
        : 'formulario',
    metric: baseField(config.metric) ? config.metric : '__count',
  };
}

function ReportEditor({
  db,
  initial,
  reportId,
  workspaceId,
  userId,
  organization,
}: {
  db: ReportClient;
  initial?: ReportDefinition;
  reportId: string | null;
  workspaceId: string;
  userId: string;
  organization: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(
    initial ? (initial.system ? (initial.name + ' · copia').slice(0, 120) : initial.name) : ''
  );
  const [description, setDescription] = useState(initial?.description ?? '');
  const [dataset, setDataset] = useState<DatasetId>(initial?.dataset ?? 'documentos');
  const [config, setConfig] = useState<ReportConfig>(
    initial?.config ?? defaultConfig('documentos')
  );
  const [saving, setSaving] = useState(false);
  const { data, error, loading, formOptions, reload } = useReportData(
    db,
    workspaceId,
    dataset,
    config
  );

  const fields = data?.fields ?? DATASETS[dataset].fields;
  const configured = new Set([
    config.groupBy,
    config.metric,
    config.dateField,
    config.sortBy,
    ...config.fields,
    ...config.conditions.map((condition) => condition.field),
  ]);
  const selectable = fields.filter((field) => !field.legacy || configured.has(field.id));
  const columns = selectedReportFields(config, fields);
  const unavailable = data
    ? config.fields.filter((id) => !columns.some((column) => column.id === id))
    : [];
  const issue = data ? reportConfigIssue(config, fields) : '';
  const rows = useMemo(
    () => (data && !issue ? runReport(data.rows, config, data.fields) : []),
    [data, config, issue]
  );
  const datasets = reportableDatasets(organization);
  if (!datasets.includes(dataset)) datasets.push(dataset);
  const change = (patch: Partial<ReportConfig>) => {
    setConfig((current) => ({ ...current, ...patch }));
  };

  function chooseView(visualization: Visualization) {
    const date =
      fields.find((field) => field.id === config.dateField && field.type === 'date') ||
      fields.find((field) => field.type === 'date');
    const category =
      fields.find((field) => field.id === 'estado' && field.type === 'text') ||
      fields.find((field) => field.type === 'text' && !field.legacy);
    const groupField = fields.find(
      (field) => field.id === config.groupBy && field.type !== 'number'
    );
    const groupBy =
      visualization === 'line' && groupField?.type !== 'date'
        ? date?.id || config.groupBy || category?.id || ''
        : groupField?.id ||
          (visualization === 'bar' || visualization === 'pie' ? category?.id || '' : '');
    change({
      visualization,
      groupBy,
      ...(visualization === 'pie' ? { metricOperation: 'sum' } : {}),
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !data) return;
    if (name.trim().length < 3) {
      toast.warning('Escribe un nombre de al menos 3 caracteres.');
      return;
    }
    if (issue) {
      toast.warning(issue);
      return;
    }
    setSaving(true);
    const payload = {
      name: name.trim(),
      description: description.trim(),
      dataset,
      config: {
        ...config,
        conditions: config.conditions.map((condition) => ({
          ...condition,
          value: condition.value.trim(),
        })),
      },
    };
    try {
      const result = reportId
        ? await db
            .from('report_definitions')
            .update(payload)
            .eq('id', reportId)
            .eq('workspace_id', workspaceId)
            .eq('created_by', userId)
            .select('id')
            .maybeSingle()
        : await db
            .from('report_definitions')
            .insert({ ...payload, workspace_id: workspaceId, created_by: userId })
            .select('id')
            .single();
      if (result.error || !result.data) throw new Error();
      router.push('/reportes');
    } catch {
      toast.error('No se pudo guardar el informe. Revisa tu acceso e inténtalo de nuevo.');
      setSaving(false);
    }
  }

  function fieldChoices(items: ReportField[]) {
    return (
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((field) => {
          const checked = config.fields.includes(field.id);
          return (
            <label
              key={field.id}
              className={
                'flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ' +
                (checked ? 'border-primary/40 bg-primary/10' : 'border-border hover:bg-muted/50')
              }
            >
              <input
                type="checkbox"
                checked={checked}
                className="shrink-0 accent-primary"
                onChange={() =>
                  change({
                    fields: checked
                      ? config.fields.filter((id) => id !== field.id)
                      : [...config.fields, field.id],
                  })
                }
              />
              <span className="break-words [overflow-wrap:anywhere]">{field.label}</span>
            </label>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <WorkspacePageHeader title="Constructor de informes" description={descriptionText}>
        {closeLink}
        <button
          type="submit"
          form="report-editor"
          disabled={saving || loading || !data}
          className={reportPrimary}
        >
          <Save size={16} aria-hidden="true" />
          {saving ? 'Guardando…' : 'Guardar y salir'}
        </button>
      </WorkspacePageHeader>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] xl:gap-5">
        <form id="report-editor" onSubmit={save} className="min-w-0 space-y-4">
          <fieldset disabled={saving} className="min-w-0 space-y-4">
            <section className={reportCard + ' p-4 sm:p-5'}>
              <h2 className="mb-4 text-base font-semibold">1. Datos del informe</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
                  Nombre
                  <input
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                    }}
                    placeholder="Nombre del informe"
                    maxLength={120}
                    className={reportControl}
                  />
                </label>
                <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
                  Módulo
                  <select
                    value={dataset}
                    className={reportControl}
                    onChange={(event) => {
                      const next = event.target.value as DatasetId;
                      setDataset(next);
                      setConfig(defaultConfig(next));
                    }}
                  >
                    {datasets.map((id) => (
                      <option key={id} value={id}>
                        {DATASETS[id].label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{DATASETS[dataset].description}</p>
              {dataset === 'respuestas' && (
                <label className="mt-4 flex min-w-0 flex-col gap-1.5 text-sm font-medium">
                  Formulario
                  <select
                    value={config.formId || ''}
                    className={reportControl}
                    onChange={(event) => {
                      setConfig((current) => resetFormScope(current, event.target.value));
                    }}
                  >
                    <option value="">Todos los formularios disponibles</option>
                    {config.formId && !formOptions.some((item) => item.id === config.formId) && (
                      <option value={config.formId}>Formulario guardado</option>
                    )}
                    {formOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="mt-4 flex min-w-0 flex-col gap-1.5 text-sm font-medium">
                Descripción
                <textarea
                  maxLength={500}
                  rows={2}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className={reportControl + ' h-auto min-h-16 py-2'}
                />
              </label>
            </section>

            <section className={reportCard + ' p-4 sm:p-5'}>
              <h2 className="text-base font-semibold">2. Campos visibles</h2>
              <p className="mb-4 mt-1 text-sm text-muted-foreground">
                Elige los campos que se muestran en la tabla y se incluyen al exportar.
              </p>
              {fieldChoices(selectable.filter((field) => !field.id.startsWith('respuesta.')))}
              {selectable.some((field) => field.id.startsWith('respuesta.')) && (
                <div className="mt-4 border-t border-border pt-4">
                  <h3 className="mb-2 text-sm font-semibold">Campos capturados</h3>
                  {fieldChoices(selectable.filter((field) => field.id.startsWith('respuesta.')))}
                </div>
              )}
              {unavailable.length > 0 && (
                <button
                  type="button"
                  className={reportButton + ' mt-3'}
                  onClick={() =>
                    change({ fields: config.fields.filter((id) => !unavailable.includes(id)) })
                  }
                >
                  Quitar campos no disponibles ({unavailable.length})
                </button>
              )}
            </section>

            <ReportConditions
              config={config}
              fields={selectable}
              rows={data?.rows ?? []}
              change={change}
            />

            <section className={reportCard + ' p-4 sm:p-5'}>
              <h2 className="mb-4 text-base font-semibold">4. Presentación</h2>
              <ReportVisualizationButtons value={config.visualization} onChange={chooseView} />

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {config.visualization !== 'table' && (
                  <>
                    <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
                      Agrupar por
                      <select
                        value={config.groupBy}
                        className={reportControl}
                        onChange={(event) => change({ groupBy: event.target.value })}
                      >
                        <option value="">
                          {config.visualization === 'kpi'
                            ? 'Un indicador total'
                            : 'Selecciona un campo'}
                        </option>
                        {config.groupBy &&
                          !selectable.some(
                            (field) => field.id === config.groupBy && field.type !== 'number'
                          ) && <option value={config.groupBy}>Campo no disponible</option>}
                        {selectable
                          .filter((field) => field.type !== 'number')
                          .map((field) => (
                            <option key={field.id} value={field.id}>
                              {field.label}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
                      Medida
                      <select
                        value={config.metric}
                        className={reportControl}
                        onChange={(event) => change({ metric: event.target.value })}
                      >
                        <option value="__count">Número de registros</option>
                        {config.metric !== '__count' &&
                          !selectable.some(
                            (field) => field.id === config.metric && field.type === 'number'
                          ) && <option value={config.metric}>Medida no disponible</option>}
                        {selectable
                          .filter((field) => field.type === 'number')
                          .map((field) => (
                            <option key={field.id} value={field.id}>
                              {field.label}
                            </option>
                          ))}
                      </select>
                    </label>
                    {config.metric !== '__count' && config.visualization !== 'pie' && (
                      <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
                        Cálculo de la medida
                        <select
                          value={config.metricOperation || 'sum'}
                          className={reportControl}
                          onChange={(event) =>
                            change({
                              metricOperation: event.target
                                .value as ReportConfig['metricOperation'],
                            })
                          }
                        >
                          <option value="sum">Suma</option>
                          <option value="average">Promedio</option>
                        </select>
                      </label>
                    )}
                    {selectable.some(
                      (field) => field.id === config.groupBy && field.type === 'date'
                    ) && (
                      <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
                        Agrupar fechas por
                        <select
                          value={config.dateBucket || 'day'}
                          className={reportControl}
                          onChange={(event) =>
                            change({ dateBucket: event.target.value as ReportConfig['dateBucket'] })
                          }
                        >
                          <option value="day">Día</option>
                          <option value="month">Mes</option>
                        </select>
                      </label>
                    )}
                  </>
                )}
                <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
                  Ordenar registros por
                  <select
                    value={config.sortBy}
                    className={reportControl}
                    onChange={(event) => change({ sortBy: event.target.value })}
                  >
                    <option value="">Orden original</option>
                    {config.sortBy && !selectable.some((field) => field.id === config.sortBy) && (
                      <option value={config.sortBy}>Campo no disponible</option>
                    )}
                    {selectable.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                </label>
                {config.sortBy && (
                  <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
                    Dirección
                    <select
                      value={config.sortDirection}
                      className={reportControl}
                      onChange={(event) =>
                        change({
                          sortDirection: event.target.value as ReportConfig['sortDirection'],
                        })
                      }
                    >
                      <option value="desc">Descendente</option>
                      <option value="asc">Ascendente</option>
                    </select>
                  </label>
                )}
              </div>
            </section>
          </fieldset>
        </form>
        <aside
          className={
            reportCard +
            ' min-w-0 p-4 sm:p-5 xl:sticky xl:top-[calc(var(--app-header-height)+1rem)]'
          }
        >
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Eye size={18} className="text-primary" aria-hidden="true" />
            Vista previa
          </h2>
          {loading && (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              Consultando datos del espacio…
            </p>
          )}
          {error && (
            <p role="alert" className={'mt-3 ' + reportError}>
              {error}{' '}
              <button type="button" onClick={reload} className="font-medium underline">
                Reintentar
              </button>
            </p>
          )}
          {issue && <p className="mt-3 text-sm text-muted-foreground">{issue}</p>}
          {data && !issue && (
            <>
              <p className="mb-3 mt-1 text-sm text-muted-foreground">
                {rows.length} {rows.length === 1 ? 'registro' : 'registros'}
                {data.truncated ? ' de una consulta parcial' : ' con esta configuración'}
              </p>
              <ReportPresentation
                rows={rows}
                config={config}
                fields={fields}
                columns={columns}
                preview
              />
              {config.visualization === 'table' && rows.length > 5 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Vista previa de los primeros 5 registros.
                </p>
              )}
            </>
          )}
        </aside>
      </div>
    </>
  );
}
