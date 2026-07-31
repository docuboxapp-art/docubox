// ============================================================
// Mexican Validators — RFC, CURP, Phone, NSS, CURP
// ============================================================

export interface RFCResult {
  valid: boolean;
  type: 'fisica' | 'moral' | null;
  error?: string;
}

export interface CURPResult {
  valid: boolean;
  sex: 'H' | 'M' | null;
  state: string | null;
  error?: string;
}

export interface PhoneResult {
  valid: boolean;
  formatted: string;
}

// ── RFC ──────────────────────────────────────────────────────
const RFC_FISICA_REGEX = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/i;
const RFC_MORAL_REGEX  = /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/i;

const RFC_CHARS = '0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ Ñ';

function rfcVerifierDigit(rfc: string): string {
  const base = rfc.slice(0, -1).toUpperCase();
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    const idx = RFC_CHARS.indexOf(base[i]);
    sum += idx * (base.length + 1 - i);
  }
  const remainder = sum % 11;
  if (remainder === 0) return '0';
  if (remainder === 1) return 'A';
  return String(11 - remainder);
}

export function validateRFC(rfc: string): RFCResult {
  if (!rfc) return { valid: false, type: null, error: 'RFC requerido' };
  const clean = rfc.trim().toUpperCase().replace(/\s/g, '');

  if (RFC_FISICA_REGEX.test(clean)) {
    // Validate verifier digit
    const expected = rfcVerifierDigit(clean);
    const last = clean.slice(-1);
    if (last !== expected) {
      return { valid: false, type: null, error: `Dígito verificador incorrecto (esperado: ${expected})` };
    }
    return { valid: true, type: 'fisica' };
  }

  if (RFC_MORAL_REGEX.test(clean)) {
    const expected = rfcVerifierDigit(clean);
    const last = clean.slice(-1);
    if (last !== expected) {
      return { valid: false, type: null, error: `Dígito verificador incorrecto (esperado: ${expected})` };
    }
    return { valid: true, type: 'moral' };
  }

  if (clean.length < 12) return { valid: false, type: null, error: 'RFC demasiado corto' };
  if (clean.length > 13) return { valid: false, type: null, error: 'RFC demasiado largo' };
  return { valid: false, type: null, error: 'Formato de RFC inválido' };
}

// ── CURP ─────────────────────────────────────────────────────
const CURP_REGEX = /^[A-Z]{1}[AEIOU]{1}[A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HM](AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[0-9A-Z]{1}\d{1}$/i;

const CURP_STATES: Record<string, string> = {
  AS: 'Aguascalientes', BC: 'Baja California', BS: 'Baja California Sur',
  CC: 'Campeche', CL: 'Colima', CM: 'Campeche', CS: 'Chiapas',
  CH: 'Chihuahua', DF: 'Ciudad de México', DG: 'Durango',
  GT: 'Guanajuato', GR: 'Guerrero', HG: 'Hidalgo',
  JC: 'Jalisco', MC: 'Estado de México', MN: 'Michoacán',
  MS: 'Morelos', NT: 'Nayarit', NL: 'Nuevo León',
  OC: 'Oaxaca', PL: 'Puebla', QT: 'Querétaro',
  QR: 'Quintana Roo', SP: 'San Luis Potosí', SL: 'Sinaloa',
  SR: 'Sonora', TC: 'Tabasco', TS: 'Tamaulipas',
  TL: 'Tlaxcala', VZ: 'Veracruz', YN: 'Yucatán',
  ZS: 'Zacatecas', NE: 'Nacido en el Extranjero',
};

export function validateCURP(curp: string): CURPResult {
  if (!curp) return { valid: false, sex: null, state: null, error: 'CURP requerida' };
  const clean = curp.trim().toUpperCase();

  if (clean.length !== 18) {
    return { valid: false, sex: null, state: null, error: `CURP debe tener 18 caracteres (tiene ${clean.length})` };
  }

  if (!CURP_REGEX.test(clean)) {
    return { valid: false, sex: null, state: null, error: 'Formato de CURP inválido' };
  }

  // Validate birth date
  const year  = parseInt(clean.slice(4, 6), 10);
  const month = parseInt(clean.slice(6, 8), 10);
  const day   = parseInt(clean.slice(8, 10), 10);
  const fullYear = year <= 99 ? (year <= 24 ? 2000 + year : 1900 + year) : year;
  const date = new Date(fullYear, month - 1, day);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { valid: false, sex: null, state: null, error: 'Fecha de nacimiento inválida en CURP' };
  }

  const sexChar = clean[10] as 'H' | 'M';
  const stateCode = clean.slice(11, 13);
  const stateName = CURP_STATES[stateCode] || null;

  return { valid: true, sex: sexChar, state: stateName };
}

// ── Phone MX ─────────────────────────────────────────────────
export function validatePhoneMX(phone: string): PhoneResult {
  if (!phone) return { valid: false, formatted: '' };
  const digits = phone.replace(/\D/g, '');
  // Accept 10 digits or 12 digits starting with 52
  const core = digits.startsWith('52') && digits.length === 12 ? digits.slice(2) : digits;
  if (core.length !== 10) return { valid: false, formatted: '' };
  const formatted = `+52 (${core.slice(0, 2)}) ${core.slice(2, 6)}-${core.slice(6)}`;
  return { valid: true, formatted };
}

// ── NSS ──────────────────────────────────────────────────────
export function validateNSS(nss: string): { valid: boolean; error?: string } {
  if (!nss) return { valid: false, error: 'NSS requerido' };
  const digits = nss.replace(/\D/g, '');
  if (digits.length !== 11) return { valid: false, error: 'NSS debe tener 11 dígitos' };
  return { valid: true };
}

// ── Clave Elector INE ────────────────────────────────────────
export function validateClaveElector(clave: string): { valid: boolean; error?: string } {
  if (!clave) return { valid: false, error: 'Clave de elector requerida' };
  const clean = clave.trim().toUpperCase();
  if (clean.length !== 18) return { valid: false, error: 'Clave de elector debe tener 18 caracteres' };
  const regex = /^[A-Z]{6}\d{8}[HM]\d{3}$/;
  if (!regex.test(clean)) return { valid: false, error: 'Formato de clave de elector inválido' };
  return { valid: true };
}

// ── Phone mask formatter ──────────────────────────────────────
export function formatPhoneMX(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
}
