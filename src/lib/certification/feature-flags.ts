/**
 * Certification execution remains opt-in until the full provider chain is
 * configured in the target environment. This flag is intentionally backend
 * only: a browser must never be able to enable a cryptographic operation.
 */
export function isCryptoCertificationE2eEnabled() {
  const value = String(process.env.CRYPTO_CERTIFICATION_E2E_ENABLED || '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'enabled';
}
