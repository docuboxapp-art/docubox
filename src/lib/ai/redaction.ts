const SENSITIVE_PATTERNS = [
  /\b[A-Z][AEIOUX][A-Z]{2}\d{2}(?:0\d|1[0-2])(?:[0-2]\d|3[01])[HM][A-Z]{5}[A-Z0-9]\d\b/gi,
  /\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/gi,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /(?<!\d)(?:\+?52[\s.-]?)?(?:\d[\s.-]?){10}(?!\d)/g,
  /\b(?:otp|password|contrase(?:n|ñ)a|clave privada|private key|certificate|certificado)\s*[:=]\s*\S+/gi,
  /\bBearer\s+[A-Za-z0-9._~-]+/gi,
  /\/(?:portal-participante|registro-participante|form|expediente|sala|solicitud|subir-movil|captura-id-movil|enrolamiento)\/[^/?#\s]+/gi,
  /\b[A-Za-z0-9_-]{40,}\b/g,
];

export function redactSensitiveText(value: unknown, maxLength = 5_000) {
  let text = String(value ?? '').slice(0, maxLength);
  for (const pattern of SENSITIVE_PATTERNS) text = text.replace(pattern, '[REDACTADO]');
  return text;
}
