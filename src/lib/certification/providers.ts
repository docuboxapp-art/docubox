import { getCryptographicProviderStatus, signDigestWithKms } from './adapters';
import {
  LegacyLocalPemSigningProvider,
  GoogleCloudKmsProvider,
  OpenBaoTransitProvider,
  type KeyManagementProvider,
  type KeyMetadata,
  type ProviderHealth,
  type SignDigestInput,
} from './key-management';
import {
  DevelopmentCertificateProvider,
  ProductionCertificateProvider,
  type CertificateProvider,
} from './certificates';
import { PadesBbPdfSignatureProvider, type PdfSignatureProvider } from './pades';
import {
  LocalRfc3161Provider,
  ProductionTimestampAuthorityProvider,
  UnavailableTimestampAuthorityProvider,
  type TimestampAuthorityProvider,
} from './timestamp';
import { createExternalFreeTimestampProvider } from './external-timestamp';
import {
  IndependentPadesVerificationProvider,
  type IndependentVerificationProvider,
} from './independent-verification';
import {
  getCryptoProviderMode,
  isProductionCertificationEnabled,
  type CryptoProviderMode,
} from './provider-mode';
import { CertificationError, type VerifiedKmsSignature } from './types';

export type {
  KeyManagementProvider,
  KeyMetadata,
  ProviderHealth,
  SignDigestInput,
} from './key-management';

export {
  createGoogleCloudAuthProvider,
  AwsSubjectTokenProvider,
  AzureOidcSubjectTokenProvider,
  GenericOidcSubjectTokenProvider,
  GcpNativeGoogleCloudAuthProvider,
  LocalAdcGoogleCloudAuthProvider,
  VercelOidcSubjectTokenProvider,
  WorkloadIdentityGoogleCloudAuthProvider,
} from './google-cloud-auth';

export type {
  GoogleCloudAuthMode,
  GoogleCloudAuthProvider,
  HostingProvider,
  WorkloadSubjectTokenProvider,
} from './google-cloud-auth';

export type {
  TimestampAuthorityProvider,
  TimestampDigestInput,
  TimestampResult,
  TimestampVerificationResult,
} from './timestamp';

export type { PdfSignatureProvider } from './pades';

export type CertificationProviderSet = {
  mode: CryptoProviderMode;
  productionEnabled: boolean;
  keyManagement: KeyManagementProvider;
  certificate: CertificateProvider;
  timestampAuthority: TimestampAuthorityProvider;
  pdfSignature: PdfSignatureProvider;
  independentVerification: IndependentVerificationProvider;
  healthCheck(): Promise<ProviderHealth>;
};

function uniqueMissingRequirements(entries: readonly string[]) {
  return [
    ...new Set(entries.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)),
  ];
}

function healthFor(
  required: Array<'DOCUBOX_KMS_GATEWAY_URL' | 'DOCUBOX_TSA_URL' | 'DOCUBOX_PADES_GATEWAY_URL'>
): ProviderHealth {
  const current = getCryptographicProviderStatus();
  const missing = uniqueMissingRequirements(
    required.filter((name) => current.missing.includes(name))
  );
  return { ready: missing.length === 0, missing };
}

/** Temporary compatibility adapter for an authenticated external KMS gateway. */
export class GatewayKeyManagementProvider implements KeyManagementProvider {
  readonly providerId = 'gateway' as const;
  private readonly knownKeys = new Map<string, KeyMetadata>();

  async signDigest(input: SignDigestInput): Promise<VerifiedKmsSignature> {
    const result = await signDigestWithKms(input.purpose, input.digestSha256, input.canonicalBytes);
    this.knownKeys.set(result.keyId, {
      provider: 'gateway',
      keyId: result.keyId,
      keyVersion: result.keyVersion,
      algorithm: result.algorithm,
      keySizeBits: result.keySizeBits,
      protectionLevel: 'unknown',
      createdAt: result.signedAt,
      status: 'active',
      publicKeyPem: result.publicKeyPem,
    });
    return result;
  }

  async getPublicKey(keyId: string) {
    const metadata = await this.getKeyMetadata(keyId);
    if (!metadata.publicKeyPem) {
      throw new CertificationError(
        'GATEWAY_PUBLIC_KEY_UNAVAILABLE',
        'El gateway no expuso la llave publica configurada.',
        503
      );
    }
    return metadata.publicKeyPem;
  }

  async getKeyMetadata(keyId: string) {
    const metadata = this.knownKeys.get(keyId);
    if (!metadata) {
      throw new CertificationError(
        'GATEWAY_KEY_METADATA_UNAVAILABLE',
        'El gateway no expuso metadatos de la llave configurada.',
        503
      );
    }
    return metadata;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const status = healthFor(['DOCUBOX_KMS_GATEWAY_URL']);
    return { ...status, provider: this.providerId };
  }
}

function configuredDevelopmentKeyManagementProvider(): KeyManagementProvider {
  const requested = (
    process.env.DOCUBOX_KEY_MANAGEMENT_PROVIDER ||
    process.env.DOCUBOX_KMS_PROVIDER ||
    ''
  )
    .trim()
    .toLowerCase();
  if (requested === 'legacy-local-pem') return new LegacyLocalPemSigningProvider();
  if (requested === 'openbao') return OpenBaoTransitProvider.fromEnvironment();
  if (requested === 'gcp' || requested === 'google-cloud-kms')
    return GoogleCloudKmsProvider.fromEnvironment();
  if (requested && requested !== 'gateway') {
    throw new CertificationError(
      'KEY_MANAGEMENT_PROVIDER_INVALID',
      'El proveedor de llaves configurado no es valido.',
      503
    );
  }
  if (OpenBaoTransitProvider.missingConfiguration().length === 0) {
    return OpenBaoTransitProvider.fromEnvironment();
  }
  return new GatewayKeyManagementProvider();
}

export function createCertificationProviderSet(): CertificationProviderSet {
  const mode = getCryptoProviderMode();
  const productionEnabled = isProductionCertificationEnabled();
  const keyManagement =
    mode === 'production'
      ? GoogleCloudKmsProvider.fromEnvironment('production')
      : configuredDevelopmentKeyManagementProvider();
  const certificate =
    mode === 'production'
      ? ProductionCertificateProvider.fromEnvironment(keyManagement)
      : DevelopmentCertificateProvider.fromEnvironment(keyManagement);
  const timestampPolicy = (process.env.TSA_POLICY || '').trim().toLowerCase();
  const timestampAuthorityPromise =
    timestampPolicy === 'external-free'
      ? createExternalFreeTimestampProvider()
      : mode === 'production'
        ? ProductionTimestampAuthorityProvider.fromEnvironment()
        : LocalRfc3161Provider.fromEnvironment();
  const timestampAuthority: TimestampAuthorityProvider = {
    async timestampDigest(input) {
      return (
        (await timestampAuthorityPromise) || new UnavailableTimestampAuthorityProvider()
      ).timestampDigest(input);
    },
    async verifyTimestamp(token, input) {
      return (
        (await timestampAuthorityPromise) || new UnavailableTimestampAuthorityProvider()
      ).verifyTimestamp(token, input);
    },
    async healthCheck() {
      return (
        (await timestampAuthorityPromise) || new UnavailableTimestampAuthorityProvider()
      ).healthCheck();
    },
  };
  const pdfSignature = new PadesBbPdfSignatureProvider(
    keyManagement,
    certificate,
    timestampAuthority
  );
  const independentVerification = new IndependentPadesVerificationProvider(
    // Fresh verification-only instance; it never participates in signDigest.
    new PadesBbPdfSignatureProvider(keyManagement, certificate, timestampAuthority)
  );
  return {
    mode,
    productionEnabled,
    keyManagement,
    certificate,
    timestampAuthority,
    pdfSignature,
    independentVerification,
    healthCheck: async () => {
      const [key, certificateHealth, pades, timestamp, independent] = await Promise.all([
        keyManagement.healthCheck(),
        certificate.healthCheck(),
        pdfSignature.healthCheck(),
        timestampAuthority.healthCheck(),
        independentVerification.healthCheck(),
      ]);
      const productionReady = mode !== 'production' || productionEnabled;
      const timestampRequired = mode === 'production';
      return {
        // Development can issue an honestly verified B-B PDF without a TSA.
        // Production always requires the full, enabled B-T chain.
        ready:
          productionReady &&
          key.ready &&
          certificateHealth.ready &&
          pades.ready &&
          independent.ready &&
          (!timestampRequired || timestamp.ready),
        missing: uniqueMissingRequirements([
          ...(productionReady ? [] : ['PRODUCTION_CERTIFICATION_ENABLED']),
          ...key.missing,
          ...certificateHealth.missing,
          ...pades.missing,
          ...independent.missing,
          ...(timestampRequired ? timestamp.missing : []),
        ]),
        provider: key.provider,
        keyId: key.keyId,
        keyVersion: key.keyVersion,
      };
    },
  };
}

/**
 * Backward-compatible construction point. New code should call
 * createCertificationProviderSet so it resolves OpenBao when configured.
 */
export const gatewayCertificationProviders = createCertificationProviderSet;
