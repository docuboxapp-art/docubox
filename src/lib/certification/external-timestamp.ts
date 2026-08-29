import { createHash, X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import {
  LocalRfc3161Provider,
  type TimestampAuthorityProvider,
  type TimestampDigestInput,
  type TimestampResult,
  type TimestampVerificationInput,
} from './timestamp';
import type { ProviderHealth } from './key-management';
import { CertificationError } from './types';

export type ExternalTsaRole = 'PRIMARY' | 'FALLBACK';
export type ExternalTsaHealthState = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'SECURITY_FAILURE';

type TrustArtifact = { path: string; sha256: string };

export type ExternalTsaTrustManifest = {
  id: string;
  provider: 'freetsa' | 'open-tsa';
  version: number;
  status: 'active' | 'superseded';
  endpoint: string;
  role: ExternalTsaRole;
  priority: number;
  installedAt: string;
  supersededAt: string | null;
  tsaCertificateValidFrom: string;
  tsaCertificateValidTo: string;
  trustRootValidFrom: string;
  trustRootValidTo: string;
  policyOid: string | null;
  tsaCertificate: TrustArtifact;
  certificateChain: TrustArtifact;
  trustRoot: TrustArtifact;
  tsaCertificateFingerprintSha256: string;
  trustRootFingerprintSha256: string;
};

export type LoadedExternalTsaTrustBundle = {
  manifest: ExternalTsaTrustManifest;
  tsaCertificatePem: string;
  chainPems: string[];
  trustRootPem: string;
  chainFingerprintsSha256: string[];
};

type CircuitState = {
  consecutiveTemporaryFailures: number;
  openUntil: number;
  securityFailure: boolean;
};

type ExternalProviderConfig = {
  id: 'freetsa' | 'open-tsa';
  role: ExternalTsaRole;
  endpointId: string;
  bundle: LoadedExternalTsaTrustBundle;
  timeoutMs: number;
  maxRequestsPerMinute: number;
  fetchImpl?: typeof fetch;
};

type RouterOptions = {
  primary: RoutedTimestampProvider;
  fallback: RoutedTimestampProvider;
  retryDelayMs?: number;
  circuitFailureThreshold?: number;
  circuitCooldownMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
};

export type RoutedTimestampProvider = TimestampAuthorityProvider & { providerId: string };

const TEMPORARY_FAILURES = new Set([
  'TSA_HTTP_ERROR',
  'TSA_RATE_LIMITED',
  'TSA_TEMPORARY_UNAVAILABLE',
  'RFC3161_TSA_REJECTED',
]);

const SECURITY_FAILURES = new Set([
  'TSA_IMPRINT_MISMATCH',
  'TSA_NONCE_MISMATCH',
  'TSA_SIGNATURE_INVALID',
  'TSA_CERTIFICATE_INVALID',
  'TSA_CHAIN_INVALID',
  'TSA_POLICY_MISMATCH',
  'TSA_TOKEN_CORRUPTED',
  'TSA_PROTOCOL_ERROR',
  'TSA_RESPONSE_EMPTY',
  'RFC3161_TOKEN_PARSE_FAILED',
  'RFC3161_RESPONSE_PARSE_FAILED',
  'RFC3161_TSTINFO_PARSE_FAILED',
]);

function splitPemCertificates(value: string) {
  return value.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
}

function sha256(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

function certificateFingerprint(pem: string) {
  return new X509Certificate(pem).fingerprint256.replace(/:/g, '').toLowerCase();
}

function assertCertificateWindow(
  certificate: X509Certificate,
  expectedFrom: string,
  expectedTo: string,
  label: string
) {
  const validFrom = new Date(certificate.validFrom).toISOString();
  const validTo = new Date(certificate.validTo).toISOString();
  if (validFrom !== expectedFrom || validTo !== expectedTo) {
    throw new CertificationError(
      'TSA_TRUST_BUNDLE_VALIDITY_MISMATCH',
      `La vigencia de ${label} no coincide con el manifest.`,
      503
    );
  }
  const now = Date.now();
  if (now < Date.parse(validFrom) || now > Date.parse(validTo)) {
    throw new CertificationError(
      'TSA_TRUST_BUNDLE_CERTIFICATE_EXPIRED',
      `${label} no esta vigente.`,
      503
    );
  }
}

function artifactPath(directory: string, path: string) {
  return isAbsolute(path) ? path : join(directory, path);
}

async function readVerifiedArtifact(directory: string, artifact: TrustArtifact) {
  const bytes = await readFile(artifactPath(directory, artifact.path));
  if (sha256(bytes) !== artifact.sha256.toLowerCase()) {
    throw new CertificationError(
      'TSA_TRUST_ARTIFACT_HASH_MISMATCH',
      `El artefacto ${artifact.path} no coincide con el bundle de confianza.`,
      503
    );
  }
  return bytes.toString('utf8');
}

export async function loadExternalTsaTrustBundle(
  directory: string
): Promise<LoadedExternalTsaTrustBundle> {
  const absoluteDirectory = resolve(directory);
  const manifest = JSON.parse(
    await readFile(join(absoluteDirectory, 'manifest.json'), 'utf8')
  ) as ExternalTsaTrustManifest;
  if (
    !manifest.id ||
    manifest.status !== 'active' ||
    new URL(manifest.endpoint).protocol !== 'https:'
  ) {
    throw new CertificationError(
      'TSA_TRUST_BUNDLE_INVALID',
      'El bundle TSA no esta activo o no usa HTTPS.',
      503
    );
  }
  const [tsaCertificatePem, chainPem, trustRootPem] = await Promise.all([
    readVerifiedArtifact(absoluteDirectory, manifest.tsaCertificate),
    readVerifiedArtifact(absoluteDirectory, manifest.certificateChain),
    readVerifiedArtifact(absoluteDirectory, manifest.trustRoot),
  ]);
  const chainPems = splitPemCertificates(chainPem);
  const rootPems = splitPemCertificates(trustRootPem);
  if (!chainPems.length || !rootPems.length) {
    throw new CertificationError(
      'TSA_TRUST_BUNDLE_INVALID',
      'El bundle TSA no contiene cadena o raiz.',
      503
    );
  }
  if (
    certificateFingerprint(tsaCertificatePem) !==
    manifest.tsaCertificateFingerprintSha256.toLowerCase()
  ) {
    throw new CertificationError(
      'TSA_CERTIFICATE_FINGERPRINT_MISMATCH',
      'El certificado TSA no coincide con el manifest.',
      503
    );
  }
  if (certificateFingerprint(rootPems[0]!) !== manifest.trustRootFingerprintSha256.toLowerCase()) {
    throw new CertificationError(
      'TSA_ROOT_FINGERPRINT_MISMATCH',
      'La raiz TSA no coincide con el manifest.',
      503
    );
  }
  assertCertificateWindow(
    new X509Certificate(tsaCertificatePem),
    manifest.tsaCertificateValidFrom,
    manifest.tsaCertificateValidTo,
    'el certificado TSA'
  );
  assertCertificateWindow(
    new X509Certificate(rootPems[0]!),
    manifest.trustRootValidFrom,
    manifest.trustRootValidTo,
    'la raiz TSA'
  );
  return {
    manifest,
    tsaCertificatePem,
    chainPems,
    trustRootPem,
    chainFingerprintsSha256: chainPems.map(certificateFingerprint),
  };
}

class SlidingWindowRateLimiter {
  private readonly starts: number[] = [];
  private queue = Promise.resolve();

  constructor(
    private readonly limit: number,
    private readonly sleep: (ms: number) => Promise<void>
  ) {}

  async schedule<T>(operation: () => Promise<T>) {
    let release!: () => void;
    const previous = this.queue;
    this.queue = new Promise<void>((resolveQueue) => {
      release = resolveQueue;
    });
    await previous;
    try {
      const now = Date.now();
      while (this.starts.length && this.starts[0] <= now - 60_000) this.starts.shift();
      if (this.starts.length >= this.limit) {
        const wait = Math.max(1, this.starts[0]! + 60_000 - now);
        await this.sleep(wait);
        const resumed = Date.now();
        while (this.starts.length && this.starts[0] <= resumed - 60_000) this.starts.shift();
      }
      this.starts.push(Date.now());
      return await operation();
    } finally {
      release();
    }
  }
}

export class ExternalRfc3161Provider implements TimestampAuthorityProvider {
  readonly providerId: string;
  private readonly delegate: LocalRfc3161Provider;
  private readonly limiter: SlidingWindowRateLimiter;

  constructor(private readonly config: ExternalProviderConfig) {
    this.providerId = config.id;
    this.delegate = new LocalRfc3161Provider(
      {
        url: config.bundle.manifest.endpoint,
        policyOid: config.bundle.manifest.policyOid || undefined,
        timeoutMs: config.timeoutMs,
        tsaCertificatePem: config.bundle.tsaCertificatePem,
        trustRootPem: config.bundle.trustRootPem,
        tsaChainPems: config.bundle.chainPems,
        trustRootPems: splitPemCertificates(config.bundle.trustRootPem),
        fetchImpl: config.fetchImpl,
      },
      config.id
    );
    this.limiter = new SlidingWindowRateLimiter(
      Math.max(1, config.maxRequestsPerMinute),
      (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
    );
  }

  async timestampDigest(input: TimestampDigestInput): Promise<TimestampResult> {
    const result = await this.limiter.schedule(() => this.delegate.timestampDigest(input));
    return {
      ...result,
      providerRole: this.config.role,
      endpointId: this.config.endpointId,
      trustBundleId: this.config.bundle.manifest.id,
      trustRootFingerprintSha256: this.config.bundle.manifest.trustRootFingerprintSha256,
      trustChainFingerprintsSha256: this.config.bundle.chainFingerprintsSha256,
      fallbackUsed: this.config.role === 'FALLBACK',
      fallbackReason: null,
      primaryFailureCode: null,
      primaryFailureClass: null,
    };
  }

  verifyTimestamp(token: Uint8Array, input?: TimestampVerificationInput) {
    return this.delegate.verifyTimestamp(token, input);
  }

  async healthCheck(): Promise<ProviderHealth> {
    const trust = await this.delegate.healthCheck();
    if (!trust.ready)
      return { ...trust, provider: this.providerId, detail: 'UNAVAILABLE: trust bundle invalid' };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(this.config.timeoutMs, 4_000));
    try {
      const response = await (this.config.fetchImpl || fetch)(
        this.config.bundle.manifest.endpoint,
        {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
        }
      );
      const reachable = response.status < 500 || response.status === 429;
      return {
        ready: reachable,
        missing: reachable ? [] : [`HTTP ${response.status}`],
        provider: this.providerId,
        detail:
          response.status === 429
            ? 'DEGRADED: rate limited'
            : reachable
              ? 'HEALTHY'
              : 'UNAVAILABLE',
      };
    } catch (error) {
      return {
        ready: false,
        missing: ['DNS/connectivity'],
        provider: this.providerId,
        detail: error instanceof Error ? `UNAVAILABLE: ${error.name}` : 'UNAVAILABLE',
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class TimeStampProviderRouter implements TimestampAuthorityProvider {
  readonly providerId = 'external-free';
  private readonly circuits = new Map<string, CircuitState>();
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly retryDelayMs: number;
  private readonly circuitFailureThreshold: number;
  private readonly circuitCooldownMs: number;

  constructor(private readonly options: RouterOptions) {
    this.sleep =
      options.sleep ||
      ((milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)));
    this.random = options.random || Math.random;
    this.retryDelayMs = options.retryDelayMs ?? 250;
    this.circuitFailureThreshold = options.circuitFailureThreshold ?? 5;
    this.circuitCooldownMs = options.circuitCooldownMs ?? 30_000;
    this.circuits.set(options.primary.providerId, {
      consecutiveTemporaryFailures: 0,
      openUntil: 0,
      securityFailure: false,
    });
    this.circuits.set(options.fallback.providerId, {
      consecutiveTemporaryFailures: 0,
      openUntil: 0,
      securityFailure: false,
    });
  }

  private classFor(error: unknown) {
    const code = error instanceof CertificationError ? error.code : 'TSA_HTTP_ERROR';
    return {
      code,
      classification: SECURITY_FAILURES.has(code)
        ? ('SECURITY_VALIDATION_FAILURE' as const)
        : ('TEMPORARY_FAILURE' as const),
      retryable: TEMPORARY_FAILURES.has(code) || !(error instanceof CertificationError),
    };
  }

  private retryDelayFor(error: unknown) {
    const retryAfterMs =
      error && typeof error === 'object' && 'retryAfterMs' in error
        ? Number((error as { retryAfterMs?: unknown }).retryAfterMs)
        : Number.NaN;
    if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
      return Math.min(retryAfterMs, 60_000);
    }
    return this.retryDelayMs + Math.floor(this.random() * this.retryDelayMs);
  }

  private circuit(provider: RoutedTimestampProvider) {
    return this.circuits.get(provider.providerId)!;
  }

  private ensureCircuitAvailable(provider: RoutedTimestampProvider) {
    const state = this.circuit(provider);
    if (state.openUntil > Date.now()) {
      throw new CertificationError(
        'TSA_CIRCUIT_OPEN',
        `El circuito de ${provider.providerId} esta abierto.`,
        503
      );
    }
    if (state.openUntil) state.openUntil = 0;
  }

  private recordSuccess(provider: RoutedTimestampProvider) {
    this.circuits.set(provider.providerId, {
      consecutiveTemporaryFailures: 0,
      openUntil: 0,
      securityFailure: false,
    });
  }

  private recordFailure(
    provider: RoutedTimestampProvider,
    classification: 'TEMPORARY_FAILURE' | 'SECURITY_VALIDATION_FAILURE'
  ) {
    const state = this.circuit(provider);
    if (classification === 'SECURITY_VALIDATION_FAILURE') {
      state.securityFailure = true;
      return;
    }
    state.consecutiveTemporaryFailures += 1;
    if (state.consecutiveTemporaryFailures >= this.circuitFailureThreshold) {
      state.openUntil = Date.now() + this.circuitCooldownMs;
    }
  }

  private async request(provider: RoutedTimestampProvider, input: TimestampDigestInput) {
    this.ensureCircuitAvailable(provider);
    try {
      const result = await provider.timestampDigest(input);
      this.recordSuccess(provider);
      return result;
    } catch (error) {
      const classified = this.classFor(error);
      this.recordFailure(provider, classified.classification);
      throw error;
    }
  }

  async timestampDigest(input: TimestampDigestInput): Promise<TimestampResult> {
    let primaryError: unknown;
    let primaryFailure = {
      code: 'TSA_PRIMARY_UNAVAILABLE',
      classification: 'TEMPORARY_FAILURE' as 'TEMPORARY_FAILURE' | 'SECURITY_VALIDATION_FAILURE',
      retryable: true,
    };
    try {
      return await this.request(this.options.primary, input);
    } catch (error) {
      primaryError = error;
      primaryFailure = this.classFor(error);
    }
    if (primaryFailure.retryable) {
      await this.sleep(this.retryDelayFor(primaryError));
      try {
        return await this.request(this.options.primary, input);
      } catch (error) {
        primaryError = error;
        primaryFailure = this.classFor(error);
      }
    }
    try {
      const fallback = await this.request(this.options.fallback, input);
      return {
        ...fallback,
        fallbackUsed: true,
        fallbackReason: primaryFailure.code,
        primaryFailureCode: primaryFailure.code,
        primaryFailureClass: primaryFailure.classification,
      };
    } catch (fallbackError) {
      const fallbackFailure = this.classFor(fallbackError);
      throw new CertificationError(
        'EXTERNAL_TSA_UNAVAILABLE',
        `No fue posible obtener una estampa externa valida (primary=${primaryFailure.code}, fallback=${fallbackFailure.code}).`,
        503
      );
    }
  }

  async verifyTimestamp(token: Uint8Array, input: TimestampVerificationInput = {}) {
    const primary = await this.options.primary.verifyTimestamp(token, input);
    if (primary.valid) return primary;
    return this.options.fallback.verifyTimestamp(token, input);
  }

  async healthCheck(): Promise<ProviderHealth> {
    const [primary, fallback] = await Promise.all([
      this.options.primary.healthCheck(),
      this.options.fallback.healthCheck(),
    ]);
    const primaryCircuit = this.circuit(this.options.primary);
    const state: ExternalTsaHealthState = primaryCircuit.securityFailure
      ? 'SECURITY_FAILURE'
      : primary.ready
        ? 'HEALTHY'
        : fallback.ready
          ? 'DEGRADED'
          : 'UNAVAILABLE';
    return {
      ready: primary.ready || fallback.ready,
      missing: [
        ...primary.missing.map((item) => `freetsa:${item}`),
        ...fallback.missing.map((item) => `open-tsa:${item}`),
      ],
      provider: this.providerId,
      detail: state,
    };
  }
}

export async function createExternalFreeTimestampProvider() {
  const bundleRoot =
    process.env.DOCUBOX_TSA_TRUST_BUNDLE_ROOT ||
    join(process.cwd(), 'infra', 'tsa', 'trust-bundles');
  const [freeTsaBundle, openTsaBundle] = await Promise.all([
    loadExternalTsaTrustBundle(
      process.env.FREETSA_TRUST_BUNDLE_PATH || join(bundleRoot, 'freetsa', 'v1')
    ),
    loadExternalTsaTrustBundle(
      process.env.OPEN_TSA_TRUST_BUNDLE_PATH || join(bundleRoot, 'open-tsa', 'v1')
    ),
  ]);
  const primary = new ExternalRfc3161Provider({
    id: 'freetsa',
    role: 'PRIMARY',
    endpointId: process.env.FREETSA_ENDPOINT_ID || 'freetsa-official-tsr',
    bundle: freeTsaBundle,
    timeoutMs: Math.max(500, Number(process.env.FREETSA_TIMEOUT_MS || 8_000)),
    maxRequestsPerMinute: Math.max(1, Number(process.env.FREETSA_RATE_LIMIT_PER_MINUTE || 30)),
  });
  const fallback = new ExternalRfc3161Provider({
    id: 'open-tsa',
    role: 'FALLBACK',
    endpointId: process.env.OPEN_TSA_ENDPOINT_ID || 'open-tsa-official-tsr',
    bundle: openTsaBundle,
    timeoutMs: Math.max(500, Number(process.env.OPEN_TSA_TIMEOUT_MS || 8_000)),
    maxRequestsPerMinute: Math.max(1, Number(process.env.OPEN_TSA_RATE_LIMIT_PER_MINUTE || 60)),
  });
  return new TimeStampProviderRouter({
    primary,
    fallback,
    retryDelayMs: Math.max(50, Number(process.env.EXTERNAL_TSA_RETRY_DELAY_MS || 250)),
    circuitFailureThreshold: Math.max(
      1,
      Number(process.env.EXTERNAL_TSA_CIRCUIT_FAILURE_THRESHOLD || 5)
    ),
    circuitCooldownMs: Math.max(
      1_000,
      Number(process.env.EXTERNAL_TSA_CIRCUIT_COOLDOWN_MS || 30_000)
    ),
  });
}
