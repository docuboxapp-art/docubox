const contactResourceKinds = ['formularios', 'expedientes', 'identidad', 'aportada'] as const;
export type ContactResourceKind = (typeof contactResourceKinds)[number];

export function isContactResourceKind(value: unknown): value is ContactResourceKind {
  return contactResourceKinds.some((kind) => kind === value);
}

export const contactContributionOrigins = {
  expediente: 'Expediente',
  identidad: 'Validación de identidad',
} as const;

export type ContactContributionOrigin = keyof typeof contactContributionOrigins;

export type ContactResource = {
  id: string;
  title: string;
  reference?: string;
  context: string;
  origin?: ContactContributionOrigin;
  description?: string;
  status: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  date: string;
  action?: { href: string; label: string };
  progress?: number;
};

export type ContactFieldRow = {
  id: string;
  contact_id: string;
  field_name: string;
  field_value: string | null;
  created_at: string;
  updated_at: string;
};

export const CONTACT_SECTION = 'contact_profile_section';
export const CONTACT_FIELD = 'contact_profile_field';
export const CONTACT_RELATION_PREFIX = 'contact_relationship:';
export const CONTACT_FIELD_COLUMNS = 'id,contact_id,field_name,field_value,created_at,updated_at';

export const contactFieldTypes = {
  text: 'Texto',
  multiline: 'Texto largo',
  number: 'Número',
  currency: 'Moneda',
  percent: 'Porcentaje',
  date: 'Fecha',
  time: 'Hora',
  datetime: 'Fecha y hora',
  email: 'Correo electrónico',
  tel: 'Teléfono',
  url: 'Enlace web',
  boolean: 'Sí o no',
  select: 'Lista desplegable',
  combobox: 'Lista editable (combobox)',
  radio: 'Opción única',
  multiselect: 'Selección múltiple',
  related: 'Contacto relacionado',
  related_multiple: 'Contactos relacionados',
  address: 'Dirección',
  postal_code: 'Código postal (México)',
  identifier: 'Identificador',
} as const;

export type ContactFieldType = keyof typeof contactFieldTypes;
export const contactFieldChoiceTypes = new Set<ContactFieldType>([
  'select',
  'combobox',
  'radio',
  'multiselect',
]);
export const contactFieldCurrencies = [
  'MXN',
  'USD',
  'EUR',
  'CAD',
  'GBP',
  'BRL',
  'COP',
  'JPY',
] as const;
export const CONTACT_FIELD_OPTION_LIMIT = 40;
export const CONTACT_FIELD_OPTION_LENGTH = 100;

export type ContactFieldDefinition = {
  sectionId: string;
  label: string;
  type: ContactFieldType;
  defaultValue?: string;
  options?: string[];
  currency?: (typeof contactFieldCurrencies)[number];
};

export type ContactField = ContactFieldDefinition & {
  value: string;
  captured: boolean;
};

export type ContactRelationship = { label: string; note: string };

export const normalizeContactEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

// PostgREST accepts '*' as a LIKE wildcard, even when it appears in an address.
export function contactEmailPattern(email: string) {
  return email.includes('*') ? null : email.replace(/[\\%_]/g, '\\$&');
}

function readObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function readContactField(row: ContactFieldRow): ContactField | null {
  if (row.field_name !== CONTACT_FIELD) return null;
  const data = readObject(row.field_value);
  if (
    typeof data?.sectionId !== 'string' ||
    typeof data.label !== 'string' ||
    !data.label.trim() ||
    typeof data.type !== 'string' ||
    !Object.hasOwn(contactFieldTypes, data.type) ||
    typeof data.value !== 'string'
  )
    return null;
  const type = data.type as ContactFieldType;
  const currency = contactFieldCurrencies.find((code) => code === data.currency);
  return {
    sectionId: data.sectionId,
    label: data.label,
    type,
    ...(contactFieldChoiceTypes.has(type) && Array.isArray(data.options)
      ? { options: data.options.filter((option): option is string => typeof option === 'string') }
      : {}),
    ...(type === 'currency' && currency ? { currency } : {}),
    ...(typeof data.defaultValue === 'string' ? { defaultValue: data.defaultValue } : {}),
    value: data.value,
    captured: typeof data.captured === 'boolean' ? data.captured : data.value !== '',
  };
}

export function getContactFieldValue(field: ContactField) {
  return field.captured ? field.value : (field.defaultValue ?? '');
}

export function readContactFieldSelections(value: string): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : [];
  } catch {
    return [];
  }
}

function isCalendarDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    !value.startsWith('0000')
  );
}

const contactFieldTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/;
const contactFieldDecimalPattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

export function normalizeContactFieldValue(
  field: ContactFieldDefinition,
  raw: string,
  contactIds: ReadonlySet<string>
): string {
  const value = raw.trim();
  if (!value) return '';
  switch (field.type) {
    case 'select':
    case 'radio':
      if (!field.options?.includes(value)) throw new Error('Selecciona una opción de la lista.');
      return value;
    case 'related':
      if (!contactIds.has(value)) throw new Error('Selecciona un contacto de tu agenda.');
      return value;
    case 'multiselect':
    case 'related_multiple': {
      const values = readContactFieldSelections(value);
      const allowed = field.type === 'related_multiple' ? contactIds : new Set(field.options);
      if ((values.length === 0 && value !== '[]') || values.some((item) => !allowed.has(item)))
        throw new Error('Selecciona únicamente opciones disponibles.');
      return values.length ? JSON.stringify([...new Set(values)]) : '';
    }
    case 'boolean':
      if (value !== 'true' && value !== 'false') throw new Error('Selecciona Sí o No.');
      return value;
    case 'number':
    case 'currency':
    case 'percent': {
      const decimal = value.replace(',', '.').replace(/^\+/, '');
      const valid =
        field.type === 'number'
          ? /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(decimal)
          : contactFieldDecimalPattern.test(decimal);
      if (decimal.length > 64 || !valid || !Number.isFinite(Number(decimal)))
        throw new Error('Escribe un número válido sin separadores de miles.');
      if (field.type === 'currency') {
        const { maximumFractionDigits = 2 } = new Intl.NumberFormat('es-MX', {
          style: 'currency',
          currency: field.currency ?? 'MXN',
        }).resolvedOptions();
        if ((decimal.split('.')[1]?.length ?? 0) > maximumFractionDigits)
          throw new Error(`Esta moneda admite hasta ${maximumFractionDigits} decimales.`);
      }
      return decimal;
    }
    case 'date':
      if (!isCalendarDate(value)) throw new Error('Escribe una fecha válida.');
      return value;
    case 'time':
      if (!contactFieldTimePattern.test(value)) throw new Error('Escribe una hora válida.');
      return value;
    case 'datetime': {
      const [date, time, extra] = value.split('T');
      if (extra !== undefined || !isCalendarDate(date) || !contactFieldTimePattern.test(time ?? ''))
        throw new Error('Escribe una fecha y una hora válidas.');
      return value;
    }
    case 'email':
      if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        throw new Error('Escribe un correo electrónico válido.');
      return value;
    case 'url': {
      if (value.length <= 2000 && /^https?:\/\//i.test(value)) {
        try {
          if (new URL(value).hostname) return value;
        } catch {
          // Show the same message for an invalid URL and an unsupported scheme.
        }
      }
      throw new Error('Escribe una dirección web que empiece con https:// o http://.');
    }
    case 'postal_code':
      if (!/^\d{5}$/.test(value)) throw new Error('Escribe un código postal de cinco dígitos.');
      return value;
    default: {
      const limit =
        field.type === 'multiline' || field.type === 'address'
          ? 2000
          : field.type === 'tel'
            ? 60
            : 240;
      if (value.length > limit) throw new Error(`Usa hasta ${limit} caracteres.`);
      return value;
    }
  }
}

export function canKeepContactFieldValue(
  current: ContactField,
  next: ContactFieldDefinition,
  contactIds: ReadonlySet<string>
) {
  if (!current.captured || !current.value) return true;
  if (current.type === next.type) {
    if (next.type === 'currency') return (current.currency ?? 'MXN') === (next.currency ?? 'MXN');
    if (!['select', 'radio', 'multiselect'].includes(next.type)) return true;
  } else {
    const structuredTypes: ContactFieldType[] = ['multiselect', 'related', 'related_multiple'];
    if (structuredTypes.includes(current.type) || structuredTypes.includes(next.type)) return false;
  }
  try {
    return normalizeContactFieldValue(next, current.value, contactIds) === current.value;
  } catch {
    return false;
  }
}

export function readContactRelationship(row: ContactFieldRow): ContactRelationship | null {
  if (!row.field_name.startsWith(CONTACT_RELATION_PREFIX)) return null;
  const data = readObject(row.field_value);
  if (typeof data?.label !== 'string' || !data.label.trim() || typeof data.note !== 'string')
    return null;
  return { label: data.label, note: data.note };
}
