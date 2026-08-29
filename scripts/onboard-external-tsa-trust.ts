import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const OPENSSL =
  process.env.OPENSSL_BIN ||
  (process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl');
const OUTPUT_ROOT = join(process.cwd(), 'infra', 'tsa', 'trust-bundles');

const OFFICIAL = {
  freetsa: {
    endpoint: 'https://freetsa.org/tsr',
    certificateUrl: 'https://freetsa.org/files/tsa.crt',
    rootUrl: 'https://freetsa.org/files/cacert.pem',
    certificateFileSha256: '8bfb0305bb64e2571ca507552ef3245cb1c2fee8728e0ff8689225081ea13467',
    rootFileSha256: '2151b61137ffa86bf664691ba67e7da0b19f98c758e3d228d5d8ebf27e044438',
    certificateFingerprintSha256:
      '32e841a95cc1164101ffde41298ef2fc75c1c4372ef095e88a6bbd47dfb191fc',
    rootFingerprintSha256: 'a6379e7cecc05faa3cbf076013d745e327bbbaa38c0b9af22469d4701d18aabc',
  },
  openTsa: {
    endpoint: 'https://tsr.open-tsa.eu',
    rootUrl: 'https://open-tsa.eu/certs/ca.crt',
    chainUrl: 'https://open-tsa.eu/certs/fullchain.pem',
    rootFileSha256: '0edd16f56d0dcbdc18742dbaecadbe48a28973cb8b522290a26be40fd99bfff8',
    chainFileSha256: 'a7a3f5b520805bc243c6955ebd7ff5e1041f11d77c0fdf6ee213a22df27268e1',
    certificateFingerprintSha256:
      'cda5253f30385ce0f7067d2fb51a1726c3db5f73a02a0eede24ce868cd9497d4',
    rootFingerprintSha256: 'e45a75cb526087638107d4a3e9535b51145efddf88c5cabea9b09e0ab439af95',
  },
} as const;

function sha256(value: Uint8Array | string) {
  return createHash('sha256').update(value).digest('hex');
}

function runOpenSsl(args: string[], cwd: string) {
  const result = spawnSync(OPENSSL, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`OPENSSL_FAILED ${args.join(' ')}\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function download(url: string, expectedSha256: string) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`DOWNLOAD_FAILED ${url} HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256(bytes) !== expectedSha256) throw new Error(`OFFICIAL_ARTIFACT_HASH_MISMATCH ${url}`);
  return bytes;
}

function fingerprint(pem: string) {
  return new X509Certificate(pem).fingerprint256.replace(/:/g, '').toLowerCase();
}

function validity(pem: string) {
  const certificate = new X509Certificate(pem);
  return {
    validFrom: new Date(certificate.validFrom).toISOString(),
    validTo: new Date(certificate.validTo).toISOString(),
  };
}

async function writeBundle(
  provider: 'freetsa' | 'open-tsa',
  files: Record<string, Uint8Array | string>,
  manifest: Record<string, unknown>
) {
  const directory = join(OUTPUT_ROOT, provider, 'v1');
  await mkdir(directory, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(directory, name), content);
  }
  await writeFile(
    join(directory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
}

async function main() {
  const work = await mkdtemp(join(tmpdir(), 'docubox-external-tsa-onboarding-'));
  try {
    const [freeCertificate, freeRoot, openRoot, openChain] = await Promise.all([
      download(OFFICIAL.freetsa.certificateUrl, OFFICIAL.freetsa.certificateFileSha256),
      download(OFFICIAL.freetsa.rootUrl, OFFICIAL.freetsa.rootFileSha256),
      download(OFFICIAL.openTsa.rootUrl, OFFICIAL.openTsa.rootFileSha256),
      download(OFFICIAL.openTsa.chainUrl, OFFICIAL.openTsa.chainFileSha256),
    ]);
    const freeCertificatePem = Buffer.from(freeCertificate).toString('utf8');
    const freeRootPem = Buffer.from(freeRoot).toString('utf8');
    if (fingerprint(freeCertificatePem) !== OFFICIAL.freetsa.certificateFingerprintSha256)
      throw new Error('FREETSA_LEAF_FINGERPRINT_MISMATCH');
    if (fingerprint(freeRootPem) !== OFFICIAL.freetsa.rootFingerprintSha256)
      throw new Error('FREETSA_ROOT_FINGERPRINT_MISMATCH');

    const payloadPath = join(work, 'payload.bin');
    const requestPath = join(work, 'open-tsa.tsq');
    const responsePath = join(work, 'open-tsa.tsr');
    const tokenPath = join(work, 'open-tsa.p7s');
    const certificatesPath = join(work, 'open-tsa-certs.pem');
    const rootPath = join(work, 'open-ca.crt');
    const chainPath = join(work, 'open-fullchain.pem');
    await Promise.all([
      writeFile(payloadPath, randomBytes(32)),
      writeFile(rootPath, openRoot),
      writeFile(chainPath, openChain),
    ]);
    runOpenSsl(
      ['ts', '-query', '-data', payloadPath, '-sha256', '-cert', '-out', requestPath],
      work
    );
    const request = await readFile(requestPath);
    const response = await fetch(OFFICIAL.openTsa.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/timestamp-query',
        accept: 'application/timestamp-reply',
      },
      body: request,
    });
    if (!response.ok) throw new Error(`OPEN_TSA_ONBOARDING_HTTP_${response.status}`);
    await writeFile(responsePath, new Uint8Array(await response.arrayBuffer()));
    runOpenSsl(
      [
        'ts',
        '-verify',
        '-queryfile',
        requestPath,
        '-in',
        responsePath,
        '-CAfile',
        rootPath,
        '-untrusted',
        chainPath,
      ],
      work
    );
    runOpenSsl(['ts', '-reply', '-in', responsePath, '-token_out', '-out', tokenPath], work);
    runOpenSsl(
      ['pkcs7', '-inform', 'DER', '-in', tokenPath, '-print_certs', '-out', certificatesPath],
      work
    );
    const tokenCertificates = await readFile(certificatesPath, 'utf8');
    const leaf = tokenCertificates.match(
      /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/
    )?.[0];
    if (!leaf) throw new Error('OPEN_TSA_LEAF_MISSING_FROM_TOKEN');
    const leafPem = `${leaf}\n`;
    const openRootPem = Buffer.from(openRoot).toString('utf8');
    if (fingerprint(leafPem) !== OFFICIAL.openTsa.certificateFingerprintSha256)
      throw new Error('OPEN_TSA_LEAF_FINGERPRINT_MISMATCH');
    if (fingerprint(openRootPem) !== OFFICIAL.openTsa.rootFingerprintSha256)
      throw new Error('OPEN_TSA_ROOT_FINGERPRINT_MISMATCH');

    const installedAt = new Date().toISOString();
    const freeLeafValidity = validity(freeCertificatePem);
    const freeRootValidity = validity(freeRootPem);
    const openLeafValidity = validity(leafPem);
    const openRootValidity = validity(openRootPem);
    await writeBundle(
      'freetsa',
      {
        'tsa.crt': freeCertificate,
        'chain.pem': freeRoot,
        'ca.pem': freeRoot,
      },
      {
        id: 'freetsa-v1',
        provider: 'freetsa',
        version: 1,
        status: 'active',
        role: 'PRIMARY',
        priority: 1,
        endpoint: OFFICIAL.freetsa.endpoint,
        installedAt,
        supersededAt: null,
        policyOid: null,
        tsaCertificateValidFrom: freeLeafValidity.validFrom,
        tsaCertificateValidTo: freeLeafValidity.validTo,
        trustRootValidFrom: freeRootValidity.validFrom,
        trustRootValidTo: freeRootValidity.validTo,
        tsaCertificate: { path: 'tsa.crt', sha256: sha256(freeCertificate) },
        certificateChain: { path: 'chain.pem', sha256: sha256(freeRoot) },
        trustRoot: { path: 'ca.pem', sha256: sha256(freeRoot) },
        tsaCertificateFingerprintSha256: OFFICIAL.freetsa.certificateFingerprintSha256,
        trustRootFingerprintSha256: OFFICIAL.freetsa.rootFingerprintSha256,
      }
    );
    await writeBundle(
      'open-tsa',
      {
        'tsa.crt': leafPem,
        'chain.pem': openChain,
        'ca.crt': openRoot,
      },
      {
        id: 'open-tsa-v1',
        provider: 'open-tsa',
        version: 1,
        status: 'active',
        role: 'FALLBACK',
        priority: 2,
        endpoint: OFFICIAL.openTsa.endpoint,
        installedAt,
        supersededAt: null,
        policyOid: null,
        tsaCertificateValidFrom: openLeafValidity.validFrom,
        tsaCertificateValidTo: openLeafValidity.validTo,
        trustRootValidFrom: openRootValidity.validFrom,
        trustRootValidTo: openRootValidity.validTo,
        tsaCertificate: { path: 'tsa.crt', sha256: sha256(leafPem) },
        certificateChain: { path: 'chain.pem', sha256: sha256(openChain) },
        trustRoot: { path: 'ca.crt', sha256: sha256(openRoot) },
        tsaCertificateFingerprintSha256: OFFICIAL.openTsa.certificateFingerprintSha256,
        trustRootFingerprintSha256: OFFICIAL.openTsa.rootFingerprintSha256,
      }
    );
    console.info('FreeTSA official trust artifacts: VERIFIED');
    console.info('Open TSA official trust artifacts and token leaf: VERIFIED');
    console.info(`Trust bundles written under ${OUTPUT_ROOT}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
