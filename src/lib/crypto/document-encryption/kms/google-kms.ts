import { KeyManagementServiceClient } from '@google-cloud/kms';
import type { AuthClient } from 'google-auth-library';
import {
  createGoogleCloudAuthProvider,
  type GoogleCloudAuthProvider,
} from '@/lib/certification/google-cloud-auth';
import { DocumentEncryptionError } from '../errors';
import type {
  DocumentKeyManagementProvider,
  DocumentKeyMetadata,
  WrappedDocumentKey,
} from './provider';

type GoogleDocumentKmsClient = Pick<
  KeyManagementServiceClient,
  'encrypt' | 'decrypt' | 'getCryptoKey'
>;

type ClientFactory = (authClient: AuthClient) => GoogleDocumentKmsClient;

export type GoogleDocumentKmsConfiguration = {
  projectId: string;
  serviceAccountEmail: string;
  keyResource: string;
  requiredProtectionLevel: 'hsm' | 'software' | 'any';
  timeoutMs: number;
};

const KEY_RESOURCE_PATTERN =
  /^projects\/([A-Za-z0-9_-]+)\/locations\/([A-Za-z0-9_-]+)\/keyRings\/([A-Za-z0-9_-]+)\/cryptoKeys\/([A-Za-z0-9_-]+)$/;

function configured(name: string) {
  return process.env[name]?.trim() || null;
}

function protectionLevel(value: unknown): DocumentKeyMetadata['protectionLevel'] {
  if (value === 'HSM' || value === 2) return 'hsm';
  if (value === 'SOFTWARE' || value === 1) return 'software';
  if (value === 'EXTERNAL' || value === 3 || value === 'EXTERNAL_VPC' || value === 4) {
    return 'external';
  }
  return 'unknown';
}

function algorithmMatches(value: unknown) {
  return value === 'GOOGLE_SYMMETRIC_ENCRYPTION' || value === 1;
}

function isTransient(error: unknown) {
  const code =
    typeof error === 'object' && error && 'code' in error
      ? Number((error as { code?: unknown }).code)
      : Number.NaN;
  return [4, 8, 10, 13, 14].includes(code);
}

function kmsError(code: 'DOCUMENT_KEY_WRAP_FAILED' | 'DOCUMENT_KEY_UNWRAP_FAILED', error: unknown) {
  if (error instanceof DocumentEncryptionError) return error;
  return new DocumentEncryptionError(
    code,
    code === 'DOCUMENT_KEY_WRAP_FAILED'
      ? 'El KMS no pudo proteger la llave del documento.'
      : 'El KMS no pudo recuperar la llave del documento.',
    503,
    { cause: error }
  );
}

export class GoogleCloudDocumentKeyProvider implements DocumentKeyManagementProvider {
  readonly providerId = 'google-cloud-kms';
  private client: GoogleDocumentKmsClient | null;
  private clientPromise: Promise<GoogleDocumentKmsClient> | null = null;
  private readonly authProvider: GoogleCloudAuthProvider | null;
  private circuitOpenUntil = 0;
  private consecutiveFailures = 0;

  constructor(
    private readonly config: GoogleDocumentKmsConfiguration,
    client?: GoogleDocumentKmsClient,
    authProvider?: GoogleCloudAuthProvider,
    private readonly clientFactory: ClientFactory = (authClient) =>
      new KeyManagementServiceClient({ authClient })
  ) {
    if (!KEY_RESOURCE_PATTERN.test(config.keyResource)) {
      throw new DocumentEncryptionError(
        'DOCUMENT_ENCRYPTION_NOT_CONFIGURED',
        'DOCUMENT_ENCRYPTION_KMS_KEY_RESOURCE debe identificar una CryptoKey simetrica, sin version.',
        503
      );
    }
    this.client = client || null;
    this.authProvider = client
      ? null
      : authProvider ||
        createGoogleCloudAuthProvider({
          projectId: config.projectId,
          serviceAccountEmail: config.serviceAccountEmail,
        });
  }

  static missingConfiguration() {
    return [
      'DOCUMENT_ENCRYPTION_KMS_KEY_RESOURCE',
      'GCP_PROJECT_ID',
      'GCP_SERVICE_ACCOUNT_EMAIL',
    ].filter((name) => {
      if (name === 'GCP_PROJECT_ID') {
        return (
          !configured(name) &&
          !configured('GOOGLE_KMS_PRODUCTION_PROJECT_ID') &&
          !configured('GOOGLE_CLOUD_PROJECT_ID')
        );
      }
      if (name === 'GCP_SERVICE_ACCOUNT_EMAIL') {
        return (
          !configured(name) &&
          !configured('GOOGLE_KMS_PRODUCTION_SERVICE_ACCOUNT') &&
          !configured('GOOGLE_KMS_SERVICE_ACCOUNT')
        );
      }
      return !configured(name);
    });
  }

  static fromEnvironment() {
    const provider = (
      configured('DOCUMENT_ENCRYPTION_KMS_PROVIDER') ||
      configured('DOCUBOX_KMS_PROVIDER') ||
      ''
    ).toLowerCase();
    if (provider !== 'gcp' && provider !== 'google-cloud-kms') {
      throw new DocumentEncryptionError(
        'DOCUMENT_ENCRYPTION_PROVIDER_UNSUPPORTED',
        'El proveedor de cifrado documental configurado no esta soportado.',
        503
      );
    }
    const missing = this.missingConfiguration();
    if (missing.length) {
      throw new DocumentEncryptionError(
        'DOCUMENT_ENCRYPTION_NOT_CONFIGURED',
        `El cifrado documental requiere: ${missing.join(', ')}.`,
        503
      );
    }
    const production =
      String(process.env.VERCEL_ENV || '').toLowerCase() === 'production' ||
      String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    const expected = (
      configured('DOCUMENT_ENCRYPTION_KMS_PROTECTION_LEVEL') || (production ? 'hsm' : 'any')
    ).toLowerCase();
    if (!['hsm', 'software', 'any'].includes(expected)) {
      throw new DocumentEncryptionError(
        'DOCUMENT_ENCRYPTION_NOT_CONFIGURED',
        'DOCUMENT_ENCRYPTION_KMS_PROTECTION_LEVEL debe ser hsm, software o any.',
        503
      );
    }
    return new GoogleCloudDocumentKeyProvider({
      projectId:
        configured('GCP_PROJECT_ID') ||
        configured('GOOGLE_KMS_PRODUCTION_PROJECT_ID') ||
        configured('GOOGLE_CLOUD_PROJECT_ID')!,
      serviceAccountEmail:
        configured('GCP_SERVICE_ACCOUNT_EMAIL') ||
        configured('GOOGLE_KMS_PRODUCTION_SERVICE_ACCOUNT') ||
        configured('GOOGLE_KMS_SERVICE_ACCOUNT')!,
      keyResource: configured('DOCUMENT_ENCRYPTION_KMS_KEY_RESOURCE')!,
      requiredProtectionLevel: expected as 'hsm' | 'software' | 'any',
      timeoutMs: Math.max(1000, Number(configured('DOCUMENT_ENCRYPTION_KMS_TIMEOUT_MS') || 10_000)),
    });
  }

  private async getClient() {
    if (this.client) return this.client;
    if (!this.authProvider) {
      throw new DocumentEncryptionError(
        'DOCUMENT_ENCRYPTION_NOT_CONFIGURED',
        'No existe autenticacion disponible para el KMS documental.',
        503
      );
    }
    if (!this.clientPromise) {
      this.clientPromise = this.authProvider.getAuthClient().then(this.clientFactory);
    }
    this.client = await this.clientPromise;
    return this.client;
  }

  private async withRetry<T>(operation: () => Promise<T>) {
    if (Date.now() < this.circuitOpenUntil) {
      throw new DocumentEncryptionError(
        'DOCUMENT_KEY_UNWRAP_FAILED',
        'El KMS documental no esta disponible temporalmente.',
        503
      );
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await operation();
        this.consecutiveFailures = 0;
        return result;
      } catch (error) {
        lastError = error;
        this.consecutiveFailures += 1;
        if (!isTransient(error) || attempt === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
      }
    }
    if (this.consecutiveFailures >= 5) this.circuitOpenUntil = Date.now() + 30_000;
    throw lastError;
  }

  async getKeyMetadata(): Promise<DocumentKeyMetadata> {
    try {
      const client = await this.getClient();
      const [key] = await this.withRetry(() =>
        client.getCryptoKey({ name: this.config.keyResource }, { timeout: this.config.timeoutMs })
      );
      const primary = key.primary;
      const level = protectionLevel(primary?.protectionLevel);
      if (!primary?.name || !algorithmMatches(primary.algorithm)) {
        throw new DocumentEncryptionError(
          'DOCUMENT_ENCRYPTION_NOT_CONFIGURED',
          'La CryptoKey no tiene una version primaria GOOGLE_SYMMETRIC_ENCRYPTION activa.',
          503
        );
      }
      if (
        this.config.requiredProtectionLevel !== 'any' &&
        level !== this.config.requiredProtectionLevel
      ) {
        throw new DocumentEncryptionError(
          'DOCUMENT_ENCRYPTION_NOT_CONFIGURED',
          'La CryptoKey no cumple el nivel de proteccion requerido.',
          503
        );
      }
      return {
        provider: this.providerId,
        keyId: this.config.keyResource,
        keyVersion: primary.name,
        algorithm: 'GOOGLE_SYMMETRIC_ENCRYPTION',
        protectionLevel: level,
        status: primary.state === 'ENABLED' || primary.state === 1 ? 'active' : 'unavailable',
      };
    } catch (error) {
      throw kmsError('DOCUMENT_KEY_WRAP_FAILED', error);
    }
  }

  async wrapKey(input: { plaintextKey: Uint8Array; aad: Uint8Array }): Promise<WrappedDocumentKey> {
    try {
      const client = await this.getClient();
      const [response] = await this.withRetry(() =>
        client.encrypt(
          {
            name: this.config.keyResource,
            plaintext: Buffer.from(input.plaintextKey),
            additionalAuthenticatedData: Buffer.from(input.aad),
          },
          { timeout: this.config.timeoutMs }
        )
      );
      if (!response.ciphertext || !response.name) {
        throw new Error('KMS_ENCRYPT_RESPONSE_INVALID');
      }
      return {
        wrappedKey: Buffer.from(response.ciphertext),
        provider: this.providerId,
        keyId: this.config.keyResource,
        keyVersion: response.name,
      };
    } catch (error) {
      throw kmsError('DOCUMENT_KEY_WRAP_FAILED', error);
    }
  }

  async unwrapKey(input: {
    wrappedKey: Uint8Array;
    aad: Uint8Array;
    keyId: string;
    keyVersion: string;
  }) {
    if (input.keyId !== this.config.keyResource) {
      throw new DocumentEncryptionError(
        'DOCUMENT_KEY_UNWRAP_FAILED',
        'La metadata solicita una KEK distinta de la configurada.',
        409
      );
    }
    try {
      const client = await this.getClient();
      const [response] = await this.withRetry(() =>
        client.decrypt(
          {
            name: this.config.keyResource,
            ciphertext: Buffer.from(input.wrappedKey),
            additionalAuthenticatedData: Buffer.from(input.aad),
          },
          { timeout: this.config.timeoutMs }
        )
      );
      if (!response.plaintext) throw new Error('KMS_DECRYPT_RESPONSE_INVALID');
      return Buffer.from(response.plaintext);
    } catch (error) {
      throw kmsError('DOCUMENT_KEY_UNWRAP_FAILED', error);
    }
  }

  async healthCheck() {
    try {
      const metadata = await this.getKeyMetadata();
      return {
        ready: metadata.status === 'active',
        missing: metadata.status === 'active' ? [] : ['DOCUMENT_ENCRYPTION_KMS_KEY_NOT_ACTIVE'],
        metadata,
      };
    } catch (error) {
      return {
        ready: false,
        missing: [
          error instanceof DocumentEncryptionError
            ? error.code
            : 'DOCUMENT_ENCRYPTION_KMS_UNAVAILABLE',
        ],
      };
    }
  }
}
