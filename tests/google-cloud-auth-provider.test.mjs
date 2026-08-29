import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build } from 'esbuild';
import test from 'node:test';

const cacheDirectory = join(process.cwd(), 'node_modules', '.cache', 'docubox-google-auth-test');
const bundlePath = join(cacheDirectory, 'provider.cjs');
await mkdir(cacheDirectory, { recursive: true });
await build({
  entryPoints: [join(process.cwd(), 'src', 'lib', 'certification', 'google-cloud-auth.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundlePath,
  external: ['@vercel/oidc', 'google-auth-library'],
  logLevel: 'silent',
});

const {
  createGoogleCloudAuthProvider,
  GcpNativeGoogleCloudAuthProvider,
  GenericOidcSubjectTokenProvider,
  LocalAdcGoogleCloudAuthProvider,
  VercelOidcSubjectTokenProvider,
  WorkloadIdentityGoogleCloudAuthProvider,
} = createRequire(import.meta.url)(bundlePath);

const audience =
  '//iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/docubox-hosting/providers/vercel-production';

test('LOCAL_ADC obtains an AuthClient through the portable provider contract', async () => {
  const expectedClient = { kind: 'adc' };
  let factoryCalls = 0;
  const provider = new LocalAdcGoogleCloudAuthProvider({
    projectId: 'docubox-project',
    environment: { NODE_ENV: 'development' },
    async authFactory(projectId) {
      factoryCalls += 1;
      assert.equal(projectId, 'docubox-project');
      return expectedClient;
    },
  });

  assert.equal(await provider.getAuthClient(), expectedClient);
  assert.equal(await provider.getAuthClient(), expectedClient);
  assert.equal(factoryCalls, 1);
});

test('production rejects permanent service-account credentials', async () => {
  const provider = new LocalAdcGoogleCloudAuthProvider({
    projectId: 'docubox-project',
    environment: {
      NODE_ENV: 'production',
      GOOGLE_APPLICATION_CREDENTIALS: '/tmp/service-account.json',
    },
    async authFactory() {
      return { kind: 'must-not-be-created' };
    },
  });

  await assert.rejects(provider.getAuthClient(), {
    code: 'GCP_PERMANENT_CREDENTIALS_FORBIDDEN',
  });
});

test('GCP_NATIVE fails closed outside a Google Cloud native runtime', async () => {
  const provider = new GcpNativeGoogleCloudAuthProvider({
    projectId: 'docubox-project',
    environment: { NODE_ENV: 'production' },
    async runtimeCheck() {
      return false;
    },
    async authFactory() {
      return { kind: 'must-not-be-created' };
    },
  });

  await assert.rejects(provider.getAuthClient(), {
    code: 'GCP_NATIVE_IDENTITY_UNAVAILABLE',
  });
});

test('WORKLOAD_IDENTITY builds an external account client with an injected subject provider', async () => {
  const subjectProvider = new GenericOidcSubjectTokenProvider(
    async () => 'header.payload.signature'
  );
  const provider = new WorkloadIdentityGoogleCloudAuthProvider({
    projectId: 'docubox-project',
    serviceAccountEmail: 'docubox-signer@docubox-project.iam.gserviceaccount.com',
    audience,
    poolId: 'docubox-hosting',
    providerId: 'vercel-production',
    subjectTokenProvider: subjectProvider,
  });

  const first = await provider.getAuthClient();
  const second = await provider.getAuthClient();
  assert.equal(first, second);
  assert.equal(await subjectProvider.getSubjectToken(), 'header.payload.signature');
});

test('Vercel OIDC remains behind WorkloadSubjectTokenProvider', async () => {
  const provider = new VercelOidcSubjectTokenProvider(async () => 'vercel.jwt.token');
  assert.equal(await provider.getSubjectToken(), 'vercel.jwt.token');
});

test('factory resolves Vercel only inside the auth layer and accepts a portable injected supplier', async () => {
  const subjectProvider = new GenericOidcSubjectTokenProvider(async () => 'portable.jwt.token');
  const provider = createGoogleCloudAuthProvider({
    environment: {
      NODE_ENV: 'production',
      GCP_AUTH_MODE: 'workload_identity',
      GCP_PROJECT_ID: 'docubox-project',
      GCP_SERVICE_ACCOUNT_EMAIL: 'docubox-signer@docubox-project.iam.gserviceaccount.com',
      GCP_WORKLOAD_IDENTITY_POOL_ID: 'docubox-hosting',
      GCP_WORKLOAD_IDENTITY_PROVIDER_ID: 'vercel-production',
      GCP_WIF_AUDIENCE: audience,
      HOSTING_PROVIDER: 'vercel',
    },
    subjectTokenProvider: subjectProvider,
  });

  assert.ok(await provider.getAuthClient());
});

test('production fails closed when GCP_AUTH_MODE is missing', () => {
  assert.throws(
    () =>
      createGoogleCloudAuthProvider({
        environment: { NODE_ENV: 'production', GCP_PROJECT_ID: 'docubox-project' },
      }),
    { code: 'GCP_AUTH_MODE_REQUIRED' }
  );
});

test('WIF rejects an audience that does not match pool and provider', () => {
  assert.throws(
    () =>
      new WorkloadIdentityGoogleCloudAuthProvider({
        projectId: 'docubox-project',
        serviceAccountEmail: 'docubox-signer@docubox-project.iam.gserviceaccount.com',
        audience,
        poolId: 'another-pool',
        providerId: 'vercel-production',
        subjectTokenProvider: new GenericOidcSubjectTokenProvider(async () => 'token'),
      }),
    { code: 'GCP_WIF_AUDIENCE_MISMATCH' }
  );
});
