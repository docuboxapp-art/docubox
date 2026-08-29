/**
 * Deprecated adapter for the historical VPS signer that owns a local PEM key.
 *
 * It deliberately exposes no private-key material and must only be used by
 * backend code. New signing flows must target KeyManagementProvider instead.
 */
export class LegacyLocalPemSigningProvider {
  readonly providerId = 'legacy-local-pem';
  readonly status = 'deprecated' as const;

  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
  ) {}

  get isConfigured() {
    return Boolean(this.baseUrl && this.serviceToken);
  }

  async sign(formData: FormData) {
    if (!this.isConfigured) {
      throw new Error('LEGACY_PEM_SIGNER_NOT_CONFIGURED');
    }

    return fetch(`${this.baseUrl.replace(/\/$/, '')}/sign`, {
      method: 'POST',
      headers: { 'X-VPS-Token': this.serviceToken },
      body: formData,
      signal: AbortSignal.timeout(60_000),
    });
  }
}
