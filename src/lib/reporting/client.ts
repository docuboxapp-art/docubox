'use client';

import { createClient } from '@/lib/supabase/client';
import {
  BUILTIN_REPORTS,
  datasetIds,
  type DatasetId,
  type ReportConfig,
  type ReportDefinition,
  type ReportField,
  type ReportRow,
} from './catalog';
import { safeConfig } from './engine';

export type ReportClient = ReturnType<typeof createClient>;
export type ReportData = {
  rows: ReportRow[];
  fields: ReportField[];
  truncated: boolean;
  generatedAt: string;
  formOptions?: { id: string; name: string }[];
};
const definitionColumns =
  'id,created_by,workspace_id,name,description,dataset,config,created_at,updated_at';
const presetColumns = 'id,name,description,dataset,config,listed';
const missingPresets = (code?: string) => ['42P01', 'PGRST205'].includes(code || '');

function reportFromRow(row: Record<string, unknown>, system: boolean): ReportDefinition | null {
  const dataset = row.dataset as DatasetId;
  if (!datasetIds.includes(dataset) || typeof row.id !== 'string' || typeof row.name !== 'string')
    return null;
  return {
    id: row.id,
    name: row.name,
    description: typeof row.description === 'string' ? row.description : '',
    dataset,
    config: safeConfig(row.config, dataset),
    created_by: typeof row.created_by === 'string' ? row.created_by : undefined,
    workspace_id: typeof row.workspace_id === 'string' ? row.workspace_id : undefined,
    created_at: typeof row.created_at === 'string' ? row.created_at : undefined,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : undefined,
    system,
    listed: row.listed !== false,
  };
}

export async function listReportPresets(db: ReportClient, signal: AbortSignal) {
  const result = await db
    .from('report_system_presets')
    .select(presetColumns)
    .order('sort_order')
    .order('id')
    .abortSignal(signal);
  if (result.error && missingPresets(result.error.code)) return BUILTIN_REPORTS;
  if (result.error) throw new Error('No se pudo cargar el catálogo de Docubox.');
  return (result.data || []).flatMap((row) => reportFromRow(row, true) ?? []);
}

export async function listSavedReports(db: ReportClient, workspaceId: string, signal: AbortSignal) {
  const result = await db
    .from('report_definitions')
    .select(definitionColumns)
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('id')
    .abortSignal(signal);
  if (result.error) throw new Error('No se pudieron consultar los informes guardados.');
  return (result.data || []).flatMap((row) => reportFromRow(row, false) ?? []);
}

export async function getReportDefinition(
  db: ReportClient,
  workspaceId: string,
  id: string,
  signal: AbortSignal
) {
  const system = id.startsWith('docubox-');
  const result = system
    ? await db
        .from('report_system_presets')
        .select(presetColumns)
        .eq('id', id)
        .abortSignal(signal)
        .maybeSingle()
    : await db
        .from('report_definitions')
        .select(definitionColumns)
        .eq('workspace_id', workspaceId)
        .eq('id', id)
        .abortSignal(signal)
        .maybeSingle();
  if (system && result.error && missingPresets(result.error.code))
    return BUILTIN_REPORTS.find((report) => report.id === id) ?? null;
  if (result.error) throw new Error('No fue posible consultar la configuración del informe.');
  return result.data ? reportFromRow(result.data, system) : null;
}

async function reportRequest<T>(
  db: ReportClient,
  parameters: Record<string, string>,
  signal: AbortSignal
): Promise<T> {
  const { data } = await db.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Inicia sesión para consultar los informes.');
  const response = await fetch('/api/reportes/datos?' + new URLSearchParams(parameters), {
    headers: { Authorization: 'Bearer ' + token },
    cache: 'no-store',
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload)
    throw new Error(payload?.error || 'No se pudieron cargar los datos.');
  return payload as T;
}

export function fetchReportData(
  db: ReportClient,
  workspaceId: string,
  dataset: DatasetId,
  config: Pick<ReportConfig, 'period' | 'dateField' | 'formId'>,
  signal: AbortSignal
) {
  return reportRequest<ReportData>(
    db,
    {
      workspaceId,
      dataset,
      period: config.period,
      dateField: config.dateField,
      ...(dataset === 'respuestas' && config.formId ? { formId: config.formId } : {}),
    },
    signal
  );
}

export function fetchReportCount(
  db: ReportClient,
  workspaceId: string,
  dataset: 'documentos' | 'tareas',
  signal: AbortSignal
) {
  return reportRequest<{ total: number }>(db, { workspaceId, dataset, summary: '1' }, signal);
}
