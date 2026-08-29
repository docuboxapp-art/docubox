import { CertificationError } from './types';

export type CryptoProviderMode = 'development' | 'production';

function enabled(value: string | undefined) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'enabled';
}

/** Production is deliberately opt-in; an unset mode cannot accidentally use a production signer. */
export function getCryptoProviderMode(): CryptoProviderMode {
  const value = String(process.env.CRYPTO_PROVIDER_MODE || 'development').trim().toLowerCase();
  if (process.env.NODE_ENV === 'production' && value !== 'production') {
    throw new CertificationError('PRODUCTION_HSM_REQUIRED', 'NODE_ENV=production requiere CRYPTO_PROVIDER_MODE=production y Google Cloud HSM.', 503);
  }
  if (value === 'development') return 'development';
  if (value === 'production') return 'production';
  throw new CertificationError('CRYPTO_PROVIDER_MODE_INVALID', 'CRYPTO_PROVIDER_MODE debe ser development o production.', 503);
}

export function isProductionCertificationEnabled() {
  return enabled(process.env.PRODUCTION_CERTIFICATION_ENABLED);
}

export function assertProductionCertificationEnabled() {
  if (getCryptoProviderMode() === 'production' && !isProductionCertificationEnabled()) {
    throw new CertificationError('PRODUCTION_CERTIFICATION_DISABLED', 'La certificacion de produccion esta deshabilitada hasta completar la activacion controlada.', 503);
  }
}
