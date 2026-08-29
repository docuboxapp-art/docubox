import assert from 'node:assert/strict';
import { constants, createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const openssl =
  process.env.OPENSSL_BIN ||
  (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
const migrationPath = new URL(
  '../supabase/migrations/20260821123000_wp_crypto_04_x509_certificate_layer.sql',
  import.meta.url
);
const certificatePath = new URL('../src/lib/certification/certificates.ts', import.meta.url);
const providerPath = new URL('../src/lib/certification/providers.ts', import.meta.url);
const enginePath = new URL('../src/lib/certification/engine.ts', import.meta.url);
const bundleDir = await mkdtemp(join(tmpdir(), 'docubox-certificate-provider-'));
const bundlePath = join(bundleDir, 'certificates.cjs');
await build({
  entryPoints: [join(process.cwd(), 'src', 'lib', 'certification', 'certificates.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundlePath,
  logLevel: 'silent',
});
const {
  DevelopmentCertificateProvider,
  ProductionCertificateProvider,
  createKmsSelfSignedProductionCertificate,
  createRemotePkcs10Csr,
  evaluateCertificateStatus,
} = createRequire(import.meta.url)(bundlePath);

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function keyProvider(protectionLevel = 'software') {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return {
    publicKeyPem,
    async getPublicKey() {
      return publicKeyPem;
    },
    async getKeyMetadata() {
      return {
        provider: 'test',
        keyId: 'docubox-development-signing',
        keyVersion: '1',
        algorithm: 'RSA-PSS-SHA256',
        keySizeBits: 2048,
        protectionLevel,
        createdAt: '2026-08-21T00:00:00.000Z',
        status: 'active',
        publicKeyPem,
      };
    },
    async healthCheck() {
      return {
        ready: true,
        missing: [],
        provider: 'test',
        keyId: 'docubox-development-signing',
        keyVersion: '1',
      };
    },
    async signDigest(input) {
      assert.equal(input.digestSha256, sha256Hex(input.canonicalBytes));
      const signature = sign('sha256', input.canonicalBytes, {
        key: privateKey,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      });
      return {
        status: 'VALID',
        signatureBase64: signature.toString('base64'),
        signatureSha256: sha256Hex(signature),
        algorithm: 'RSA-PSS-SHA256',
        keySizeBits: 2048,
        keyId: 'docubox-development-signing',
        keyVersion: '1',
        publicKeyPem,
        publicKeyFingerprintSha256: sha256Hex(publicKeyPem),
        certificatePem: null,
        certificateFingerprintSha256: null,
        signedAt: '2026-08-21T00:00:00.000Z',
      };
    },
  };
}

async function runOpenSsl(args, cwd) {
  return execFileAsync(openssl, args, { cwd, windowsHide: true });
}

async function issueCertificate(provider) {
  const directory = await mkdtemp(join(tmpdir(), 'docubox-pki-test-'));
  const csr = await createRemotePkcs10Csr(provider, 'docubox-development-signing', {
    commonName: 'Docubox Development Signing',
    organization: 'Docubox',
    organizationalUnit: 'Development Cryptographic Services',
    country: 'MX',
  });
  const csrPath = join(directory, 'signing.csr.pem');
  const rootKeyPath = join(directory, 'root.key.pem');
  const rootCertPath = join(directory, 'root.crt.pem');
  const certificatePath = join(directory, 'signing.crt.pem');
  await writeFile(csrPath, csr.pem, 'utf8');
  await runOpenSsl(['req', '-in', csrPath, '-noout', '-verify'], directory);
  await runOpenSsl(
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-keyout',
      rootKeyPath,
      '-out',
      rootCertPath,
      '-days',
      '365',
      '-subj',
      '/C=MX/O=Docubox/OU=Development/CN=Docubox Development Root CA',
    ],
    directory
  );
  await runOpenSsl(
    [
      'x509',
      '-req',
      '-in',
      csrPath,
      '-CA',
      rootCertPath,
      '-CAkey',
      rootKeyPath,
      '-CAcreateserial',
      '-out',
      certificatePath,
      '-days',
      '90',
      '-sha256',
    ],
    directory
  );
  return {
    certificatePem: await readFile(certificatePath, 'utf8'),
    rootPem: await readFile(rootCertPath, 'utf8'),
  };
}

test('remote PKCS#10 CSR is accepted by an independent OpenSSL verifier', async (context) => {
  try {
    await runOpenSsl(['version']);
  } catch {
    context.skip('OpenSSL is not available in this environment');
    return;
  }
  const csr = await createRemotePkcs10Csr(keyProvider(), 'docubox-development-signing', {
    commonName: 'Docubox Development Signing',
    organization: 'Docubox',
    organizationalUnit: 'Development Cryptographic Services',
    country: 'MX',
  });
  const directory = await mkdtemp(join(tmpdir(), 'docubox-csr-test-'));
  const csrPath = join(directory, 'signing.csr.pem');
  await writeFile(csrPath, csr.pem, 'utf8');
  const { stdout } = await runOpenSsl(
    ['req', '-in', csrPath, '-noout', '-verify', '-subject'],
    directory
  );
  assert.match(stdout, /Docubox Development Signing/);
  assert.match(csr.pem, /BEGIN CERTIFICATE REQUEST/);
  assert.equal(csr.sha256.length, 64);
});

test('production certificate is self-signed by the HSM key and preserves SPKI binding', async () => {
  const provider = keyProvider('hsm');
  const generated = await createKmsSelfSignedProductionCertificate({
    keyProvider: provider,
    keyId: 'docubox-development-signing',
    subject: {
      commonName: 'DOCUBOX Document Signing',
      organization: 'DOCUBOX',
      organizationalUnit: 'Document Trust Services',
      country: 'MX',
    },
    validityDays: 30,
  });
  const certificateProvider = new ProductionCertificateProvider(provider, {
    environment: 'PRODUCTION',
    signingCertificatePem: generated.certificatePem,
    trustRootPem: generated.certificatePem,
    signingKeyId: 'docubox-development-signing',
    expiringSoonDays: 5,
  });
  const result = await certificateProvider.verifyCertificateChain();
  assert.equal(result.status, 'valid');
  assert.equal(result.keyMatches, true);
  assert.equal(result.chainValid, true);
  assert.equal(result.certificate?.environment, 'PRODUCTION');
});

test('production certificate generation rejects a Software key', async () => {
  await assert.rejects(
    createKmsSelfSignedProductionCertificate({
      keyProvider: keyProvider('software'),
      keyId: 'docubox-development-signing',
      subject: {
        commonName: 'DOCUBOX Document Signing',
        organization: 'DOCUBOX',
        organizationalUnit: 'Document Trust Services',
        country: 'MX',
      },
    }),
    { code: 'PRODUCTION_HSM_REQUIRED' }
  );
});

test('production provider rejects a development-named X.509 certificate', async (context) => {
  try {
    await runOpenSsl(['version']);
  } catch {
    context.skip('OpenSSL is not available in this environment');
    return;
  }
  const provider = keyProvider('hsm');
  const issued = await issueCertificate(provider);
  const certificateProvider = new ProductionCertificateProvider(provider, {
    environment: 'PRODUCTION',
    signingCertificatePem: issued.certificatePem,
    trustRootPem: issued.rootPem,
    signingKeyId: 'docubox-development-signing',
    expiringSoonDays: 30,
  });
  const result = await certificateProvider.verifyCertificateChain();
  assert.equal(result.status, 'environment_mismatch');
  assert.equal(result.trusted, false);
  assert.equal(result.detail, 'PRODUCTION_CERTIFICATE_DEVELOPMENT_NAMED');
});

test('development certificate provider verifies a trusted X.509 chain and KMS key binding', async (context) => {
  try {
    await runOpenSsl(['version']);
  } catch {
    context.skip('OpenSSL is not available in this environment');
    return;
  }
  const provider = keyProvider();
  const issued = await issueCertificate(provider);
  const certificateProvider = new DevelopmentCertificateProvider(provider, {
    environment: 'DEVELOPMENT',
    signingCertificatePem: issued.certificatePem,
    trustRootPem: issued.rootPem,
    signingKeyId: 'docubox-development-signing',
    expiringSoonDays: 30,
  });
  const result = await certificateProvider.verifyCertificateChain();
  assert.equal(result.status, 'valid');
  assert.equal(result.chainValid, true);
  assert.equal(result.keyMatches, true);
  assert.equal(result.certificate?.environment, 'DEVELOPMENT');
  const health = await certificateProvider.healthCheck();
  assert.equal(health.ready, true);
});

test('development certificate provider refuses a certificate bound to another managed key', async (context) => {
  try {
    await runOpenSsl(['version']);
  } catch {
    context.skip('OpenSSL is not available in this environment');
    return;
  }
  const certificateKeyProvider = keyProvider();
  const issued = await issueCertificate(certificateKeyProvider);
  const mismatchedProvider = keyProvider();
  const certificateProvider = new DevelopmentCertificateProvider(mismatchedProvider, {
    environment: 'DEVELOPMENT',
    signingCertificatePem: issued.certificatePem,
    trustRootPem: issued.rootPem,
    signingKeyId: 'docubox-development-signing',
    expiringSoonDays: 30,
  });
  const result = await certificateProvider.verifyCertificateChain();
  assert.equal(result.status, 'key_mismatch');
  assert.equal(result.keyMatches, false);
  assert.equal((await certificateProvider.healthCheck()).ready, false);
});

test('certificate lifecycle statuses reject expiry, future validity, chain, environment and key mismatch', () => {
  const now = Date.parse('2026-08-21T00:00:00.000Z');
  const base = {
    environmentMatches: true,
    keyMatches: true,
    chainValid: true,
    notBefore: '2026-08-01T00:00:00.000Z',
    notAfter: '2026-12-31T00:00:00.000Z',
    expiringSoonDays: 30,
    now,
  };
  assert.equal(evaluateCertificateStatus(base).status, 'valid');
  assert.equal(
    evaluateCertificateStatus({ ...base, notAfter: '2026-09-01T00:00:00.000Z' }).status,
    'expiring_soon'
  );
  assert.equal(
    evaluateCertificateStatus({ ...base, notAfter: '2026-08-20T00:00:00.000Z' }).status,
    'expired'
  );
  assert.equal(
    evaluateCertificateStatus({ ...base, notBefore: '2026-08-22T00:00:00.000Z' }).status,
    'not_yet_valid'
  );
  assert.equal(evaluateCertificateStatus({ ...base, chainValid: false }).status, 'invalid_chain');
  assert.equal(evaluateCertificateStatus({ ...base, keyMatches: false }).status, 'key_mismatch');
  assert.equal(
    evaluateCertificateStatus({ ...base, environmentMatches: false }).status,
    'environment_mismatch'
  );
});

test('WP-04 persists only public metadata and engine fails closed when certificate validation cannot pass', async () => {
  const [migration, certificates, providers, engine] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(certificatePath, 'utf8'),
    readFile(providerPath, 'utf8'),
    readFile(enginePath, 'utf8'),
  ]);
  assert.match(certificates, /interface CertificateProvider/);
  assert.match(certificates, /createRemotePkcs10Csr/);
  assert.match(certificates, /samePublicKey/);
  assert.match(providers, /DevelopmentCertificateProvider/);
  assert.match(engine, /CERTIFICATE_\$\{certificateVerification\.status\.toUpperCase\(\)\}/);
  assert.match(migration, /certificate_serial_number/);
  assert.match(migration, /certificate_chain_status/);
  assert.doesNotMatch(migration, /ADD COLUMN[^;]*(private_key|secret_id|client_token)/i);
});
