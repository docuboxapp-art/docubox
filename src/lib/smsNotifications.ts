import 'server-only';

const ENVIA_SMS_BASE_URL = 'https://envia-sms.com/api/sms/send';

export class SmsConfigurationError extends Error {
  constructor() {
    super('SMS_NOT_CONFIGURED');
    this.name = 'SmsConfigurationError';
  }
}

export interface SendSmsParams {
  phone: string; // e.g. "+52 55 1234 5678" or "5215512345678"
  recipientName?: string;
  documentName?: string;
  message?: string;
  templateId?: string;
  scheduledAt?: string; // YYYY-MM-DD HH:MM:SS (GMT-5)
  testMode?: boolean;
}

export interface SmsApiResponse {
  error: boolean;
  codigo_error?: string;
  mensaje_error?: string;
  response?: {
    mensaje: string;
    mensaje_enviado: string;
    numero: string;
    fecha_programada: string | null;
    identificador: Record<string, string>;
  };
}

/**
 * Normalizes a phone number to the format expected by envia-sms.com:
 * prefix (country code) + number, no spaces or symbols.
 * Example: "+52 55 1234 5678" → prefix="52", number="5512345678"
 */
export function normalizeSmsPhone(phone: string): string | null {
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('521')) digits = `52${digits.slice(3)}`;
  if (digits.length === 10) digits = `52${digits}`;
  if (!/^52\d{10}$/.test(digits)) return null;
  return `+${digits}`;
}

function smsConfiguration(templateId?: string) {
  const token = process.env.ENVIA_SMS_TOKEN?.trim() || '';
  const project = process.env.ENVIA_SMS_PROJECT?.trim() || '';
  const template = templateId?.trim() || process.env.ENVIA_SMS_TEMPLATE_ID?.trim() || '';
  if (token.length < 20 || !/^\d{1,20}$/.test(project) || !/^[a-zA-Z0-9_-]{1,40}$/.test(template)) {
    throw new SmsConfigurationError();
  }
  return { token, project, template };
}

export function isSmsConfigured() {
  try {
    smsConfiguration();
    return true;
  } catch {
    return false;
  }
}

/**
 * Sends an SMS via envia-sms.com API.
 * Returns the API response or throws on network error.
 */
export async function sendSms(params: SendSmsParams): Promise<SmsApiResponse> {
  const normalizedPhone = normalizeSmsPhone(params.phone);
  if (!normalizedPhone) {
    return {
      error: true,
      codigo_error: 'INVALID_PHONE',
      mensaje_error: 'Número de teléfono inválido.',
    };
  }

  const config = smsConfiguration(params.templateId);
  const numeroParam = `52,${normalizedPhone.slice(3)}`;

  const url = new URL(ENVIA_SMS_BASE_URL);
  url.searchParams.set('plantilla', config.template);
  url.searchParams.set('token', params.testMode ? `pruebas_${config.token}` : config.token);
  url.searchParams.set('numero', numeroParam);
  url.searchParams.set('proyecto', config.project);

  // Pass template variables if provided
  if (params.recipientName) {
    url.searchParams.set('var_nombre', params.recipientName);
  }
  if (params.documentName) {
    url.searchParams.set('var_documento', params.documentName);
  }
  if (params.message) {
    url.searchParams.set('var_mensaje', params.message);
  }
  if (params.scheduledAt) {
    url.searchParams.set('fecha_programar', params.scheduledAt);
  }

  // Allow duplicate sends within the same hour
  url.searchParams.set('duplicado', '1');

  const response = await fetch(url.toString());

  // Always attempt to parse the JSON body — envia-sms.com returns error details
  // in the body even on non-200 responses (403, 400, etc.)
  let data: SmsApiResponse;
  try {
    data = await response.json();
  } catch {
    // If body is not JSON, fall back to HTTP status info
    return {
      error: true,
      codigo_error: String(response.status),
      mensaje_error: `HTTP ${response.status}: ${response.statusText}`,
    };
  }

  // If HTTP error but we got a JSON body, return it directly (contains real error code)
  if (!response.ok && data) {
    return {
      error: true,
      codigo_error: data.codigo_error ?? String(response.status),
      mensaje_error: data.mensaje_error ?? `HTTP ${response.status}: ${response.statusText}`,
    };
  }

  return data;
}

/**
 * Sends a signature-request SMS notification to a participant.
 */
export async function sendSignatureRequestSms(params: {
  phone: string;
  recipientName?: string;
  documentName?: string;
  documentUrl?: string;
}): Promise<SmsApiResponse> {
  return sendSms({
    phone: params.phone,
    recipientName: params.recipientName,
    documentName: params.documentName,
    message: params.documentUrl,
  });
}

/**
 * Sends SMS notifications to all participants whose notificationMethod is 'sms'.
 */
export async function sendSignatureRequestSmsToParticipants(params: {
  participants: Array<{ name?: string; phone?: string; notificationMethod?: string }>;
  documentName: string;
  documentUrl?: string;
}): Promise<void> {
  const smsParticipants = params.participants.filter(
    (p) => p.notificationMethod === 'sms' && p.phone
  );

  await Promise.allSettled(
    smsParticipants.map((p) =>
      sendSignatureRequestSms({
        phone: p.phone!,
        recipientName: p.name,
        documentName: params.documentName,
        documentUrl: params.documentUrl,
      })
    )
  );
}
