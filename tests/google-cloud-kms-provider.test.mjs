import assert from 'node:assert/strict';
import { constants, createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build } from 'esbuild';
import test from 'node:test';

const cacheDirectory = join(process.cwd(), 'node_modules', '.cache', 'docubox-google-kms-test');
const bundlePath = join(cacheDirectory, 'provider.cjs');
await mkdir(cacheDirectory, { recursive: true });
await build({
  entryPoints: [join(process.cwd(), 'src', 'lib', 'certification', 'key-management.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundlePath,
  external: ['@google-cloud/kms'],
  logLevel: 'silent',
});
const { GoogleCloudKmsProvider } = createRequire(import.meta.url)(bundlePath);

const config = {
  environment: 'development',
  projectId: 'project-702d9de4-d29c-49f2-82c',
  location: 'us-east1',
  keyRing: 'docubox-pades',
  keyName: 'docubox-pades-signing',
  keyVersion: '1',
  algorithm: 'RSA_SIGN_PKCS1_3072_SHA256',
  serviceAccount: 'docubox-pades-signer@example.test',
  requiredProtectionLevel: 'software',
};

function fixture(protectionLevel = 'SOFTWARE') {
  const expectedPayload = Buffer.from('Prueba criptografica Docubox KMS');
  const expectedDigest = createHash('sha256').update(expectedPayload).digest();
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const resourceName =
    'projects/project-702d9de4-d29c-49f2-82c/locations/us-east1/keyRings/docubox-pades/cryptoKeys/docubox-pades-signing/cryptoKeyVersions/1';
  const client = {
    async getPublicKey(request) {
      assert.equal(request.name, resourceName);
      return [
        {
          name: resourceName,
          pem: publicKeyPem,
          algorithm: 'RSA_SIGN_PKCS1_3072_SHA256',
          protectionLevel,
        },
      ];
    },
    async asymmetricSign(request) {
      assert.equal(request.name, resourceName);
      assert.deepEqual(Buffer.from(request.digest.sha256), expectedDigest);
      return [
        {
          name: resourceName,
          signature: sign('sha256', expectedPayload, {
            key: privateKey,
            padding: constants.RSA_PKCS1_PADDING,
          }),
        },
      ];
    },
  };
  return { client, resourceName };
}

test('Google Cloud KMS provider signs a verified SHA-256 digest through the existing provider contract', async () => {
  const { client, resourceName } = fixture();
  const provider = new GoogleCloudKmsProvider(config, client);
  assert.equal(provider.resourceName, resourceName);
  const canonicalBytes = Buffer.from('Prueba criptografica Docubox KMS');
  const digestSha256 = createHash('sha256').update(canonicalBytes).digest('hex');
  const result = await provider.signDigest({
    purpose: 'DOCUMENT_SEAL',
    canonicalBytes,
    digestSha256,
  });
  assert.equal(result.status, 'VALID');
  assert.equal(result.algorithm, 'RSA-PKCS1-SHA256');
  assert.equal(result.keySizeBits, 3072);
  assert.equal(result.keyVersion, '1');
});

test('production Google Cloud KMS accepts only a key reported as HSM', async () => {
  const { client } = fixture('HSM');
  const provider = new GoogleCloudKmsProvider(
    {
      ...config,
      environment: 'production',
      requiredProtectionLevel: 'hsm',
    },
    client
  );
  const metadata = await provider.getKeyMetadata(config.keyName);
  assert.equal(metadata.protectionLevel, 'hsm');
});

test('production Google Cloud KMS fails closed when Google reports SOFTWARE', async () => {
  const { client } = fixture('SOFTWARE');
  const provider = new GoogleCloudKmsProvider(
    {
      ...config,
      environment: 'production',
      requiredProtectionLevel: 'hsm',
    },
    client
  );
  await assert.rejects(provider.getKeyMetadata(config.keyName), {
    code: 'PRODUCTION_HSM_REQUIRED',
  });
});

test('Google Cloud KMS provider fails closed when canonical bytes do not match the digest', async () => {
  const { client } = fixture();
  const provider = new GoogleCloudKmsProvider(config, client);
  await assert.rejects(
    provider.signDigest({
      purpose: 'DOCUMENT_SEAL',
      canonicalBytes: Buffer.from('altered'),
      digestSha256: '0'.repeat(64),
    }),
    { code: 'DIGEST_MISMATCH' }
  );
});

test('Google Cloud KMS provider refuses any key identifier outside its configured resource', async () => {
  const { client } = fixture();
  const provider = new GoogleCloudKmsProvider(config, client);
  await assert.rejects(provider.getPublicKey('another-key'), {
    code: 'GOOGLE_KMS_KEY_ID_MISMATCH',
  });
});

test('Google Cloud KMS receives an injected AuthClient without any hosting dependency', async () => {
  const { client } = fixture();
  const injectedAuthClient = { kind: 'portable-auth-client' };
  let receivedAuthClient = null;
  let authCalls = 0;
  let clientFactoryCalls = 0;
  const authProvider = {
    async getAuthClient() {
      authCalls += 1;
      return injectedAuthClient;
    },
  };
  const provider = new GoogleCloudKmsProvider(config, undefined, authProvider, (authClient) => {
    clientFactoryCalls += 1;
    receivedAuthClient = authClient;
    return client;
  });

  await provider.getPublicKey(config.keyName);
  await provider.getKeyMetadata(config.keyName);

  assert.equal(receivedAuthClient, injectedAuthClient);
  assert.equal(authCalls, 1);
  assert.equal(clientFactoryCalls, 1);
});
