import { formatFormAddress } from '@/lib/forms/schema';
import type { FieldType, ReportField, ReportRow } from './catalog';

type FormColumns = { id: string; name: string; schema?: unknown; form_schema?: unknown };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function formDefinitionFields(form: Pick<FormColumns, 'schema' | 'form_schema'>) {
  const current = record(form.form_schema).fields;
  const raw = Array.isArray(current) ? current : Array.isArray(form.schema) ? form.schema : [];
  return raw.map(record);
}

const textFields = new Set([
  'text',
  'textarea',
  'email',
  'phone',
  'time',
  'checkbox_group',
  'radio',
  'select',
  'estado_mx',
  'rfc',
  'curp',
  'nss',
  'clave_elector',
  'business_name',
  'fiscal_address',
  'person_first_name',
  'person_last_name',
  'person_second_last_name',
]);
const booleanFields = new Set(['checkbox', 'yes_no', 'consentimiento', 'declaration']);
const protectedCapture = new Set([
  'firma_efirma',
  'firma_autografa',
  'firma_click',
  'signature',
  'signature_block',
  'iniciales',
  'imagen',
  'documento',
  'file',
  'file_upload',
  'image',
]);

function getReportType(type: string): FieldType | null {
  if (type === 'number' || type === 'currency') return 'number';
  if (type === 'date' || type === 'datetime') return 'date';
  if (booleanFields.has(type)) return 'boolean';
  return textFields.has(type) ? 'text' : null;
}

export function responseColumns(forms: FormColumns[]) {
  const fields: ReportField[] = [];
  const sources = new Map<
    string,
    {
      fieldId: string;
      fieldLabel: string;
      column: ReportField;
      type: string;
      options: Map<string, string>;
      captured: boolean;
    }[]
  >();
  const aliases = new Map<string, { label: string; type: FieldType; ambiguous: boolean }>();

  for (const form of forms) {
    const seen = new Set<string>();
    const entries: NonNullable<ReturnType<typeof sources.get>> = [];
    for (const field of formDefinitionFields(form)) {
      if (
        typeof field.id !== 'string' ||
        !field.id ||
        field.id.length > 150 ||
        typeof field.label !== 'string' ||
        !field.label
      )
        continue;
      if (seen.has(field.id)) continue;
      const type = typeof field.type === 'string' ? field.type : '';
      const captured = protectedCapture.has(type);
      const reportType: FieldType | null = captured ? 'boolean' : getReportType(type);
      if (!reportType) continue;
      seen.add(field.id);
      const column: ReportField = {
        id: ['respuesta', form.id, field.id].join('.'),
        label: [form.name, field.label + (captured ? ' (capturado)' : '')].join(' · '),
        type: reportType,
      };
      const options = new Map<string, string>();
      if (Array.isArray(field.options)) {
        for (const raw of field.options) {
          const option = record(raw);
          if (typeof option.value === 'string' && typeof option.label === 'string')
            options.set(option.value, option.label);
        }
      }
      fields.push(column);
      entries.push({ fieldId: field.id, fieldLabel: field.label, column, type, options, captured });
      const alias = aliases.get(field.id);
      if (alias) alias.ambiguous = true;
      else aliases.set(field.id, { label: column.label, type: column.type, ambiguous: false });
    }
    sources.set(form.id, entries);
  }

  for (const [fieldId, alias] of aliases) {
    if (!alias.ambiguous)
      fields.push({
        id: 'respuesta.' + fieldId,
        label: alias.label,
        type: alias.type,
        legacy: true,
      });
  }
  fields.sort((a, b) => a.label.localeCompare(b.label, 'es'));

  function project(formId: string, payload: unknown): ReportRow {
    const values = record(payload);
    const row: ReportRow = {};
    for (const entry of sources.get(formId) ?? []) {
      const raw = Object.hasOwn(values, entry.fieldId) ? values[entry.fieldId] : undefined;
      let value: ReportRow[string] = null;
      if (entry.captured)
        value =
          raw != null && raw !== '' && raw !== false && (!Array.isArray(raw) || raw.length > 0);
      else if (raw != null && raw !== '') {
        if (entry.column.type === 'number') {
          const amount =
            typeof raw === 'number' || (typeof raw === 'string' && raw.trim()) ? Number(raw) : NaN;
          if (Number.isFinite(amount)) value = amount;
        } else if (entry.column.type === 'boolean') {
          const normalized = String(raw).trim().toLowerCase();
          if (['true', 'yes', 'si', 'sí', '1'].includes(normalized)) value = true;
          if (['false', 'no', '0'].includes(normalized)) value = false;
        } else if (entry.type === 'fiscal_address') value = formatFormAddress(raw) || null;
        else if (Array.isArray(raw))
          value =
            raw
              .filter((item) => typeof item === 'string' || typeof item === 'number')
              .map((item) => entry.options.get(String(item)) ?? String(item))
              .join(', ') || null;
        else if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean')
          value = entry.options.get(String(raw)) ?? raw;
      }
      row[entry.column.id] = value;
      if (!aliases.get(entry.fieldId)?.ambiguous) row['respuesta.' + entry.fieldId] = value;
    }
    return row;
  }
  return { fields, project };
}
