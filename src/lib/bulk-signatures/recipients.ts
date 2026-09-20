export type BulkRecipientInput = {
  sourceRowId: string;
  name: string;
  email: string;
  phone?: string;
  payload: Record<string, string>;
};

export type BulkRecipientValidation = {
  total: number;
  valid: BulkRecipientInput[];
  errors: Array<{ row: number; code: string; message: string }>;
  duplicateEmails: string[];
};

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index++;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value.trim());
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(value.trim());
      value = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else value += char;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('es-MX')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function firstValue(payload: Record<string, string>, names: string[]) {
  for (const name of names) if (payload[name]) return payload[name].trim();
  return '';
}

export function parseBulkRecipientCsv(text: string): BulkRecipientInput[] {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ''));
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((values, index) => {
    const payload = Object.fromEntries(
      headers.map((header, column) => [header, values[column] || ''])
    );
    return {
      sourceRowId: String(index + 2),
      name: firstValue(payload, ['nombre', 'name', 'nombre_completo', 'participant_name']),
      email: firstValue(payload, [
        'correo',
        'email',
        'correo_electronico',
        'participant_email',
      ]).toLowerCase(),
      phone: firstValue(payload, ['telefono', 'phone', 'numero_telefonico']) || undefined,
      payload,
    };
  });
}

export function validateBulkRecipients(input: BulkRecipientInput[]): BulkRecipientValidation {
  const errors: BulkRecipientValidation['errors'] = [];
  const valid: BulkRecipientInput[] = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  input.slice(0, 10_001).forEach((recipient, index) => {
    const row = Number(recipient.sourceRowId || index + 2);
    const name = recipient.name.trim();
    const email = recipient.email.trim().toLowerCase();
    if (!name) errors.push({ row, code: 'NAME_REQUIRED', message: 'Falta el nombre.' });
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      errors.push({ row, code: 'EMAIL_INVALID', message: 'El correo no es valido.' });
    }
    if (seen.has(email)) {
      duplicates.add(email);
      errors.push({ row, code: 'EMAIL_DUPLICATE', message: 'El correo esta duplicado.' });
    }
    seen.add(email);
    if (name && /^\S+@\S+\.\S+$/.test(email) && !duplicates.has(email)) {
      valid.push({ ...recipient, name, email });
    }
  });
  if (input.length > 10_000) {
    errors.push({
      row: 10_001,
      code: 'LIMIT_EXCEEDED',
      message: 'El maximo es 10,000 destinatarios.',
    });
  }
  const duplicateEmails = [...duplicates];
  return {
    total: input.length,
    valid: valid.filter((recipient) => !duplicates.has(recipient.email)),
    errors,
    duplicateEmails,
  };
}
