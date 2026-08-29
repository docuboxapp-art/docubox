export type Nom151VerificationStatus = 'not_requested' | 'pending' | 'verified' | 'failed';
export type Nom151ProviderEnvironment = 'development' | 'production' | 'unconfirmed';

type Nom151PresentationInput = {
  verificationStatus?: string | null;
  environment?: string | null;
  productionTrusted?: boolean | null;
  processing?: boolean;
  failed?: boolean;
  requested?: boolean;
};

export function getNom151Presentation(input: Nom151PresentationInput) {
  const verificationStatus: Nom151VerificationStatus = input.verificationStatus === 'verified'
    ? 'verified'
    : input.failed
      ? 'failed'
      : input.processing || input.requested
        ? 'pending'
        : 'not_requested';

  const providerEnvironment: Nom151ProviderEnvironment = input.environment === 'production'
    ? 'production'
    : input.environment === 'development' || input.environment === 'sandbox'
      ? 'development'
      : 'unconfirmed';

  const statusLabel: Record<Nom151VerificationStatus, string> = {
    not_requested: 'No solicitada',
    pending: 'Pendiente',
    verified: 'Verificada',
    failed: 'Verificación fallida',
  };

  const providerEnvironmentLabel = input.productionTrusted === true
    ? 'Producción confirmada'
    : providerEnvironment === 'development'
      ? 'Desarrollo · pendiente de confirmación productiva'
      : 'Pendiente de confirmación productiva';

  return {
    verificationStatus,
    providerEnvironment,
    statusLabel: statusLabel[verificationStatus],
    integrityLabel: verificationStatus === 'verified'
      ? 'Verificada criptográficamente'
      : 'No verificada',
    providerEnvironmentLabel,
  };
}
