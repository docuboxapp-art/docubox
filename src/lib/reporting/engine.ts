import { DATASETS, defaultConfig, type Condition, type DatasetId, type ReportConfig, type ReportField, type ReportRow } from './catalog';

export function availableFields(dataset: DatasetId, fields?: ReportField[]) { return fields || DATASETS[dataset].fields; }

function compare(value: ReportRow[string], condition: Condition): boolean {
  const actual = value == null ? '' : String(value);
  const expected = condition.value.trim();
  if (condition.operator === 'empty') return actual === '';
  if (condition.operator === 'not_empty') return actual !== '';
  if (condition.operator === 'contains') return actual.toLocaleLowerCase('es').includes(expected.toLocaleLowerCase('es'));
  const first = Date.parse(actual), second = Date.parse(expected);
  const left = Number.isFinite(first) && Number.isFinite(second) && /\d{4}-\d{2}-\d{2}/.test(actual) ? first : Number(actual);
  const right = Number.isFinite(first) && Number.isFinite(second) && /\d{4}-\d{2}-\d{2}/.test(expected) ? second : Number(expected);
  if (condition.operator === 'eq') return actual.toLocaleLowerCase('es') === expected.toLocaleLowerCase('es');
  if (condition.operator === 'neq') return actual.toLocaleLowerCase('es') !== expected.toLocaleLowerCase('es');
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (condition.operator === 'gt') return left > right;
  if (condition.operator === 'gte') return left >= right;
  if (condition.operator === 'lt') return left < right;
  return left <= right;
}

export function runReport(rows: ReportRow[], config: ReportConfig, fields: ReportField[]): ReportRow[] {
  const known = new Set(fields.map(field => field.id));
  const valid = (config.conditions || []).filter(item => known.has(item.field));
  const days = config.period === '7d' ? 7 : config.period === '30d' ? 30 : config.period === '90d' ? 90 : config.period === '1y' ? 365 : 0;
  const from = days ? Date.now() - days * 86400000 : 0;
  return rows.filter(row => {
    if (from && config.dateField && known.has(config.dateField) && (!row[config.dateField] || new Date(String(row[config.dateField])).getTime() < from)) return false;
    return config.match === 'any' ? valid.length === 0 || valid.some(item => compare(row[item.field], item))
      : valid.every(item => compare(row[item.field], item));
  }).sort((a, b) => {
    const field = known.has(config.sortBy) ? config.sortBy : '';
    if (!field) return 0;
    const left = a[field], right = b[field];
    const value = typeof left === 'number' && typeof right === 'number' ? left - right
      : String(left ?? '').localeCompare(String(right ?? ''), 'es', { numeric: true });
    return config.sortDirection === 'asc' ? value : -value;
  });
}

export function aggregate(rows: ReportRow[], groupBy: string, metric: string): { label: string; value: number }[] {
  const groups = new Map<string, number>();
  rows.forEach(row => {
    const label = String(row[groupBy] ?? 'Sin dato');
    const amount = metric === '__count' ? 1 : Number(row[metric]) || 0;
    groups.set(label, (groups.get(label) || 0) + amount);
  });
  return [...groups].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 30);
}

export function displayValue(value: ReportRow[string], type?: ReportField['type']): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (type === 'date') {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }
  return String(value);
}

export function safeConfig(config: Partial<ReportConfig> | null | undefined, dataset: DatasetId): ReportConfig {
  const fallback = defaultConfig(dataset);
  const source = config || {};
  const fields = new Set(DATASETS[dataset].fields.map(field => field.id));
  const validField = (field: string) => fields.has(field) || (dataset === 'respuestas' && field.startsWith('respuesta.'));
  const accepted = (Array.isArray(source.fields) ? source.fields : fallback.fields)
    .filter((field): field is string => typeof field === 'string' && validField(field));
  const validOperators = new Set(['eq','neq','contains','gt','gte','lt','lte','empty','not_empty']);
  const conditions = (Array.isArray(source.conditions) ? source.conditions : [])
    .filter(item => item && typeof item.field === 'string' && validField(item.field) && validOperators.has(item.operator))
    .slice(0, 12);
  return { ...fallback, ...source, fields: accepted.length ? accepted : fallback.fields,
    conditions,
    match: source.match === 'any' ? 'any' : 'all',
    period: ['all','7d','30d','90d','1y'].includes(source.period || '') ? source.period! : fallback.period,
    dateField: source.dateField && validField(source.dateField) ? source.dateField : fallback.dateField,
    groupBy: source.groupBy && validField(source.groupBy) ? source.groupBy : '',
    metric: source.metric === '__count' || source.metric && validField(source.metric) ? source.metric : '__count',
    sortBy: source.sortBy && validField(source.sortBy) ? source.sortBy : fallback.sortBy,
    sortDirection: source.sortDirection === 'asc' ? 'asc' : 'desc',
    visualization: ['table','bar','line','pie','kpi'].includes(source.visualization || '') ? source.visualization! : fallback.visualization };
}
