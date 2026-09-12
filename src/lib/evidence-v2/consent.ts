import { sha256Hex } from '@/lib/certification/canonical';

export const SIGNATURE_CONSENT_VERSION = 'docubox-signature-consent-v1';
export const SIGNATURE_CONSENT_TEXT =
  'Confirmo que revisé el documento, que deseo firmarlo mediante el método seleccionado y que los datos técnicos de esta operación se conservarán como evidencia de mi consentimiento.';
export const SIGNATURE_CONSENT_SHA256 = sha256Hex(SIGNATURE_CONSENT_TEXT.normalize('NFC'));

export function signatureConsentSnapshot(acceptedAt: string) {
  const instant = new Date(acceptedAt);
  if (Number.isNaN(instant.getTime()))
    throw new TypeError('acceptedAt must be an ISO-8601 instant');
  return {
    textVersion: SIGNATURE_CONSENT_VERSION,
    textHash: SIGNATURE_CONSENT_SHA256,
    accepted: true as const,
    acceptedAt: instant.toISOString(),
  };
}
