import { KeyManagementServiceClient } from '@google-cloud/kms';
import type { AuthClient } from 'google-auth-library';
import { constants, createPublicKey, randomUUID, verify } from 'node:crypto';
import { sha256Hex } from './canonical';
import {
  createGoogleCloudAuthProvider,
  type GoogleCloudAuthProvider,
} from './google-cloud-auth';
import { CertificationError, type KmsPurpose, type VerifiedKmsSignature } from './types';

type FetchRequestInit = NonNullable<Parameters<typeof fetch>[1]>;

export type ProviderHealth = {
  ready: boolean;
  missing: string[];
  provider?: string;
  keyId?: string;
  keyVersion?: string;
  detail?: string;
};

export type SignDigestInput = {
  purpose: KmsPurpose;
  digestSha256: string;
  canonicalBytes: Uint8Array;
  idempotencyKey?: string;
  tenantId?: string;
};

export type KeyMetadata = {
  provider: 'openbao' | 'legacy-local-pem' | 'gateway' | 'production-kms' | 'google-cloud-kms';
  keyId: string;
  keyVersion: string;
  algorithm: 'RSA-PSS-SHA256' | 'RSA-PKCS1-SHA256';
  keySizeBits: number;
  protectionLevel: 'software' | 'hsm' | 'kms' | 'unknown';
  createdAt: string | null;
  status: 'active' | 'deprecated' | 'unavailable';
  publicKeyPem: string | null;
};

export interface KeyManagementProvider {
  signDigest(input: SignDigestInput): Promise<VerifiedKmsSignature>;
  getPublicKey(keyId: string): Promise<string>;
  getKeyMetadata(keyId: string): Promise<KeyMetadata>;
  healthCheck(): Promise<ProviderHealth>;
}

type OpenBaoFetch = (input: string | URL | Request, init?: FetchRequestInit) => Promise<Response>;

type OpenBaoConfiguration = {
  address: string;
  transitMount: string;
  documentKeyId: string;
  evidenceKeyId: string;
  roleId: string;
  secretId: string;
  namespace?: string;
};

type OpenBaoKeyData = {
  type?: string;
  latest_version?: number;
  keys?: Record<string, { public_key?: string; creation_time?: string }>;
};

type CachedToken = { value: string; expiresAt: number };

const MIN_RSA_BITS = 2048;
const OPENBAO_TIMEOUT_MS = 10_000;
const PRODUCTION_KMS_TIMEOUT_MS = 10_000;
const GOOGLE_KMS_ALGORITHM = 'RSA_SIGN_PKCS1_3072_SHA256' as const;
const GOOGLE_KMS_RSA_BITS = 3072;

function configuredValue(name: string) {
  const value = process.env[name]?.trim();
  return value || null;
}

function normalizeAddress(value: string) {
  const url = new URL(value);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !local) {
    throw new CertificationError('OPENBAO_TLS_REQUIRED', 'OpenBao remoto debe usar HTTPS.', 503);
  }
  return url.toString().replace(/\/$/, '');
}

function safeSegment(value: string, name: string) {
  if (!/^[A-Za-z0-9_/-]+$/.test(value) || value.includes('..')) {
    throw new CertificationError('OPENBAO_CONFIGURATION_INVALID', `${name} contiene una ruta no valida.`, 503);
  }
  return value.replace(/^\/+|\/+$/g, '');
}

function expectedRsaBits(keyType: string) {
  const match = /^rsa-(\d+)$/i.exec(keyType);
  return match ? Number(match[1]) : 0;
}

function responseError(code: string, response: Response, payload: unknown) {
  const message = response.status === 401 || response.status === 403
    ? 'OpenBao rechazo la autenticacion del servicio.'
    : `OpenBao respondio HTTP ${response.status}.`;
  const error = new CertificationError(code, message, response.status === 401 || response.status === 403 ? 503 : 502);
  // Do not surface OpenBao response bodies: they can contain policy and operational details.
  void payload;
  return error;
}

/**
 * Development provider backed by OpenBao Transit. It authenticates with AppRole,
 * signs only server-side and never requests key export material.
 */
export class OpenBaoTransitProvider implements KeyManagementProvider {
  readonly providerId = 'openbao' as const;
  private token: CachedToken | null = null;
  private readonly config: OpenBaoConfiguration;
  private readonly requestFetch: OpenBaoFetch;

  constructor(config: OpenBaoConfiguration, requestFetch: OpenBaoFetch = fetch) {
    this.config = config;
    this.requestFetch = requestFetch;
  }

  static fromEnvironment() {
    const required = [
      'OPENBAO_ADDR',
      'OPENBAO_TRANSIT_MOUNT',
      'OPENBAO_TRANSIT_DOCUMENT_KEY',
      'OPENBAO_TRANSIT_EVIDENCE_KEY',
      'OPENBAO_ROLE_ID',
      'OPENBAO_SECRET_ID',
    ] as const;
    const missing = required.filter((name) => !configuredValue(name));
    if (missing.length) {
      throw new CertificationError('OPENBAO_NOT_CONFIGURED', 'OpenBao Transit no esta configurado para este entorno.', 503);
    }
    return new OpenBaoTransitProvider({
      address: normalizeAddress(configuredValue('OPENBAO_ADDR')!),
      transitMount: safeSegment(configuredValue('OPENBAO_TRANSIT_MOUNT')!, 'OPENBAO_TRANSIT_MOUNT'),
      documentKeyId: safeSegment(configuredValue('OPENBAO_TRANSIT_DOCUMENT_KEY')!, 'OPENBAO_TRANSIT_DOCUMENT_KEY'),
      evidenceKeyId: safeSegment(configuredValue('OPENBAO_TRANSIT_EVIDENCE_KEY')!, 'OPENBAO_TRANSIT_EVIDENCE_KEY'),
      roleId: configuredValue('OPENBAO_ROLE_ID')!,
      secretId: configuredValue('OPENBAO_SECRET_ID')!,
      namespace: configuredValue('OPENBAO_NAMESPACE') || undefined,
    });
  }

  static missingConfiguration() {
    const required = [
      'OPENBAO_ADDR',
      'OPENBAO_TRANSIT_MOUNT',
      'OPENBAO_TRANSIT_DOCUMENT_KEY',
      'OPENBAO_TRANSIT_EVIDENCE_KEY',
      'OPENBAO_ROLE_ID',
      'OPENBAO_SECRET_ID',
    ] as const;
    return required.filter((name) => !configuredValue(name));
  }

  private keyFor(purpose: KmsPurpose) {
    return purpose === 'EVIDENCE_SEAL' ? this.config.evidenceKeyId : this.config.documentKeyId;
  }

  private async authenticate() {
    if (this.token && this.token.expiresAt > Date.now() + 10_000) return this.token.value;
    const response = await this.requestFetch(`${this.config.address}/v1/auth/approle/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.config.namespace ? { 'X-Vault-Namespace': this.config.namespace } : {}) },
      body: JSON.stringify({ role_id: this.config.roleId, secret_id: this.config.secretId }),
      signal: AbortSignal.timeout(OPENBAO_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => null) as { auth?: { client_token?: string; lease_duration?: number } } | null;
    if (!response.ok || !payload?.auth?.client_token) throw responseError('OPENBAO_AUTH_FAILED', response, payload);
    this.token = {
      value: payload.auth.client_token,
      expiresAt: Date.now() + Math.max(30, Number(payload.auth.lease_duration || 60) - 15) * 1000,
    };
    return this.token.value;
  }

  private async request(path: string, init: FetchRequestInit = {}, retried = false): Promise<Record<string, unknown>> {
    const token = await this.authenticate();
    const response = await this.requestFetch(`${this.config.address}/v1/${path.replace(/^\//, '')}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Vault-Token': token,
        ...(this.config.namespace ? { 'X-Vault-Namespace': this.config.namespace } : {}),
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(OPENBAO_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if ((response.status === 401 || response.status === 403) && !retried) {
      this.token = null;
      return this.request(path, init, true);
    }
    if (!response.ok || !payload) throw responseError('OPENBAO_REQUEST_FAILED', response, payload);
    return payload;
  }

  private async keyData(keyId: string): Promise<OpenBaoKeyData> {
    const payload = await this.request(`${this.config.transitMount}/keys/${encodeURIComponent(safeSegment(keyId, 'keyId'))}`, { method: 'GET' });
    const data = payload.data as OpenBaoKeyData | undefined;
    const keySizeBits = expectedRsaBits(String(data?.type || ''));
    if (!data || keySizeBits < MIN_RSA_BITS) {
      throw new CertificationError('OPENBAO_KEY_POLICY_INVALID', 'La llave OpenBao no cumple RSA de al menos 2048 bits.', 503);
    }
    return data;
  }

  async getKeyMetadata(keyId: string): Promise<KeyMetadata> {
    const data = await this.keyData(keyId);
    const keyVersion = String(data.latest_version || '');
    const entry = data.keys?.[keyVersion];
    if (!keyVersion || !entry?.public_key) {
      throw new CertificationError('OPENBAO_KEY_METADATA_INVALID', 'OpenBao no entrego material publico para la llave configurada.', 502);
    }
    return {
      provider: 'openbao',
      keyId,
      keyVersion,
      algorithm: 'RSA-PSS-SHA256',
      keySizeBits: expectedRsaBits(String(data.type)),
      protectionLevel: 'software',
      createdAt: entry.creation_time || null,
      status: 'active',
      publicKeyPem: entry.public_key,
    };
  }

  async getPublicKey(keyId: string) {
    const metadata = await this.getKeyMetadata(keyId);
    if (!metadata.publicKeyPem) throw new CertificationError('OPENBAO_PUBLIC_KEY_MISSING', 'OpenBao no devolvio la llave publica.', 502);
    return metadata.publicKeyPem;
  }

  async signDigest(input: SignDigestInput): Promise<VerifiedKmsSignature> {
    if (!/^[a-f0-9]{64}$/i.test(input.digestSha256) || sha256Hex(input.canonicalBytes) !== input.digestSha256.toLowerCase()) {
      throw new CertificationError('DIGEST_MISMATCH', 'El digest declarado no corresponde al contenido canonico.', 422);
    }
    const keyId = this.keyFor(input.purpose);
    const metadata = await this.getKeyMetadata(keyId);
    const payload = await this.request(`${this.config.transitMount}/sign/${encodeURIComponent(keyId)}`, {
      method: 'POST',
      body: JSON.stringify({
        input: Buffer.from(input.canonicalBytes).toString('base64'),
        hash_algorithm: 'sha2-256',
        signature_algorithm: 'pss',
        prehashed: false,
      }),
    });
    const signature = String((payload.data as Record<string, unknown> | undefined)?.signature || '');
    const match = /^(?:vault|bao):v(\d+):(.+)$/.exec(signature);
    if (!match) throw new CertificationError('OPENBAO_SIGNATURE_INVALID', 'OpenBao devolvio una firma con formato invalido.', 502);
    const signatureBytes = Buffer.from(match[2], 'base64');
    const publicKey = createPublicKey(metadata.publicKeyPem!);
    const locallyValid = verify('sha256', Buffer.from(input.canonicalBytes), {
      key: publicKey,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    }, signatureBytes);
    if (!locallyValid) throw new CertificationError('OPENBAO_SIGNATURE_VERIFICATION_FAILED', 'La firma OpenBao no supero la verificacion local.', 502);

    const verification = await this.request(`${this.config.transitMount}/verify/${encodeURIComponent(keyId)}`, {
      method: 'POST',
      body: JSON.stringify({
        input: Buffer.from(input.canonicalBytes).toString('base64'),
        signature,
        hash_algorithm: 'sha2-256',
        signature_algorithm: 'pss',
        prehashed: false,
      }),
    });
    if ((verification.data as Record<string, unknown> | undefined)?.valid !== true) {
      throw new CertificationError('OPENBAO_REMOTE_VERIFICATION_FAILED', 'OpenBao no valido la firma emitida.', 502);
    }
    return {
      status: 'VALID',
      signatureBase64: signatureBytes.toString('base64'),
      signatureSha256: sha256Hex(signatureBytes),
      algorithm: 'RSA-PSS-SHA256',
      keySizeBits: metadata.keySizeBits,
      keyId,
      keyVersion: match[1] || metadata.keyVersion,
      publicKeyPem: metadata.publicKeyPem!,
      publicKeyFingerprintSha256: sha256Hex(publicKey.export({ type: 'spki', format: 'der' })),
      certificatePem: null,
      certificateFingerprintSha256: null,
      signedAt: new Date().toISOString(),
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      const metadata = await this.getKeyMetadata(this.config.documentKeyId);
      // This uses a fixed non-document probe to validate the sign/verify policy.
      await this.signDigest({
        purpose: 'DOCUMENT_SEAL',
        canonicalBytes: Buffer.from('DOCUBOX_OPENBAO_HEALTHCHECK_V1'),
        digestSha256: sha256Hex('DOCUBOX_OPENBAO_HEALTHCHECK_V1'),
        idempotencyKey: `health-${randomUUID()}`,
      });
      return { ready: true, missing: [], provider: this.providerId, keyId: metadata.keyId, keyVersion: metadata.keyVersion, detail: `latency_ms=${Date.now() - started}` };
    } catch (error) {
      const detail = error instanceof CertificationError ? error.code : 'OPENBAO_HEALTH_FAILED';
      return { ready: false, missing: [detail], provider: this.providerId };
    }
  }
}

export type GoogleCloudKmsConfiguration = {
  environment: 'development' | 'production';
  projectId: string;
  location: string;
  keyRing: string;
  keyName: string;
  keyVersion: string;
  algorithm: typeof GOOGLE_KMS_ALGORITHM;
  serviceAccount: string;
  requiredProtectionLevel: 'software' | 'hsm';
};

type GoogleCloudKmsClient = Pick<
  KeyManagementServiceClient,
  'getPublicKey' | 'asymmetricSign'
>;

type GoogleCloudKmsClientFactory = (authClient: AuthClient) => GoogleCloudKmsClient;

function googleKmsAlgorithmMatches(value: unknown) {
  // The generated client can expose protobuf enums as either their name or number.
  return value === GOOGLE_KMS_ALGORITHM || value === 6;
}

function googleKmsProtectionLevel(value: unknown): KeyMetadata['protectionLevel'] {
  if (value === 'HSM' || value === 2) return 'hsm';
  if (value === 'SOFTWARE' || value === 1) return 'software';
  return 'kms';
}

function googleKmsFailure(error: unknown): CertificationError {
  if (error instanceof CertificationError) return error;
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (
    message.includes('unauthorized_client') ||
    message.includes('rejected by the attribute condition') ||
    message.includes('permission denied on resource')
  ) {
    return new CertificationError(
      'GOOGLE_WIF_ACCESS_DENIED',
      'Google Workload Identity Federation rechazo la identidad del runtime.',
      403
    );
  }
  const status = typeof error === 'object' && error && 'code' in error
    ? Number((error as { code?: unknown }).code)
    : Number.NaN;
  if (status === 16) return new CertificationError('GOOGLE_KMS_AUTHENTICATION_FAILED', 'Google Cloud KMS no pudo autenticar la identidad configurada.', 503);
  if (status === 7) return new CertificationError('GOOGLE_KMS_PERMISSION_DENIED', 'La identidad autenticada no tiene permiso para usar la llave configurada.', 503);
  if (status === 5) return new CertificationError('GOOGLE_KMS_KEY_NOT_FOUND', 'La llave o version configurada no existe en Google Cloud KMS.', 503);
  if (status === 9) return new CertificationError('GOOGLE_KMS_KEY_NOT_READY', 'La version de la llave de Google Cloud KMS no esta habilitada.', 503);
  if (status === 3) return new CertificationError('GOOGLE_KMS_REQUEST_INVALID', 'Google Cloud KMS rechazo el algoritmo o digest configurado.', 502);
  return new CertificationError('GOOGLE_KMS_UNAVAILABLE', 'No fue posible completar la operacion con Google Cloud KMS.', 503);
}

function googleKmsSegment(value: string, variableName: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new CertificationError('GOOGLE_KMS_CONFIGURATION_INVALID', `${variableName} contiene un identificador invalido.`, 503);
  }
  return value;
}

/**
 * Server-side Google Cloud KMS provider. Hosting authentication is resolved by
 * GoogleCloudAuthProvider and only an AuthClient reaches the Google SDK.
 */
export class GoogleCloudKmsProvider implements KeyManagementProvider {
  readonly providerId = 'google-cloud-kms' as const;
  readonly resourceName: string;
  private client: GoogleCloudKmsClient | null;
  private clientPromise: Promise<GoogleCloudKmsClient> | null = null;
  private readonly authProvider: GoogleCloudAuthProvider | null;

  constructor(
    private readonly config: GoogleCloudKmsConfiguration,
    client?: GoogleCloudKmsClient,
    authProvider?: GoogleCloudAuthProvider,
    private readonly clientFactory: GoogleCloudKmsClientFactory = (authClient) =>
      new KeyManagementServiceClient({ authClient })
  ) {
    if (config.algorithm !== GOOGLE_KMS_ALGORITHM) {
      throw new CertificationError('GOOGLE_KMS_ALGORITHM_INVALID', 'Google Cloud KMS debe usar RSA_SIGN_PKCS1_3072_SHA256.', 503);
    }
    if (config.environment === 'production' && config.requiredProtectionLevel !== 'hsm') {
      throw new CertificationError('PRODUCTION_HSM_REQUIRED', 'La firma productiva requiere una llave con nivel de proteccion HSM.', 503);
    }
    this.resourceName = [
      'projects', googleKmsSegment(config.projectId, 'GOOGLE_CLOUD_PROJECT_ID'),
      'locations', googleKmsSegment(config.location, 'GOOGLE_KMS_LOCATION'),
      'keyRings', googleKmsSegment(config.keyRing, 'GOOGLE_KMS_KEY_RING'),
      'cryptoKeys', googleKmsSegment(config.keyName, 'GOOGLE_KMS_KEY_NAME'),
      'cryptoKeyVersions', googleKmsSegment(config.keyVersion, 'GOOGLE_KMS_KEY_VERSION'),
    ].join('/');
    this.client = client || null;
    this.authProvider = client
      ? null
      : authProvider ||
        createGoogleCloudAuthProvider({
          projectId: config.projectId,
          serviceAccountEmail: config.serviceAccount,
        });
  }

  private async getClient() {
    if (this.client) return this.client;
    if (!this.authProvider) {
      throw new CertificationError(
        'GOOGLE_KMS_AUTH_PROVIDER_UNAVAILABLE',
        'Google Cloud KMS no tiene un proveedor de autenticacion disponible.',
        503
      );
    }
    if (!this.clientPromise) {
      this.clientPromise = this.authProvider
        .getAuthClient()
        .then((authClient) => this.clientFactory(authClient))
        .then((client) => {
          this.client = client;
          return client;
        })
        .catch((error) => {
          this.clientPromise = null;
          throw error;
        });
    }
    return await this.clientPromise;
  }

  static missingConfiguration(environment: 'development' | 'production' = 'development') {
    const required = environment === 'production'
      ? [
          'GOOGLE_KMS_PRODUCTION_PROJECT_ID',
          'GOOGLE_KMS_PRODUCTION_LOCATION',
          'GOOGLE_KMS_PRODUCTION_KEY_RING',
          'GOOGLE_KMS_PRODUCTION_KEY_NAME',
          'GOOGLE_KMS_PRODUCTION_KEY_VERSION',
          'GOOGLE_KMS_PRODUCTION_ALGORITHM',
          'GOOGLE_KMS_PRODUCTION_SERVICE_ACCOUNT',
          'GOOGLE_KMS_PRODUCTION_PROTECTION_LEVEL',
        ] as const
      : [
          'DOCUBOX_KMS_PROVIDER',
          'GOOGLE_CLOUD_PROJECT_ID',
          'GOOGLE_KMS_LOCATION',
          'GOOGLE_KMS_KEY_RING',
          'GOOGLE_KMS_KEY_NAME',
          'GOOGLE_KMS_KEY_VERSION',
          'GOOGLE_KMS_ALGORITHM',
          'GOOGLE_KMS_SERVICE_ACCOUNT',
        ] as const;
    return required.filter((name) => !configuredValue(name));
  }

  static fromEnvironment(environment: 'development' | 'production' = 'development') {
    const missing = GoogleCloudKmsProvider.missingConfiguration(environment);
    if (missing.length) {
      throw new CertificationError('GOOGLE_KMS_NOT_CONFIGURED', `Google Cloud KMS requiere: ${missing.join(', ')}.`, 503);
    }
    if (environment === 'development' && configuredValue('DOCUBOX_KMS_PROVIDER') !== 'gcp') {
      throw new CertificationError('GOOGLE_KMS_PROVIDER_INVALID', 'DOCUBOX_KMS_PROVIDER debe ser gcp.', 503);
    }
    const prefix = environment === 'production' ? 'GOOGLE_KMS_PRODUCTION_' : 'GOOGLE_KMS_';
    const projectVariable = environment === 'production' ? 'GOOGLE_KMS_PRODUCTION_PROJECT_ID' : 'GOOGLE_CLOUD_PROJECT_ID';
    const configuredProtectionLevel = environment === 'production'
      ? configuredValue('GOOGLE_KMS_PRODUCTION_PROTECTION_LEVEL')?.toLowerCase()
      : 'software';
    if (environment === 'production' && configuredProtectionLevel !== 'hsm') {
      throw new CertificationError('PRODUCTION_HSM_REQUIRED', 'GOOGLE_KMS_PRODUCTION_PROTECTION_LEVEL debe ser HSM.', 503);
    }
    return new GoogleCloudKmsProvider({
      environment,
      projectId: configuredValue(projectVariable)!,
      location: configuredValue(`${prefix}LOCATION`)!,
      keyRing: configuredValue(`${prefix}KEY_RING`)!,
      keyName: configuredValue(`${prefix}KEY_NAME`)!,
      keyVersion: configuredValue(`${prefix}KEY_VERSION`)!,
      algorithm: configuredValue(`${prefix}ALGORITHM`) as typeof GOOGLE_KMS_ALGORITHM,
      serviceAccount: configuredValue(`${prefix}SERVICE_ACCOUNT`)!,
      requiredProtectionLevel: configuredProtectionLevel as 'software' | 'hsm',
    });
  }

  private assertKeyId(keyId: string) {
    if (keyId !== this.config.keyName && keyId !== this.resourceName) {
      throw new CertificationError('GOOGLE_KMS_KEY_ID_MISMATCH', 'La operacion solicito una llave distinta de la configurada.', 422);
    }
  }

  private async loadPublicKey() {
    try {
      const client = await this.getClient();
      const [response] = await client.getPublicKey({ name: this.resourceName });
      if (response.name !== this.resourceName || !response.pem || !googleKmsAlgorithmMatches(response.algorithm)) {
        throw new CertificationError('GOOGLE_KMS_PUBLIC_KEY_INVALID', 'Google Cloud KMS no devolvio la llave publica RSA configurada.', 502);
      }
      const publicKey = createPublicKey(response.pem);
      const keySizeBits = publicKey.asymmetricKeyDetails?.modulusLength || 0;
      if (publicKey.asymmetricKeyType !== 'rsa' || keySizeBits !== GOOGLE_KMS_RSA_BITS) {
        throw new CertificationError('GOOGLE_KMS_KEY_POLICY_INVALID', 'La llave debe ser RSA de 3072 bits.', 503);
      }
      const protectionLevel = googleKmsProtectionLevel(response.protectionLevel);
      if (this.config.requiredProtectionLevel === 'hsm' && protectionLevel !== 'hsm') {
        throw new CertificationError('PRODUCTION_HSM_REQUIRED', 'Google Cloud KMS no reporto Protection Level HSM para la llave productiva.', 503);
      }
      return { pem: response.pem, publicKey, keySizeBits, protectionLevel: response.protectionLevel };
    } catch (error) {
      throw googleKmsFailure(error);
    }
  }

  async getPublicKey(keyId: string) {
    this.assertKeyId(keyId);
    return (await this.loadPublicKey()).pem;
  }

  async getKeyMetadata(keyId: string): Promise<KeyMetadata> {
    this.assertKeyId(keyId);
    // The exact version is part of the getPublicKey resource name. Requiring
    // cryptoKeyVersions.get would unnecessarily broaden the signer IAM role.
    const publicKey = await this.loadPublicKey();
    return {
      provider: 'google-cloud-kms',
      keyId: this.config.keyName,
      keyVersion: this.config.keyVersion,
      algorithm: 'RSA-PKCS1-SHA256',
      keySizeBits: publicKey.keySizeBits,
      protectionLevel: googleKmsProtectionLevel(publicKey.protectionLevel),
      createdAt: null,
      status: 'active',
      publicKeyPem: publicKey.pem,
    };
  }

  async signDigest(input: SignDigestInput): Promise<VerifiedKmsSignature> {
    if (!/^[a-f0-9]{64}$/i.test(input.digestSha256) || sha256Hex(input.canonicalBytes) !== input.digestSha256.toLowerCase()) {
      throw new CertificationError('DIGEST_MISMATCH', 'El digest declarado no corresponde al contenido canonico.', 422);
    }
    const metadata = await this.getKeyMetadata(this.config.keyName);
    try {
      const client = await this.getClient();
      const [response] = await client.asymmetricSign({
        name: this.resourceName,
        digest: { sha256: Buffer.from(input.digestSha256, 'hex') },
      });
      if (!response.signature || (response.name && response.name !== this.resourceName)) {
        throw new CertificationError('GOOGLE_KMS_SIGNATURE_INVALID', 'Google Cloud KMS no devolvio una firma valida.', 502);
      }
      const signatureBytes = typeof response.signature === 'string'
        ? Buffer.from(response.signature, 'base64')
        : Buffer.from(response.signature);
      const publicKey = createPublicKey(metadata.publicKeyPem!);
      const locallyValid = verify('sha256', Buffer.from(input.canonicalBytes), {
        key: publicKey,
        padding: constants.RSA_PKCS1_PADDING,
      }, signatureBytes);
      if (!locallyValid) {
        throw new CertificationError('GOOGLE_KMS_SIGNATURE_VERIFICATION_FAILED', 'La firma de Google Cloud KMS no supero la verificacion RSA local.', 502);
      }
      return {
        status: 'VALID',
        signatureBase64: signatureBytes.toString('base64'),
        signatureSha256: sha256Hex(signatureBytes),
        algorithm: 'RSA-PKCS1-SHA256',
        keySizeBits: metadata.keySizeBits,
        keyId: metadata.keyId,
        keyVersion: metadata.keyVersion,
        publicKeyPem: metadata.publicKeyPem!,
        publicKeyFingerprintSha256: sha256Hex(publicKey.export({ type: 'spki', format: 'der' })),
        certificatePem: null,
        certificateFingerprintSha256: null,
        signedAt: new Date().toISOString(),
      };
    } catch (error) {
      throw googleKmsFailure(error);
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const metadata = await this.getKeyMetadata(this.config.keyName);
      const probe = Buffer.from('DOCUBOX_GOOGLE_KMS_HEALTHCHECK_V1');
      await this.signDigest({
        purpose: 'DOCUMENT_SEAL',
        canonicalBytes: probe,
        digestSha256: sha256Hex(probe),
        idempotencyKey: `health-${randomUUID()}`,
      });
      return {
        ready: true,
        missing: [],
        provider: this.providerId,
        keyId: metadata.keyId,
        keyVersion: metadata.keyVersion,
        detail: `environment=${this.config.environment};algorithm=${this.config.algorithm};protection=${metadata.protectionLevel}`,
      };
    } catch (error) {
      const failure = googleKmsFailure(error);
      return { ready: false, missing: [failure.code], provider: this.providerId };
    }
  }
}

/**
 * Compatibility boundary for the historical VPS signer. It intentionally does
 * not expose a PEM or claim digest-signing support; the existing Edge Function
 * remains the only deprecated consumer until its migration is complete.
 */
export class LegacyLocalPemSigningProvider implements KeyManagementProvider {
  readonly providerId = 'legacy-local-pem' as const;
  private readonly signingUrl: string | null;

  constructor(signingUrl = configuredValue('VPS_SIGNING_URL')) {
    this.signingUrl = signingUrl;
  }

  async signDigest(): Promise<VerifiedKmsSignature> {
    throw new CertificationError('LEGACY_PEM_DIGEST_SIGNING_UNSUPPORTED', 'El proveedor legado no puede utilizarse para nuevos sellos de certificacion.', 503);
  }

  async getPublicKey(): Promise<string> {
    throw new CertificationError('LEGACY_PEM_PUBLIC_KEY_UNAVAILABLE', 'El proveedor legado no expone material publico para certificacion.', 503);
  }

  async getKeyMetadata(keyId: string): Promise<KeyMetadata> {
    return {
      provider: 'legacy-local-pem', keyId, keyVersion: 'legacy', algorithm: 'RSA-PSS-SHA256',
      keySizeBits: 0, protectionLevel: 'unknown', createdAt: null, status: 'deprecated', publicKeyPem: null,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      ready: false,
      missing: [this.signingUrl ? 'LEGACY_PEM_DIGEST_SIGNING_UNSUPPORTED' : 'VPS_SIGNING_URL'],
      provider: this.providerId,
      detail: 'deprecated',
    };
  }
}

type ProductionKmsConfiguration = {
  baseUrl: string | null;
  serviceToken: string | null;
  documentKeyId: string | null;
  evidenceKeyId: string | null;
  timeoutMs: number;
};

type ProductionKmsMetadataResponse = {
  key_id?: string;
  key_version?: string | number;
  algorithm?: string;
  key_size_bits?: number;
  protection_level?: string;
  created_at?: string | null;
  status?: string;
  public_key_pem?: string;
};

/**
 * Production boundary for an HSM/KMS gateway. The gateway owns credentials and
 * private key operations; this application only sends the bytes that must be
 * signed and validates the returned signature against the gateway public key.
 */
export class ProductionKeyManagementProvider implements KeyManagementProvider {
  readonly providerId = 'production-kms' as const;

  constructor(
    private readonly config: ProductionKmsConfiguration,
    private readonly requestFetch: typeof fetch = fetch,
  ) {}

  static fromEnvironment() {
    const timeout = Number(process.env.DOCUBOX_PRODUCTION_KMS_TIMEOUT_MS || PRODUCTION_KMS_TIMEOUT_MS);
    return new ProductionKeyManagementProvider({
      baseUrl: configuredValue('DOCUBOX_PRODUCTION_KMS_URL'),
      serviceToken: configuredValue('DOCUBOX_PRODUCTION_KMS_SERVICE_TOKEN'),
      documentKeyId: configuredValue('DOCUBOX_PRODUCTION_KMS_DOCUMENT_KEY'),
      evidenceKeyId: configuredValue('DOCUBOX_PRODUCTION_KMS_EVIDENCE_KEY'),
      timeoutMs: Number.isFinite(timeout) && timeout >= 500 ? timeout : PRODUCTION_KMS_TIMEOUT_MS,
    });
  }

  static missingConfiguration() {
    const required = [
      'DOCUBOX_PRODUCTION_KMS_URL',
      'DOCUBOX_PRODUCTION_KMS_SERVICE_TOKEN',
      'DOCUBOX_PRODUCTION_KMS_DOCUMENT_KEY',
      'DOCUBOX_PRODUCTION_KMS_EVIDENCE_KEY',
    ] as const;
    return required.filter((name) => !configuredValue(name));
  }

  private keyFor(purpose: KmsPurpose) {
    return purpose === 'EVIDENCE_SEAL' ? this.config.evidenceKeyId : this.config.documentKeyId;
  }

  private endpoint(path: string) {
    if (!this.config.baseUrl || !this.config.serviceToken) {
      throw new CertificationError('PRODUCTION_KMS_NOT_CONFIGURED', 'El proveedor KMS de produccion no esta configurado.', 503);
    }
    const url = new URL(this.config.baseUrl);
    if (url.protocol !== 'https:') {
      throw new CertificationError('PRODUCTION_KMS_TLS_REQUIRED', 'El KMS de produccion debe usar HTTPS.', 503);
    }
    return `${url.toString().replace(/\/$/, '')}${path}`;
  }

  private async request(path: string, init: FetchRequestInit = {}) {
    const response = await this.requestFetch(this.endpoint(path), {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.serviceToken}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !payload) {
      const code = response.status === 401 || response.status === 403
        ? 'PRODUCTION_KMS_AUTH_FAILED'
        : 'PRODUCTION_KMS_UNAVAILABLE';
      throw new CertificationError(code, 'No fue posible comunicarse con el KMS de produccion.', 503);
    }
    return payload;
  }

  private toMetadata(payload: Record<string, unknown>, expectedKeyId: string): KeyMetadata {
    const data = (payload.key || payload.data || payload) as ProductionKmsMetadataResponse;
    const keyId = String(data.key_id || expectedKeyId);
    const keyVersion = String(data.key_version || '');
    const publicKeyPem = String(data.public_key_pem || '');
    const keySizeBits = Number(data.key_size_bits || 0);
    if (keyId !== expectedKeyId || !keyVersion || !publicKeyPem || keySizeBits < MIN_RSA_BITS || data.algorithm !== 'RSA-PSS-SHA256') {
      throw new CertificationError('PRODUCTION_KMS_METADATA_INVALID', 'El KMS de produccion no entrego metadatos de llave validos.', 502);
    }
    return {
      provider: 'production-kms', keyId, keyVersion, algorithm: 'RSA-PSS-SHA256', keySizeBits,
      protectionLevel: data.protection_level === 'hsm' ? 'hsm' : 'kms',
      createdAt: data.created_at || null,
      status: data.status === 'active' ? 'active' : 'unavailable',
      publicKeyPem,
    };
  }

  async getKeyMetadata(keyId: string) {
    const payload = await this.request(`/v1/docubox/keys/${encodeURIComponent(keyId)}`, { method: 'GET' });
    return this.toMetadata(payload, keyId);
  }

  async getPublicKey(keyId: string) {
    const metadata = await this.getKeyMetadata(keyId);
    return metadata.publicKeyPem!;
  }

  async signDigest(input: SignDigestInput): Promise<VerifiedKmsSignature> {
    if (!/^[a-f0-9]{64}$/i.test(input.digestSha256) || sha256Hex(input.canonicalBytes) !== input.digestSha256.toLowerCase()) {
      throw new CertificationError('DIGEST_MISMATCH', 'El digest declarado no corresponde al contenido canonico.', 422);
    }
    const keyId = this.keyFor(input.purpose);
    if (!keyId) throw new CertificationError('PRODUCTION_KMS_NOT_CONFIGURED', 'La llave KMS requerida no esta configurada.', 503);
    const metadata = await this.getKeyMetadata(keyId);
    const payload = await this.request('/v1/docubox/sign-digest', {
      method: 'POST',
      body: JSON.stringify({
        key_id: keyId,
        algorithm: 'RSA-PSS-SHA256',
        digest_algorithm: 'SHA-256',
        digest_sha256: input.digestSha256.toLowerCase(),
        data_base64: Buffer.from(input.canonicalBytes).toString('base64'),
        purpose: input.purpose,
        idempotency_key: input.idempotencyKey || null,
      }),
    });
    const data = (payload.signature || payload.data || payload) as Record<string, unknown>;
    const signatureBase64 = String(data.signature_base64 || '');
    const keyVersion = String(data.key_version || metadata.keyVersion);
    if (!signatureBase64 || keyVersion !== metadata.keyVersion) {
      throw new CertificationError('PRODUCTION_KMS_SIGNATURE_INVALID', 'El KMS de produccion devolvio una firma invalida.', 502);
    }
    const signatureBytes = Buffer.from(signatureBase64, 'base64');
    const publicKey = createPublicKey(metadata.publicKeyPem!);
    const locallyValid = verify('sha256', Buffer.from(input.canonicalBytes), {
      key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32,
    }, signatureBytes);
    if (!locallyValid) throw new CertificationError('PRODUCTION_KMS_SIGNATURE_VERIFICATION_FAILED', 'La firma del KMS de produccion no supero la verificacion local.', 502);
    return {
      status: 'VALID', signatureBase64, signatureSha256: sha256Hex(signatureBytes), algorithm: 'RSA-PSS-SHA256',
      keySizeBits: metadata.keySizeBits, keyId, keyVersion, publicKeyPem: metadata.publicKeyPem!,
      publicKeyFingerprintSha256: sha256Hex(publicKey.export({ type: 'spki', format: 'der' })),
      certificatePem: null, certificateFingerprintSha256: null, signedAt: new Date().toISOString(),
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const missing = [
      ...(this.config.baseUrl ? [] : ['DOCUBOX_PRODUCTION_KMS_URL']),
      ...(this.config.serviceToken ? [] : ['DOCUBOX_PRODUCTION_KMS_SERVICE_TOKEN']),
      ...(this.config.documentKeyId ? [] : ['DOCUBOX_PRODUCTION_KMS_DOCUMENT_KEY']),
      ...(this.config.evidenceKeyId ? [] : ['DOCUBOX_PRODUCTION_KMS_EVIDENCE_KEY']),
    ];
    if (missing.length) return { ready: false, missing, provider: this.providerId };
    try {
      const metadata = await this.getKeyMetadata(this.config.documentKeyId!);
      const payload = await this.request('/v1/docubox/health', { method: 'GET' });
      if (payload.ready !== true) throw new CertificationError('PRODUCTION_KMS_HEALTH_FAILED', 'El KMS de produccion no esta listo.', 503);
      return { ready: true, missing: [], provider: this.providerId, keyId: metadata.keyId, keyVersion: metadata.keyVersion };
    } catch (error) {
      return { ready: false, missing: [error instanceof CertificationError ? error.code : 'PRODUCTION_KMS_HEALTH_FAILED'], provider: this.providerId };
    }
  }
}
