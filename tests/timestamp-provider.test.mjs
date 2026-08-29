import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const openssl =
  process.env.OPENSSL_BIN ||
  (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
const serverPath = new URL('../infra/tsa/server.mjs', import.meta.url);
const timestampSource = new URL('../src/lib/certification/timestamp.ts', import.meta.url);
const migration = new URL(
  '../supabase/migrations/20260821204141_wp_crypto_06_rfc3161_tsa.sql',
  import.meta.url
);
const docsPath = new URL('../docs/crypto/tsa-rfc3161-implementation.md', import.meta.url);
const padesPath = new URL('../src/lib/certification/pades.ts', import.meta.url);
const enginePath = new URL('../src/lib/certification/engine.ts', import.meta.url);
const bundleDir = await mkdtemp(join(tmpdir(), 'docubox-rfc3161-bundle-'));
const bundlePath = join(bundleDir, 'timestamp.cjs');
await build({
  entryPoints: [join(process.cwd(), 'src', 'lib', 'certification', 'timestamp.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundlePath,
  logLevel: 'silent',
});
const { LocalRfc3161Provider } = createRequire(import.meta.url)(bundlePath);

function digest(value) {
  return createHash('sha256').update(value).digest();
}

async function opensslRun(args, cwd) {
  return execFileAsync(openssl, args, { cwd, windowsHide: true });
}

async function createTsaDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'docubox-rfc3161-'));
  const data = join(directory, 'data');
  await (await import('node:fs/promises')).mkdir(data);
  const rootKey = join(data, 'root.key.pem');
  const rootCert = join(data, 'root.crt.pem');
  const tsaKey = join(data, 'tsa.key.pem');
  const tsaCsr = join(data, 'tsa.csr.pem');
  const tsaCert = join(data, 'tsa.crt.pem');
  const ext = join(directory, 'tsa.ext');
  await writeFile(
    ext,
    '[tsa_certificate]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,nonRepudiation\nextendedKeyUsage=critical,timeStamping\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n'
  );
  await opensslRun(
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-days',
      '365',
      '-keyout',
      rootKey,
      '-out',
      rootCert,
      '-subj',
      '/C=MX/O=Docubox/OU=Tests/CN=Docubox Test TSA Root',
    ],
    directory
  );
  await opensslRun(
    [
      'req',
      '-new',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-keyout',
      tsaKey,
      '-out',
      tsaCsr,
      '-subj',
      '/C=MX/O=Docubox/OU=Tests/CN=Docubox Test TSA',
    ],
    directory
  );
  await opensslRun(
    [
      'x509',
      '-req',
      '-sha256',
      '-days',
      '90',
      '-in',
      tsaCsr,
      '-CA',
      rootCert,
      '-CAkey',
      rootKey,
      '-CAcreateserial',
      '-out',
      tsaCert,
      '-extfile',
      ext,
      '-extensions',
      'tsa_certificate',
    ],
    directory
  );
  await writeFile(join(data, 'tsa-chain.pem'), await readFile(rootCert));
  await writeFile(join(data, 'tsaserial'), '01\n');
  const config = join(directory, 'openssl-tsa.cnf');
  await writeFile(
    config,
    `[tsa]\ndefault_tsa=tsa_config1\n[tsa_config1]\ndir=./data\nserial=$dir/tsaserial\ncrypto_device=builtin\nsigner_cert=$dir/tsa.crt.pem\ncerts=$dir/tsa-chain.pem\nsigner_key=$dir/tsa.key.pem\nsigner_digest=sha256\ndefault_policy=1.3.6.1.4.1.55555.1.1\ndigests=sha256\naccuracy=secs:1\nordering=yes\ntsa_name=yes\ness_cert_id_chain=yes\ness_cert_id_alg=sha256\n`
  );
  return { directory, config, rootCert, tsaCert };
}

async function startTsa(pki) {
  const port = 18000 + Math.floor(Math.random() * 1000);
  const token = 'test-tsa-internal-token';
  const child = spawn(process.execPath, [fileURLToPath(serverPath)], {
    cwd: pki.directory,
    env: {
      ...process.env,
      TSA_PORT: String(port),
      TSA_INTERNAL_TOKEN: token,
      TSA_CONFIG_PATH: pki.config,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('TSA test server did not start')), 5_000);
    child.stdout.on('data', (data) => {
      if (String(data).includes('listening')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`TSA test server exited with ${code}`)));
  });
  return {
    url: `http://127.0.0.1:${port}/internal/tsa`,
    token,
    stop: async () => {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    },
  };
}

async function startProtocolServer(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/tsa`,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('Local RFC 3161 TSA emits and verifies a real TimeStampToken', async (context) => {
  try {
    await opensslRun(['version']);
  } catch {
    context.skip('OpenSSL is not available in this environment');
    return;
  }
  const pki = await createTsaDirectory();
  const service = await startTsa(pki);
  try {
    const source = Buffer.from('Docubox RFC 3161 test input');
    const provider = new LocalRfc3161Provider({
      url: service.url,
      internalToken: service.token,
      timeoutMs: 8_000,
      policyOid: '1.3.6.1.4.1.55555.1.1',
      tsaCertificatePem: await readFile(pki.tsaCert, 'utf8'),
      trustRootPem: await readFile(pki.rootCert, 'utf8'),
    });
    assert.equal((await provider.healthCheck()).ready, true);
    const result = await provider.timestampDigest({
      digest: digest(source),
      messageImprintData: source,
    });
    assert.equal(result.verification.valid, true);
    assert.equal(result.messageImprintSha256, digest(source).toString('hex'));
    assert.match(result.serialNumber, /^[0-9A-F]+$/);
    assert.match(result.genTime, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(
      (
        await provider.verifyTimestamp(result.token, {
          expectedDigest: digest(source),
          messageImprintData: source,
        })
      ).valid,
      true
    );
    assert.equal(
      (
        await provider.verifyTimestamp(result.token, {
          expectedDigest: digest(Buffer.from('altered')),
          messageImprintData: Buffer.from('altered'),
        })
      ).valid,
      false
    );
    assert.equal(
      (
        await provider.verifyTimestamp(result.token, {
          expectedDigest: digest(source),
          messageImprintData: source,
          expectedNonce: '01',
        })
      ).valid,
      false
    );
    assert.equal(
      (
        await provider.verifyTimestamp(result.token, {
          expectedDigest: digest(source),
          messageImprintData: source,
          expectedPolicyOid: '1.3.6.1.4.1.55555.1.2',
        })
      ).valid,
      false
    );
    const altered = new Uint8Array(result.token);
    altered[altered.length - 8] ^= 1;
    assert.equal(
      (
        await provider.verifyTimestamp(altered, {
          expectedDigest: digest(source),
          messageImprintData: source,
        })
      ).valid,
      false
    );

    const tokenPath = join(pki.directory, 'timestamp.tst');
    const sourcePath = join(pki.directory, 'source.bin');
    await writeFile(tokenPath, result.token);
    await writeFile(sourcePath, source);
    await opensslRun(
      [
        'ts',
        '-verify',
        '-token_in',
        '-in',
        tokenPath,
        '-data',
        sourcePath,
        '-CAfile',
        pki.rootCert,
      ],
      pki.directory
    );
  } finally {
    await service.stop();
    await rm(pki.directory, { recursive: true, force: true });
  }
});

test('Local RFC 3161 TSA fails closed when the authority is unavailable', async () => {
  const provider = new LocalRfc3161Provider({
    url: 'http://127.0.0.1:1/internal/tsa',
    timeoutMs: 100,
    policyOid: '1.3.6.1.4.1.55555.1.1',
    tsaCertificatePem: 'not-used-before-network-request',
    trustRootPem: 'not-used-before-network-request',
  });
  await assert.rejects(
    () =>
      provider.timestampDigest({
        digest: digest(Buffer.from('unavailable')),
        messageImprintData: Buffer.from('unavailable'),
      }),
    (error) => error?.code === 'TSA_HTTP_ERROR'
  );
  assert.equal((await provider.healthCheck()).ready, false);
});

test('Local RFC 3161 TSA rejects HTTP, MIME, corrupt DER and timeout failures explicitly', async () => {
  const source = Buffer.from('Docubox TSA protocol failures');
  const base = {
    timeoutMs: 100,
    policyOid: '1.3.6.1.4.1.55555.1.1',
    tsaCertificatePem: 'network-check-precedes-certificate-validation',
    trustRootPem: 'network-check-precedes-certificate-validation',
  };
  const cases = [
    {
      expected: 'TSA_TEMPORARY_UNAVAILABLE',
      handler: (_request, response) =>
        response.writeHead(503, { 'content-type': 'application/json' }).end('{}'),
    },
    {
      expected: 'TSA_PROTOCOL_ERROR',
      handler: (_request, response) =>
        response.writeHead(200, { 'content-type': 'text/plain' }).end('not-a-timestamp'),
    },
    {
      expected: 'RFC3161_RESPONSE_PARSE_FAILED',
      handler: (_request, response) =>
        response
          .writeHead(200, { 'content-type': 'application/timestamp-reply' })
          .end('invalid-der'),
    },
    {
      expected: 'TSA_HTTP_ERROR',
      handler: () => undefined,
    },
  ];
  for (const entry of cases) {
    const server = await startProtocolServer(entry.handler);
    try {
      const provider = new LocalRfc3161Provider({ ...base, url: server.url });
      await assert.rejects(
        () => provider.timestampDigest({ digest: digest(source), messageImprintData: source }),
        (error) => error?.code === entry.expected
      );
    } finally {
      await server.stop();
    }
  }
});

test('Local RFC 3161 TSA rejects a token whose signer is not anchored in the configured trust root', async (context) => {
  try {
    await opensslRun(['version']);
  } catch {
    context.skip('OpenSSL is not available in this environment');
    return;
  }
  const issuingPki = await createTsaDirectory();
  const unrelatedPki = await createTsaDirectory();
  const service = await startTsa(issuingPki);
  try {
    const source = Buffer.from('Docubox wrong TSA trust root');
    const provider = new LocalRfc3161Provider({
      url: service.url,
      internalToken: service.token,
      timeoutMs: 8_000,
      policyOid: '1.3.6.1.4.1.55555.1.1',
      tsaCertificatePem: await readFile(issuingPki.tsaCert, 'utf8'),
      trustRootPem: await readFile(unrelatedPki.rootCert, 'utf8'),
    });
    assert.equal((await provider.healthCheck()).ready, false);
    await assert.rejects(
      () => provider.timestampDigest({ digest: digest(source), messageImprintData: source }),
      (error) => error?.code === 'TSA_CERTIFICATE_INVALID' || error?.code === 'TSA_CHAIN_INVALID'
    );
  } finally {
    await service.stop();
    await rm(issuingPki.directory, { recursive: true, force: true });
    await rm(unrelatedPki.directory, { recursive: true, force: true });
  }
});

test('WP-06 persists RFC 3161 evidence and keeps NOM-151 separate', async () => {
  const [source, sql, docs, pades, engine] = await Promise.all([
    readFile(timestampSource, 'utf8'),
    readFile(migration, 'utf8'),
    readFile(docsPath, 'utf8'),
    readFile(padesPath, 'utf8'),
    readFile(enginePath, 'utf8'),
  ]);
  assert.match(source, /interface TimestampAuthorityProvider/);
  assert.match(source, /TimeStampReq/);
  assert.match(source, /TimeStampResp/);
  assert.match(source, /verifyTimestamp/);
  assert.match(sql, /timestamp_record_id/);
  assert.match(docs, /NOM-151 remains separate/i);
  assert.match(pades, /RFC3161_SIGNATURE_TIMESTAMP_OID/);
  assert.match(pades, /PAdES-B-T/);
  assert.match(engine, /requestedPadesProfile/);
});
