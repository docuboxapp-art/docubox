import { getVercelOidcToken } from '@vercel/oidc';
import {
  ExternalAccountClient,
  GCPEnv,
  GoogleAuth,
  type AuthClient,
  type ExternalAccountSupplierContext,
  type SubjectTokenSupplier,
} from 'google-auth-library';
import { CertificationError } from './types';

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const JWT_SUBJECT_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:jwt';
const GOOGLE_STS_TOKEN_URL = 'https://sts.googleapis.com/v1/token';

export type GoogleCloudAuthMode = 'local_adc' | 'workload_identity' | 'gcp_native';
export type HostingProvider = 'vercel' | 'aws' | 'azure' | 'gcp' | 'generic';

export interface GoogleCloudAuthProvider {
  getAuthClient(): Promise<AuthClient>;
}

export interface WorkloadSubjectTokenProvider {
  getSubjectToken(): Promise<string>;
}

type SubjectTokenResolver = () => Promise<string> | string;

type GoogleCloudAuthEnvironment = Record<string, string | undefined>;

type AuthProviderFactoryOptions = {
  environment?: GoogleCloudAuthEnvironment;
  projectId?: string;
  serviceAccountEmail?: string;
  subjectTokenProvider?: WorkloadSubjectTokenProvider;
};

type AdcProviderOptions = {
  projectId: string;
  environment?: GoogleCloudAuthEnvironment;
  authFactory?: (projectId: string) => Promise<AuthClient>;
  runtimeCheck?: () => Promise<boolean>;
};

type WorkloadIdentityProviderOptions = {
  projectId: string;
  serviceAccountEmail: string;
  audience: string;
  poolId: string;
  providerId: string;
  subjectTokenType?: string;
  subjectTokenProvider: WorkloadSubjectTokenProvider;
};

function value(environment: GoogleCloudAuthEnvironment, name: string) {
  const configured = environment[name]?.trim();
  return configured || null;
}

function required(valueToCheck: string | null | undefined, variableName: string) {
  if (!valueToCheck?.trim()) {
    throw new CertificationError(
      'GCP_AUTH_NOT_CONFIGURED',
      `La autenticacion de Google Cloud requiere ${variableName}.`,
      503
    );
  }
  return valueToCheck.trim();
}

function parseAuthMode(environment: GoogleCloudAuthEnvironment): GoogleCloudAuthMode {
  const configured = value(environment, 'GCP_AUTH_MODE')?.toLowerCase();
  if (!configured) {
    if (value(environment, 'NODE_ENV') === 'production') {
      throw new CertificationError(
        'GCP_AUTH_MODE_REQUIRED',
        'GCP_AUTH_MODE es obligatorio en runtimes productivos.',
        503
      );
    }
    return 'local_adc';
  }
  if (
    configured !== 'local_adc' &&
    configured !== 'workload_identity' &&
    configured !== 'gcp_native'
  ) {
    throw new CertificationError(
      'GCP_AUTH_MODE_INVALID',
      'GCP_AUTH_MODE debe ser local_adc, workload_identity o gcp_native.',
      503
    );
  }
  return configured;
}

function parseHostingProvider(environment: GoogleCloudAuthEnvironment): HostingProvider {
  const configured = value(environment, 'HOSTING_PROVIDER')?.toLowerCase();
  if (!configured) {
    throw new CertificationError(
      'HOSTING_PROVIDER_REQUIRED',
      'HOSTING_PROVIDER es obligatorio cuando GCP_AUTH_MODE=workload_identity.',
      503
    );
  }
  if (!['vercel', 'aws', 'azure', 'gcp', 'generic'].includes(configured)) {
    throw new CertificationError(
      'HOSTING_PROVIDER_INVALID',
      'HOSTING_PROVIDER debe ser vercel, aws, azure, gcp o generic.',
      503
    );
  }
  return configured as HostingProvider;
}

function assertNoPermanentProductionCredentials(environment: GoogleCloudAuthEnvironment) {
  if (value(environment, 'NODE_ENV') !== 'production') return;
  const forbidden = [
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GOOGLE_CREDENTIALS',
    'GCP_SERVICE_ACCOUNT_JSON',
    'GOOGLE_SERVICE_ACCOUNT_JSON',
    'GCP_PRIVATE_KEY',
    'GOOGLE_PRIVATE_KEY',
  ].filter((name) => value(environment, name));
  if (forbidden.length > 0) {
    throw new CertificationError(
      'GCP_PERMANENT_CREDENTIALS_FORBIDDEN',
      `El runtime productivo no admite credenciales permanentes: ${forbidden.join(', ')}.`,
      503
    );
  }
}

function assertSubjectToken(token: string, provider: string) {
  const normalized = token.trim();
  if (!normalized) {
    throw new CertificationError(
      'GCP_WIF_SUBJECT_TOKEN_UNAVAILABLE',
      `${provider} no proporciono un subject token para Workload Identity.`,
      503
    );
  }
  return normalized;
}

class DelegatingSubjectTokenProvider implements WorkloadSubjectTokenProvider {
  constructor(
    private readonly providerName: string,
    private readonly resolver: SubjectTokenResolver
  ) {}

  async getSubjectToken() {
    return assertSubjectToken(await this.resolver(), this.providerName);
  }
}

export class VercelOidcSubjectTokenProvider extends DelegatingSubjectTokenProvider {
  constructor(resolver: SubjectTokenResolver = () => getVercelOidcToken()) {
    super('Vercel OIDC', resolver);
  }
}

export class GenericOidcSubjectTokenProvider extends DelegatingSubjectTokenProvider {
  constructor(resolver: SubjectTokenResolver) {
    super('Generic OIDC', resolver);
  }
}

/** Extension point for a future AWS signed GetCallerIdentity subject token. */
export class AwsSubjectTokenProvider extends DelegatingSubjectTokenProvider {
  constructor(resolver: SubjectTokenResolver) {
    super('AWS', resolver);
  }
}

/** Extension point for a future Azure managed-identity OIDC subject token. */
export class AzureOidcSubjectTokenProvider extends DelegatingSubjectTokenProvider {
  constructor(resolver: SubjectTokenResolver) {
    super('Azure OIDC', resolver);
  }
}

class AdcGoogleCloudAuthProvider implements GoogleCloudAuthProvider {
  private authClientPromise: Promise<AuthClient> | null = null;

  constructor(private readonly options: AdcProviderOptions) {}

  async getAuthClient() {
    assertNoPermanentProductionCredentials(this.options.environment || process.env);
    if (!this.authClientPromise) {
      this.authClientPromise = (async () => {
        if (this.options.runtimeCheck && !(await this.options.runtimeCheck())) {
          throw new CertificationError(
            'GCP_NATIVE_IDENTITY_UNAVAILABLE',
            'El modo gcp_native requiere un runtime con identidad nativa de Google Cloud.',
            503
          );
        }
        return this.options.authFactory
          ? this.options.authFactory(this.options.projectId)
          : new GoogleAuth({
              projectId: this.options.projectId,
              scopes: [CLOUD_PLATFORM_SCOPE],
            }).getClient();
      })();
    }
    return await this.authClientPromise;
  }
}

export class LocalAdcGoogleCloudAuthProvider extends AdcGoogleCloudAuthProvider {
  constructor(options: AdcProviderOptions) {
    super(options);
  }
}

export class GcpNativeGoogleCloudAuthProvider extends AdcGoogleCloudAuthProvider {
  constructor(options: AdcProviderOptions) {
    const auth = new GoogleAuth({
      projectId: options.projectId,
      scopes: [CLOUD_PLATFORM_SCOPE],
    });
    super({
      ...options,
      authFactory: options.authFactory || (() => auth.getClient()),
      runtimeCheck: options.runtimeCheck || (async () => (await auth.getEnv()) !== GCPEnv.NONE),
    });
  }
}

class WorkloadSubjectTokenSupplier implements SubjectTokenSupplier {
  constructor(private readonly provider: WorkloadSubjectTokenProvider) {}

  getSubjectToken(_context: ExternalAccountSupplierContext) {
    return this.provider.getSubjectToken();
  }
}

export class WorkloadIdentityGoogleCloudAuthProvider implements GoogleCloudAuthProvider {
  private authClient: AuthClient | null = null;

  constructor(private readonly options: WorkloadIdentityProviderOptions) {
    const expectedProviderPath = `/workloadIdentityPools/${options.poolId}/providers/${options.providerId}`;
    if (!options.audience.startsWith('//iam.googleapis.com/projects/')) {
      throw new CertificationError(
        'GCP_WIF_AUDIENCE_INVALID',
        'GCP_WIF_AUDIENCE debe ser un recurso completo de Workload Identity Federation.',
        503
      );
    }
    if (!options.audience.endsWith(expectedProviderPath)) {
      throw new CertificationError(
        'GCP_WIF_AUDIENCE_MISMATCH',
        'GCP_WIF_AUDIENCE no coincide con el pool y provider configurados.',
        503
      );
    }
    if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(options.serviceAccountEmail)) {
      throw new CertificationError(
        'GCP_SERVICE_ACCOUNT_INVALID',
        'GCP_SERVICE_ACCOUNT_EMAIL no contiene una cuenta de servicio valida.',
        503
      );
    }
  }

  async getAuthClient() {
    if (this.authClient) return this.authClient;
    const client = ExternalAccountClient.fromJSON({
      type: 'external_account',
      audience: this.options.audience,
      subject_token_type: this.options.subjectTokenType || JWT_SUBJECT_TOKEN_TYPE,
      token_url: GOOGLE_STS_TOKEN_URL,
      service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${this.options.serviceAccountEmail}:generateAccessToken`,
      scopes: [CLOUD_PLATFORM_SCOPE],
      subject_token_supplier: new WorkloadSubjectTokenSupplier(this.options.subjectTokenProvider),
    });
    if (!client) {
      throw new CertificationError(
        'GCP_WIF_CLIENT_CREATION_FAILED',
        'Google Auth no pudo crear el cliente de Workload Identity Federation.',
        503
      );
    }
    this.authClient = client;
    return client;
  }
}
function resolveSubjectTokenProvider(
  hostingProvider: HostingProvider,
  injectedProvider?: WorkloadSubjectTokenProvider
) {
  if (injectedProvider) return injectedProvider;
  if (hostingProvider === 'vercel') return new VercelOidcSubjectTokenProvider();
  throw new CertificationError(
    'GCP_WIF_SUBJECT_TOKEN_PROVIDER_REQUIRED',
    `El hosting ${hostingProvider} requiere un WorkloadSubjectTokenProvider inyectado.`,
    503
  );
}

export function createGoogleCloudAuthProvider(
  options: AuthProviderFactoryOptions = {}
): GoogleCloudAuthProvider {
  const environment = options.environment || process.env;
  const mode = parseAuthMode(environment);
  const projectId = required(
    value(environment, 'GCP_PROJECT_ID') || options.projectId,
    'GCP_PROJECT_ID'
  );

  if (mode === 'local_adc') {
    return new LocalAdcGoogleCloudAuthProvider({ projectId, environment });
  }
  if (mode === 'gcp_native') {
    return new GcpNativeGoogleCloudAuthProvider({ projectId, environment });
  }

  assertNoPermanentProductionCredentials(environment);
  const serviceAccountEmail = required(
    value(environment, 'GCP_SERVICE_ACCOUNT_EMAIL') || options.serviceAccountEmail,
    'GCP_SERVICE_ACCOUNT_EMAIL'
  );
  const poolId = required(
    value(environment, 'GCP_WORKLOAD_IDENTITY_POOL_ID'),
    'GCP_WORKLOAD_IDENTITY_POOL_ID'
  );
  const providerId = required(
    value(environment, 'GCP_WORKLOAD_IDENTITY_PROVIDER_ID'),
    'GCP_WORKLOAD_IDENTITY_PROVIDER_ID'
  );
  const audience = required(value(environment, 'GCP_WIF_AUDIENCE'), 'GCP_WIF_AUDIENCE');
  const hostingProvider = parseHostingProvider(environment);
  return new WorkloadIdentityGoogleCloudAuthProvider({
    projectId,
    serviceAccountEmail,
    poolId,
    providerId,
    audience,
    subjectTokenType: value(environment, 'GCP_WIF_SUBJECT_TOKEN_TYPE') || undefined,
    subjectTokenProvider: resolveSubjectTokenProvider(
      hostingProvider,
      options.subjectTokenProvider
    ),
  });
}
