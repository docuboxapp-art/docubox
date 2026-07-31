const ENVIA_SMS_TOKEN = process.env.ENVIA_SMS_TOKEN || '7b75c189-f537-45b9-b3bb-4af3b1af4843';
const ENVIA_SMS_BASE_URL = 'https://envia-sms.com/api/sms/send';
const ENVIA_SMS_PROJECT = process.env.ENVIA_SMS_PROJECT || '822486';

// Template IDs — configure via ENVIA_SMS_TEMPLATE_ID environment variable
// or set the default here. Must match a template created in your envia-sms.com panel.
const TEMPLATE_SIGNATURE_REQUEST =
  process.env.ENVIA_SMS_TEMPLATE_ID ?? '01';

export interface SendSmsParams {
  phone: string;       // e.g. "+52 55 1234 5678" or "5215512345678"
  recipientName?: string;
  documentName?: string;
  message?: string;
  templateId?: string;
  scheduledAt?: string; // YYYY-MM-DD HH:MM:SS (GMT-5)
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
function parsePhone(phone: string): { prefix: string; number: string } | null {
  // Remove all non-digit characters except leading +
  const cleaned = phone.replace(/[^\d+]/g, '');
  // If starts with +, strip it
  const digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;

  if (digits.length < 10) return null;

  // Mexico default: country code 52, rest is the number
  if (digits.startsWith('52') && digits.length >= 12) {
    return { prefix: '52', number: digits.slice(2) };
  }

  // Fallback: assume first 2 digits are country code
  return { prefix: digits.slice(0, 2), number: digits.slice(2) };
}

/**
 * Sends an SMS via envia-sms.com API.
 * Returns the API response or throws on network error.
 */
export async function sendSms(params: SendSmsParams): Promise<SmsApiResponse> {
  const parsed = parsePhone(params.phone);
  if (!parsed) {
    return {
      error: true,
      codigo_error: 'INVALID_PHONE',
      mensaje_error: `Número de teléfono inválido: ${params.phone}`,
    };
  }

  const templateId = params.templateId ?? TEMPLATE_SIGNATURE_REQUEST;
  const numeroParam = `${parsed.prefix},${parsed.number}`;

  const url = new URL(ENVIA_SMS_BASE_URL);
  url.searchParams.set('plantilla', templateId);
  url.searchParams.set('token', ENVIA_SMS_TOKEN);
  url.searchParams.set('numero', numeroParam);
  url.searchParams.set('proyecto', ENVIA_SMS_PROJECT);

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
