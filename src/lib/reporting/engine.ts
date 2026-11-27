import {
  DATASETS,
  defaultConfig,
  reportPeriods,
  type Condition,
  type DatasetId,
  type FieldType,
  type ReportConfig,
  type ReportField,
  type ReportRow,
} from './catalog';
import { CASE_STATUS_META } from '../case-files/schema';

export const reportOperators = [
  ['eq', 'Es igual a'],
  ['neq', 'Es diferente de'],
  ['contains', 'Contiene'],
  ['gt', 'Mayor que'],
  ['gte', 'Mayor o igual'],
  ['lt', 'Menor que'],
  ['lte', 'Menor o igual'],
  ['empty', 'Está vacío'],
  ['not_empty', 'Tiene valor'],
] as const;

export function operatorsForType(type: FieldType) {
  return reportOperators.filter(([id]) =>
    type === 'text'
      ? ['eq', 'neq', 'contains', 'empty', 'not_empty'].includes(id)
      : type === 'boolean'
        ? ['eq', 'neq', 'empty', 'not_empty'].includes(id)
        : id !== 'contains'
  );
}

export const searchableReportText = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/\s+/g, ' ')
    .trim();

const statusLabels: Record<string, string> = {
  en_proceso: 'En proceso',
  completado: 'Completado',
  completada: 'Completada',
  borrador: 'Borrador',
  rechazado: 'Rechazado',
  rechazada: 'Rechazada',
  pendiente: 'Pendiente',
  nueva: 'Nueva',
  programada: 'Programada',
  bloqueada: 'Bloqueada',
  en_revision: 'En revisión',
  cancelada: 'Cancelada',
  escalada: 'Escalada',
  vencida: 'Vencida',
  publicada: 'Publicada',
  archivada: 'Archivada',
  published: 'Publicado',
  archived: 'Archivado',
  active: 'Activo',
  inactive: 'Inactivo',
  cancelled: 'Cancelado',
  signed: 'Firmado',
  submitted: 'Respuesta recibida',
  pending_signature: 'Pendiente de firma',
  completed: 'Completado',
  in_progress: 'En curso',
  pending: 'Pendiente',
  failed: 'Fallido',
  paused: 'Pausado',
  scheduled: 'Programado',
  running: 'En ejecución',
  closed: 'Cerrado',
  expired: 'Vencido',
  revoked: 'Revocado',
  suspended: 'Suspendido',
  offboarded: 'Dado de baja',
  draft: 'Borrador',
  sent: 'Enviado',
  delivered: 'Entregado',
  responded: 'Respondió',
  issued: 'Emitido',
  validated: 'Validado',
  processing: 'En procesamiento',
};
const categories: Record<string, Record<string, string>> = {
  clase: { accion: 'Acción', actividad: 'Actividad' },
  origen: { sistema: 'Sistema', manual: 'Manual' },
  prioridad: {
    low: 'Baja',
    normal: 'Normal',
    medium: 'Media',
    high: 'Alta',
    critical: 'Crítica',
    urgent: 'Urgente',
    baja: 'Baja',
    media: 'Media',
    alta: 'Alta',
    urgente: 'Urgente',
  },
  acceso: {
    private: 'Privado',
    public: 'Público con código',
    private_invite: 'Privado',
    public_code: 'Público con código',
  },
  rol: {
    owner: 'Propietario',
    admin: 'Administrador',
    member: 'Miembro',
    signer: 'Firmante',
    reviewer: 'Revisor',
    approver: 'Aprobador',
  },
};
const technical = new Set(['estado', 'clase', 'origen', 'prioridad', 'acceso', 'rol']);

export function reportCategoryLabel(value: ReportRow[string], fieldId: string): string {
  if (value == null || value === '') return 'Sin dato';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  const text = String(value);
  const key = text.toLocaleLowerCase('es');
  if (fieldId === 'estado') {
    if (Object.hasOwn(statusLabels, key)) return statusLabels[key];
    if (Object.hasOwn(CASE_STATUS_META, key))
      return CASE_STATUS_META[key as keyof typeof CASE_STATUS_META].label;
    return text.replace(/_/g, ' ');
  }
  const labels = Object.hasOwn(categories, fieldId) ? categories[fieldId] : undefined;
  return labels && Object.hasOwn(labels, key) ? labels[key] : text;
}

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (value: string) =>
  dateOnly.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;

function calendarDay(value: string): string {
  if (validDay(value)) return value;
  if (dateOnly.test(value)) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

const reportDayFormatter = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'medium',
  timeZone: 'UTC',
});
const reportInstantFormatter = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function displayValue(value: ReportRow[string], type?: FieldType): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (type === 'date') {
    const text = String(value);
    const dayOnly = validDay(text);
    const date = new Date(dayOnly ? text + 'T12:00:00Z' : text);
    if (Number.isFinite(date.getTime())) {
      return (dayOnly ? reportDayFormatter : reportInstantFormatter).format(date);
    }
  }
  return String(value);
}

export function displayReportValue(value: ReportRow[string], field: ReportField): string {
  if (value == null || value === '') return '—';
  return technical.has(field.id)
    ? reportCategoryLabel(value, field.id)
    : displayValue(value, field.type);
}

function compare(value: ReportRow[string], condition: Condition, type: FieldType) {
  const actual = value == null ? '' : String(value).trim();
  const expected = condition.value.trim();
  const operator = condition.operator;
  if (operator === 'empty') return !actual;
  if (operator === 'not_empty') return Boolean(actual);
  if (!actual || !expected) return false;

  let comparison: number;
  if (type === 'date' || type === 'number') {
    const left = type === 'date' ? calendarDay(actual) : Number(actual);
    const right = type === 'date' ? expected : Number(expected);
    if (
      type === 'date'
        ? !left || !validDay(expected)
        : !Number.isFinite(left) || !Number.isFinite(right)
    )
      return false;
    comparison = left > right ? 1 : left < right ? -1 : 0;
  } else {
    const raw = searchableReportText(actual);
    const label = searchableReportText(reportCategoryLabel(value, condition.field));
    const text = searchableReportText(expected);
    const boolValue = ['si', '1', 'true'].includes(text)
      ? 'true'
      : ['no', '0', 'false'].includes(text)
        ? 'false'
        : '';
    if (type === 'boolean' && !boolValue) return false;
    if (operator === 'contains') return raw.includes(text) || label.includes(text);
    comparison = (type === 'boolean' ? raw === boolValue : raw === text || label === text) ? 0 : 1;
  }

  if (operator === 'eq') return comparison === 0;
  if (operator === 'neq') return comparison !== 0;
  if (operator === 'gt') return comparison > 0;
  if (operator === 'gte') return comparison >= 0;
  if (operator === 'lt') return comparison < 0;
  return comparison <= 0;
}

const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
const periodDays = { all: 0, '7d': 7, '30d': 30, '90d': 90, '1y': 365 } as const;

export function runReport(
  rows: ReportRow[],
  config: ReportConfig,
  fields: ReportField[]
): ReportRow[] {
  const types = new Map(fields.map((field) => [field.id, field.type]));
  const valid = (config.conditions || []).filter((item) => types.has(item.field));
  const days = periodDays[config.period] || 0;
  const now = Date.now();
  const from = days ? now - days * 86400000 : 0;
  return rows
    .filter((row) => {
      if (from && types.get(config.dateField) === 'date') {
        const timestamp = Date.parse(String(row[config.dateField] ?? ''));
        if (!Number.isFinite(timestamp) || timestamp < from || timestamp > now) return false;
      }
      const matches = (item: Condition) => compare(row[item.field], item, types.get(item.field)!);
      return config.match === 'any'
        ? valid.length === 0 || valid.some(matches)
        : valid.every(matches);
    })
    .sort((a, b) => {
      const type = types.get(config.sortBy);
      if (!type) return 0;
      const left = a[config.sortBy],
        right = b[config.sortBy];
      if (left == null || left === '') return right == null || right === '' ? 0 : 1;
      if (right == null || right === '') return -1;
      const order =
        type === 'number'
          ? Number(left) - Number(right)
          : type === 'date'
            ? Date.parse(String(left)) - Date.parse(String(right))
            : collator.compare(
                reportCategoryLabel(left, config.sortBy),
                reportCategoryLabel(right, config.sortBy)
              );
      return config.sortDirection === 'asc' ? order : -order;
    });
}

export function selectedReportFields(config: ReportConfig, fields: ReportField[]) {
  const byId = new Map(fields.map((field) => [field.id, field]));
  return config.fields.flatMap((id) => byId.get(id) ?? []);
}

export function aggregate(
  rows: ReportRow[],
  groupBy: string,
  metric: string
): { label: string; value: number }[] {
  return buildReportSeries(rows, { groupBy, metric, visualization: 'bar' }, []).items.map(
    ({ label, value }) => ({ label, value: value ?? 0 })
  );
}

export function buildReportSeries(
  rows: ReportRow[],
  config: Pick<
    ReportConfig,
    'groupBy' | 'metric' | 'metricOperation' | 'visualization' | 'dateBucket'
  >,
  fields: ReportField[]
) {
  const groups = new Map<string, { sum: number; values: number }>();
  const dateGroup = fields.find((field) => field.id === config.groupBy)?.type === 'date';
  const average = config.metric !== '__count' && config.metricOperation === 'average';
  for (const row of rows) {
    const raw = row[config.groupBy];
    const day = dateGroup && raw ? calendarDay(String(raw)) : '';
    const label = !config.groupBy
      ? 'Total'
      : dateGroup
        ? day
          ? day.slice(0, config.dateBucket === 'month' ? 7 : 10)
          : 'Sin dato'
        : fields.length
          ? reportCategoryLabel(raw, config.groupBy)
          : String(raw ?? 'Sin dato');
    const existing = groups.get(label) || { sum: 0, values: 0 };
    const amount = config.metric === '__count' ? 1 : row[config.metric];
    if ((typeof amount === 'string' && amount.trim()) || typeof amount === 'number') {
      const number = Number(amount);
      if (Number.isFinite(number)) {
        existing.sum += number;
        existing.values++;
      }
    }
    groups.set(label, existing);
  }
  const format = ({ sum, values }: { sum: number; values: number }) =>
    average ? (values ? Math.round((sum / values) * 100) / 100 : null) : sum;
  const entries = [...groups.entries()].sort((a, b) =>
    dateGroup
      ? collator.compare(a[0], b[0])
      : (format(b[1]) ?? -Infinity) - (format(a[1]) ?? -Infinity) || collator.compare(a[0], b[0])
  );
  const limit = dateGroup && config.visualization === 'line' ? 366 : 24;
  const visible = entries.slice(
    dateGroup && config.visualization === 'line' ? -limit : 0,
    dateGroup && config.visualization === 'line' ? undefined : limit
  );
  const items = visible.map(([label, summary]) => ({ key: label, label, value: format(summary) }));
  if (entries.length > limit && !dateGroup && !average) {
    items.push({
      key: '__other',
      label: 'Otros',
      value: entries.slice(limit).reduce((sum, [, item]) => sum + item.sum, 0),
    });
  }
  return { items, totalGroups: entries.length };
}

export function reportConfigIssue(config: ReportConfig, fields: ReportField[]): string {
  const byId = new Map(fields.map((field) => [field.id, field]));
  if (!config.fields.length) return 'Selecciona al menos un campo para el informe.';
  if (config.fields.some((id) => !byId.has(id)))
    return 'Algunos campos guardados ya no están disponibles.';
  if (config.period !== 'all' && byId.get(config.dateField)?.type !== 'date')
    return 'Selecciona una fecha de referencia para el periodo.';
  if (config.sortBy && !byId.has(config.sortBy))
    return 'Selecciona un campo disponible para ordenar.';
  for (const condition of config.conditions) {
    const field = byId.get(condition.field);
    if (!field || !operatorsForType(field.type).some(([id]) => id === condition.operator))
      return 'Revisa los campos y operadores de las condiciones.';
    if (condition.operator === 'empty' || condition.operator === 'not_empty') continue;
    const value = condition.value.trim();
    if (
      !value ||
      (field.type === 'date' && !validDay(value)) ||
      (field.type === 'number' && !Number.isFinite(Number(value))) ||
      (field.type === 'boolean' &&
        !['si', 'no', 'true', 'false', '1', '0'].includes(searchableReportText(value)))
    )
      return 'Completa un valor válido en cada condición.';
  }
  if (config.visualization === 'table') return '';
  if (config.visualization !== 'kpi' && !config.groupBy)
    return 'Elige el campo de agrupación para la gráfica.';
  if (config.groupBy && (!byId.has(config.groupBy) || byId.get(config.groupBy)?.type === 'number'))
    return 'Elige un campo de agrupación disponible.';
  if (config.metric !== '__count' && byId.get(config.metric)?.type !== 'number')
    return 'Selecciona una medida numérica o el número de registros.';
  return '';
}

export function safeConfig(config: unknown, dataset: DatasetId): ReportConfig {
  const fallback = defaultConfig(dataset);
  const source =
    config && typeof config === 'object' && !Array.isArray(config)
      ? (config as Partial<ReportConfig>)
      : {};
  const fields = new Map(DATASETS[dataset].fields.map((field) => [field.id, field.type]));
  const validField = (id: unknown): id is string =>
    typeof id === 'string' &&
    (fields.has(id) || (dataset === 'respuestas' && /^respuesta\..{1,200}$/.test(id)));
  const accepted = [
    ...new Set((Array.isArray(source.fields) ? source.fields : fallback.fields).filter(validField)),
  ];
  const validOperators = new Set<string>(reportOperators.map(([id]) => id));
  const conditions = (Array.isArray(source.conditions) ? source.conditions : [])
    .filter((item) => item && validField(item.field) && validOperators.has(item.operator))
    .slice(0, 12)
    .map((item) => ({
      field: item.field,
      operator: item.operator,
      value: typeof item.value === 'string' ? item.value.slice(0, 500) : '',
    }));
  const period = reportPeriods.some(([id]) => id === source.period)
    ? source.period!
    : fallback.period;
  const selectedDate =
    validField(source.dateField) &&
    (fields.get(source.dateField) === 'date' || !fields.has(source.dateField))
      ? source.dateField
      : '';

  return {
    fields: accepted.length ? accepted : fallback.fields,
    conditions,
    match: source.match === 'any' ? 'any' : 'all',
    period,
    dateField:
      selectedDate || (source.dateField === '' && period === 'all' ? '' : fallback.dateField),
    groupBy:
      validField(source.groupBy) && fields.get(source.groupBy) !== 'number' ? source.groupBy : '',
    metric:
      validField(source.metric) &&
      (!fields.has(source.metric) || fields.get(source.metric) === 'number')
        ? source.metric
        : '__count',
    metricOperation: source.metricOperation === 'average' ? 'average' : 'sum',
    dateBucket: source.dateBucket === 'month' ? 'month' : 'day',
    ...(dataset === 'respuestas' &&
    typeof source.formId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(source.formId)
      ? { formId: source.formId }
      : {}),
    sortBy: validField(source.sortBy) ? source.sortBy : source.sortBy === '' ? '' : fallback.sortBy,
    sortDirection: source.sortDirection === 'asc' ? 'asc' : 'desc',
    visualization: ['table', 'bar', 'line', 'pie', 'kpi'].includes(source.visualization || '')
      ? source.visualization!
      : fallback.visualization,
  };
}
