export const SIGNING_METHOD_LABELS = {
  autografa: 'Firma autógrafa digital',
  efirma: 'e.firma SAT',
  clicksign: 'Click & Sign',
} as const;

export type SigningMethod = keyof typeof SIGNING_METHOD_LABELS;
export const SIGNERS_SHEET_PDF_PAGE_KEY = 'DocuboxSignersSheet';

const signatureMethods: SigningMethod[] = ['autografa', 'efirma', 'clicksign'];

function configuredMethodValues(participant?: Record<string, unknown> | null) {
  const configured = participant?.tipoFirma ?? participant?.tipo_firma;
  return Array.isArray(configured)
    ? configured
    : configured
      ? [configured]
      : [participant?.metodo_firma, participant?.metodoFirma, participant?.signatureMethod];
}

export function getConfiguredSigningMethods(participant?: Record<string, unknown> | null) {
  const tokens = configuredMethodValues(participant).map((value) =>
    String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z]/g, '')
  );

  return signatureMethods.filter((method) =>
    tokens.some((token) => {
      if (method === 'efirma') return token === 'efirma' || token === 'efirmasat';
      if (method === 'autografa') return token === 'autografa' || token === 'autografadigital' || token === 'firmaautografadigital';
      return token === 'clicksign' || token === 'clickandsign';
    })
  );
}

export function isSigningMethod(value: unknown): value is SigningMethod {
  return value === 'autografa' || value === 'efirma' || value === 'clicksign';
}

export function getAvailableSigningMethods(participant?: Record<string, unknown> | null) {
  return configuredMethodValues(participant).some((value) => String(value ?? '').trim())
    ? getConfiguredSigningMethods(participant)
    : signatureMethods;
}

export type SignaturePosition = { page: number; x: number; y: number; width: number; height: number };

export function isSignaturePosition(value: unknown): value is SignaturePosition {
  if (!value || typeof value !== 'object') return false;
  const { page, x, y, width, height } = value as SignaturePosition;
  return (
    Number.isInteger(page) && page > 0 &&
    [x, y, width, height].every(Number.isFinite) &&
    x >= 0 && x < 100 && y >= 0 && y < 100 &&
    width > 0 && width <= 100 && height > 0 && height <= 100
  );
}
