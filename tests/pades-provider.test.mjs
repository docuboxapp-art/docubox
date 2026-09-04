import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { constants, createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { PDFDocument } from 'pdf-lib';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const openssl = process.env.OPENSSL_BIN || (process.platform === 'win32'
  ? 'C:/Program Files/Git/usr/bin/openssl.exe'
  : 'openssl');
const migrationPath = new URL('../supabase/migrations/20260821200622_wp_crypto_05_pades_engine.sql', import.meta.url);
const padesPath = new URL('../src/lib/certification/pades.ts', import.meta.url);
const providersPath = new URL('../src/lib/certification/providers.ts', import.meta.url);
const enginePath = new URL('../src/lib/certification/engine.ts', import.meta.url);
const adaptersPath = new URL('../src/lib/certification/adapters.ts', import.meta.url);
const timestampSourcePath = new URL('../src/lib/certification/timestamp.ts', import.meta.url);
const tsaServerPath = new URL('../infra/tsa/server.mjs', import.meta.url);
const bundleDir = await mkdtemp(join(tmpdir(), 'docubox-pades-provider-'));
const padesBundlePath = join(bundleDir, 'pades.cjs');
const certificatesBundlePath = join(bundleDir, 'certificates.cjs');
const timestampBundlePath = join(bundleDir, 'timestamp.cjs');
await Promise.all([
  build({ entryPoints: [join(process.cwd(), 'src', 'lib', 'certification', 'pades.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: padesBundlePath, logLevel: 'silent' }),
  build({ entryPoints: [join(process.cwd(), 'src', 'lib', 'certification', 'certificates.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: certificatesBundlePath, logLevel: 'silent' }),
  build({ entryPoints: [fileURLToPath(timestampSourcePath)], bundle: true, platform: 'node', format: 'cjs', outfile: timestampBundlePath, logLevel: 'silent' }),
]);
const { PadesBbPdfSignatureProvider } = createRequire(import.meta.url)(padesBundlePath);
const { createRemotePkcs10Csr } = createRequire(import.meta.url)(certificatesBundlePath);
const { LocalRfc3161Provider } = createRequire(import.meta.url)(timestampBundlePath);

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function managedKeyProvider() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const provider = {
    publicKeyPem,
    signCallCount: 0,
    async getPublicKey() { return publicKeyPem; },
    async getKeyMetadata() {
      return { provider: 'test', keyId: 'docubox-development-signing', keyVersion: '1', algorithm: 'RSA-PSS-SHA256', keySizeBits: 2048, protectionLevel: 'software', createdAt: '2026-08-21T00:00:00.000Z', status: 'active', publicKeyPem };
    },
    async healthCheck() { return { ready: true, missing: [], provider: 'test', keyId: 'docubox-development-signing', keyVersion: '1' }; },
    async signDigest(input) {
      provider.signCallCount += 1;
      assert.equal(input.digestSha256, sha256Hex(input.canonicalBytes));
      provider.lastSignedBytes = Buffer.from(input.canonicalBytes);
      const signature = sign('sha256', input.canonicalBytes, { key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 });
      provider.lastSignature = signature;
      return {
        status: 'VALID', signatureBase64: signature.toString('base64'), signatureSha256: sha256Hex(signature), algorithm: 'RSA-PSS-SHA256', keySizeBits: 2048,
        keyId: 'docubox-development-signing', keyVersion: '1', publicKeyPem, publicKeyFingerprintSha256: sha256Hex(publicKeyPem), certificatePem: null, certificateFingerprintSha256: null,
        signedAt: '2026-08-21T00:00:00.000Z',
      };
    },
  };
  provider.verifyLastSignature = () => verify('sha256', provider.lastSignedBytes, { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, provider.lastSignature);
  return provider;
}

async function runOpenSsl(args, cwd) {
  return execFileAsync(openssl, args, { cwd, windowsHide: true });
}

async function certificateFor(provider) {
  const directory = await mkdtemp(join(tmpdir(), 'docubox-pades-pki-'));
  const csr = await createRemotePkcs10Csr(provider, 'docubox-development-signing', {
    commonName: 'Docubox Development Signing', organization: 'Docubox', organizationalUnit: 'Development Cryptographic Services', country: 'MX',
  });
  const csrPath = join(directory, 'signing.csr.pem');
  const rootKeyPath = join(directory, 'root.key.pem');
  const rootCertPath = join(directory, 'root.crt.pem');
  const certificatePath = join(directory, 'signing.crt.pem');
  await writeFile(csrPath, csr.pem, 'utf8');
  await runOpenSsl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-keyout', rootKeyPath, '-out', rootCertPath, '-days', '365', '-subj', '/C=MX/O=Docubox/OU=Development/CN=Docubox Development Root CA'], directory);
  await runOpenSsl(['x509', '-req', '-in', csrPath, '-CA', rootCertPath, '-CAkey', rootKeyPath, '-CAcreateserial', '-out', certificatePath, '-days', '90', '-sha256'], directory);
  const pem = await readFile(certificatePath, 'utf8');
  const { X509Certificate } = await import('node:crypto');
  const x509 = new X509Certificate(pem);
  return {
    certificate: {
      pem,
      serialNumber: x509.serialNumber,
      subject: x509.subject,
      issuer: x509.issuer,
      notBefore: new Date(x509.validFrom).toISOString(),
      notAfter: new Date(x509.validTo).toISOString(),
      fingerprintSha256: x509.fingerprint256.replace(/:/g, '').toLowerCase(),
      signatureAlgorithm: 'not_available', publicKeyAlgorithm: 'rsa', keyUsage: [], extendedKeyUsage: [], environment: 'DEVELOPMENT',
    },
    directory,
  };
}

async function sourcePdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]).drawText('Documento de prueba PAdES-B-B', { x: 72, y: 720, size: 16 });
  return pdf.save({ useObjectStreams: false });
}

async function createTsaDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'docubox-pades-tsa-'));
  const data = join(directory, 'data');
  await mkdir(data);
  const rootKey = join(data, 'root.key.pem');
  const rootCert = join(data, 'root.crt.pem');
  const tsaKey = join(data, 'tsa.key.pem');
  const tsaCsr = join(data, 'tsa.csr.pem');
  const tsaCert = join(data, 'tsa.crt.pem');
  const extensions = join(directory, 'tsa.ext');
  await writeFile(extensions, '[tsa_certificate]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,nonRepudiation\nextendedKeyUsage=critical,timeStamping\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n');
  await runOpenSsl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '365', '-keyout', rootKey, '-out', rootCert, '-subj', '/C=MX/O=Docubox/OU=Tests/CN=Docubox PAdES TSA Root'], directory);
  await runOpenSsl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-keyout', tsaKey, '-out', tsaCsr, '-subj', '/C=MX/O=Docubox/OU=Tests/CN=Docubox PAdES TSA'], directory);
  await runOpenSsl(['x509', '-req', '-sha256', '-days', '90', '-in', tsaCsr, '-CA', rootCert, '-CAkey', rootKey, '-CAcreateserial', '-out', tsaCert, '-extfile', extensions, '-extensions', 'tsa_certificate'], directory);
  await writeFile(join(data, 'tsa-chain.pem'), await readFile(rootCert));
  await writeFile(join(data, 'tsaserial'), '01\n');
  const config = join(directory, 'openssl-tsa.cnf');
  await writeFile(config, `[tsa]\ndefault_tsa=tsa_config1\n[tsa_config1]\ndir=./data\nserial=$dir/tsaserial\ncrypto_device=builtin\nsigner_cert=$dir/tsa.crt.pem\ncerts=$dir/tsa-chain.pem\nsigner_key=$dir/tsa.key.pem\nsigner_digest=sha256\ndefault_policy=1.3.6.1.4.1.55555.1.1\ndigests=sha256\naccuracy=secs:1\nordering=yes\ntsa_name=yes\ness_cert_id_chain=yes\ness_cert_id_alg=sha256\n`);
  return { directory, config, rootCert, tsaCert };
}

async function startTsa(pki) {
  const port = 19000 + Math.floor(Math.random() * 900);
  const token = 'pades-tsa-internal-token';
  const child = spawn(process.execPath, [fileURLToPath(tsaServerPath)], {
    cwd: pki.directory,
    env: { ...process.env, TSA_PORT: String(port), TSA_INTERNAL_TOKEN: token, TSA_CONFIG_PATH: pki.config },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('PAdES TSA test server did not start')), 5_000);
    child.stdout.on('data', (data) => {
      if (String(data).includes('listening')) { clearTimeout(timeout); resolve(); }
    });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`PAdES TSA test server exited with ${code}`)));
  });
  return {
    url: `http://127.0.0.1:${port}/internal/tsa`, token,
    stop: async () => { child.kill('SIGTERM'); await new Promise((resolve) => child.once('exit', resolve)); },
  };
}

test('PAdES-B-B signs a detached CMS with the managed key and verifies ByteRange, CMS and certificate', async (context) => {
  try { await runOpenSsl(['version']); } catch { context.skip('OpenSSL is not available in this environment'); return; }
  const keyProvider = managedKeyProvider();
  const issued = await certificateFor(keyProvider);
  const certificateProvider = {
    async verifyCertificateChain() { return { status: 'valid', trusted: true, keyMatches: true, chainValid: true, expiresInDays: 90, certificate: issued.certificate, detail: null }; },
    async healthCheck() { return { ready: true, missing: [], provider: 'test-certificate' }; },
  };
  const provider = new PadesBbPdfSignatureProvider(keyProvider, certificateProvider);
  const prepared = await provider.preparePdf({ pdfBytes: await sourcePdf(), signerName: 'Docubox' });
  assert.equal(prepared.byteRange[0], 0);
  assert.equal(prepared.documentDigestSha256.length, 64);
  const signed = await provider.embedSignature({ prepared, profile: 'PAdES-B-B', tenantId: 'tenant-a', idempotencyKey: 'idempotency-a' });
  assert.equal(keyProvider.verifyLastSignature(), true);
  assert.equal(signed.profile, 'PAdES-B-B');
  assert.equal(signed.signatureAlgorithm, 'RSA-PSS-SHA256');
  assert.equal(signed.cmsHashSha256.length, 64);
  assert.equal(signed.pdfHashAfterSignature, sha256Hex(signed.pdfBytes));
  const signedPdfText = Buffer.from(signed.pdfBytes).toString('latin1');
  const signatureDictionary = /\/Type\s*\/Sig[\s\S]*?\/Contents\s*</.exec(signedPdfText)?.[0];
  assert.ok(signatureDictionary, 'the PDF must contain a signature dictionary');
  assert.match(signatureDictionary, /\/Filter\s*\/Adobe\.PPKLite/);
  assert.match(signatureDictionary, /\/SubFilter\s*\/ETSI\.CAdES\.detached/);
  const byteRange = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(
    signatureDictionary,
  );
  assert.ok(byteRange, 'ByteRange must contain four direct number objects');
  assert.deepEqual(byteRange.slice(1).map(Number), signed.byteRange);
  assert.doesNotMatch(signatureDictionary, /\/ByteRange\s*\[[^\]]*\s\/[0-9]+/);
  const verification = await provider.verifyPdf({ pdfBytes: signed.pdfBytes, expectedCertificateFingerprintSha256: issued.certificate.fingerprintSha256 });
  assert.equal(verification.valid, true);
  assert.equal(verification.byteRangeValid, true);
  assert.equal(verification.cmsValid, true);
  assert.equal(verification.certificateValid, true);

  const cmsPath = join(issued.directory, 'signature.cms');
  const contentPath = join(issued.directory, 'signed-content.bin');
  const outputPath = join(issued.directory, 'verified-content.bin');
  await writeFile(cmsPath, signed.cmsBytes);
  const externalContent = Buffer.concat([
    Buffer.from(signed.pdfBytes).subarray(0, signed.byteRange[1]),
    Buffer.from(signed.pdfBytes).subarray(signed.byteRange[2], signed.byteRange[2] + signed.byteRange[3]),
  ]);
  assert.deepEqual(externalContent, Buffer.from(prepared.signedBytes));
  assert.notDeepEqual(
    keyProvider.lastSignedBytes,
    externalContent,
    'the managed key must sign the DER-encoded CAdES signedAttrs',
  );
  await writeFile(contentPath, externalContent);
  await runOpenSsl(['cms', '-verify', '-binary', '-inform', 'DER', '-in', cmsPath, '-content', contentPath, '-noverify', '-out', outputPath], issued.directory);
  const printedCms = await runOpenSsl(
    ['cms', '-cmsout', '-print', '-inform', 'DER', '-in', cmsPath],
    issued.directory,
  );
  assert.match(printedCms.stdout, /contentType \(1\.2\.840\.113549\.1\.9\.3\)/);
  assert.match(printedCms.stdout, /messageDigest \(1\.2\.840\.113549\.1\.9\.4\)/);
  assert.match(printedCms.stdout, /signingTime \(1\.2\.840\.113549\.1\.9\.5\)/);
  assert.match(
    printedCms.stdout,
    /id-smime-aa-signingCertificateV2 \(1\.2\.840\.113549\.1\.9\.16\.2\.47\)/,
  );
});

test('PAdES verification rejects a post-signature byte mutation and a malformed PDF', async (context) => {
  try { await runOpenSsl(['version']); } catch { context.skip('OpenSSL is not available in this environment'); return; }
  const keyProvider = managedKeyProvider();
  const issued = await certificateFor(keyProvider);
  const certificateProvider = {
    async verifyCertificateChain() { return { status: 'valid', trusted: true, keyMatches: true, chainValid: true, expiresInDays: 90, certificate: issued.certificate, detail: null }; },
    async healthCheck() { return { ready: true, missing: [], provider: 'test-certificate' }; },
  };
  const provider = new PadesBbPdfSignatureProvider(keyProvider, certificateProvider);
  const signed = await provider.embedSignature({ prepared: await provider.preparePdf({ pdfBytes: await sourcePdf() }), profile: 'PAdES-B-B' });
  const altered = new Uint8Array(signed.pdfBytes);
  altered[20] ^= 1;
  assert.equal((await provider.verifyPdf({ pdfBytes: altered })).valid, false);
  assert.equal((await provider.verifyPdf({ pdfBytes: Buffer.from('%PDF-not-a-valid-signed-document') })).valid, false);

  const slashPrefixedByteRange = Buffer.from(signed.pdfBytes);
  const signedText = slashPrefixedByteRange.toString('latin1');
  const byteRange = /\/ByteRange\s*\[\s*0\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(signedText);
  assert.ok(byteRange);
  const secondTokenOffset = signedText.indexOf(byteRange[1], byteRange.index);
  assert.equal(slashPrefixedByteRange[secondTokenOffset - 1], 0x20);
  slashPrefixedByteRange[secondTokenOffset - 1] = 0x2f;
  const malformedByteRange = await provider.verifyPdf({ pdfBytes: slashPrefixedByteRange });
  assert.equal(malformedByteRange.valid, false);
  assert.equal(malformedByteRange.detail, 'PADES_BYTERANGE_INVALID');
});

test('PAdES-B-T embeds and verifies a real RFC 3161 signature timestamp', async (context) => {
  try { await runOpenSsl(['version']); } catch { context.skip('OpenSSL is not available in this environment'); return; }
  const tsaPki = await createTsaDirectory();
  const service = await startTsa(tsaPki);
  const keyProvider = managedKeyProvider();
  const documentCertificate = await certificateFor(keyProvider);
  const certificateProvider = {
    async verifyCertificateChain() { return { status: 'valid', trusted: true, keyMatches: true, chainValid: true, expiresInDays: 90, certificate: documentCertificate.certificate, detail: null }; },
    async healthCheck() { return { ready: true, missing: [], provider: 'test-certificate' }; },
  };
  const timestampAuthority = new LocalRfc3161Provider({
    url: service.url, internalToken: service.token, timeoutMs: 8_000, policyOid: '1.3.6.1.4.1.55555.1.1',
    tsaCertificatePem: await readFile(tsaPki.tsaCert, 'utf8'), trustRootPem: await readFile(tsaPki.rootCert, 'utf8'),
  });
  try {
    const provider = new PadesBbPdfSignatureProvider(keyProvider, certificateProvider, timestampAuthority);
    const signed = await provider.embedSignature({ prepared: await provider.preparePdf({ pdfBytes: await sourcePdf() }), profile: 'PAdES-B-T' });
    assert.equal(signed.profile, 'PAdES-B-T');
    assert.ok(signed.timestamp);
    assert.equal(signed.timestamp.verification.valid, true);
    const verification = await provider.verifyPdf({ pdfBytes: signed.pdfBytes, expectedCertificateFingerprintSha256: documentCertificate.certificate.fingerprintSha256 });
    assert.equal(verification.valid, true);
    assert.equal(verification.profile, 'PAdES-B-T');
    assert.equal(verification.timestamp?.valid, true);
  } finally {
    await service.stop();
    await rm(tsaPki.directory, { recursive: true, force: true });
    await rm(documentCertificate.directory, { recursive: true, force: true });
  }
});

test('PAdES-B-T upgrades an already verified B-B without signing the document again', async (context) => {
  try { await runOpenSsl(['version']); } catch { context.skip('OpenSSL is not available in this environment'); return; }
  const tsaPki = await createTsaDirectory();
  const service = await startTsa(tsaPki);
  const keyProvider = managedKeyProvider();
  const documentCertificate = await certificateFor(keyProvider);
  const certificateProvider = {
    async verifyCertificateChain() { return { status: 'valid', trusted: true, keyMatches: true, chainValid: true, expiresInDays: 90, certificate: documentCertificate.certificate, detail: null }; },
    async healthCheck() { return { ready: true, missing: [], provider: 'test-certificate' }; },
  };
  const timestampAuthority = new LocalRfc3161Provider({
    url: service.url, internalToken: service.token, timeoutMs: 8_000, policyOid: '1.3.6.1.4.1.55555.1.1',
    tsaCertificatePem: await readFile(tsaPki.tsaCert, 'utf8'), trustRootPem: await readFile(tsaPki.rootCert, 'utf8'),
  });
  try {
    const bbProvider = new PadesBbPdfSignatureProvider(keyProvider, certificateProvider);
    const bb = await bbProvider.embedSignature({
      prepared: await bbProvider.preparePdf({ pdfBytes: await sourcePdf() }),
      profile: 'PAdES-B-B',
    });
    const callsAfterBb = keyProvider.signCallCount;
    const btProvider = new PadesBbPdfSignatureProvider(keyProvider, certificateProvider, timestampAuthority);
    const upgraded = await btProvider.upgradeToPadesBt({
      pdfBytes: bb.pdfBytes,
      expectedCertificateFingerprintSha256: documentCertificate.certificate.fingerprintSha256,
    });
    assert.equal(keyProvider.signCallCount, callsAfterBb, 'KMS must not sign the document again');
    assert.deepEqual(upgraded.byteRange, bb.byteRange, 'the signed ByteRange must stay unchanged');
    assert.equal(upgraded.profile, 'PAdES-B-T');
    assert.equal(upgraded.timestamp.verification.valid, true);
    const verification = await btProvider.verifyPdf({
      pdfBytes: upgraded.pdfBytes,
      expectedCertificateFingerprintSha256: documentCertificate.certificate.fingerprintSha256,
    });
    assert.equal(verification.valid, true);
    assert.equal(verification.profile, 'PAdES-B-T');
    assert.equal(verification.timestamp?.valid, true);
  } finally {
    await service.stop();
    await rm(tsaPki.directory, { recursive: true, force: true });
    await rm(documentCertificate.directory, { recursive: true, force: true });
  }
});

test('PAdES-B-B fails closed when the managed signing certificate is not valid', async () => {
  const keyProvider = managedKeyProvider();
  const provider = new PadesBbPdfSignatureProvider(keyProvider, {
    async verifyCertificateChain() {
      return { status: 'key_mismatch', trusted: false, keyMatches: false, chainValid: false, expiresInDays: null, certificate: null, detail: 'certificate key mismatch' };
    },
    async healthCheck() { return { ready: false, missing: ['certificate key mismatch'], provider: 'test-certificate' }; },
  });
  const prepared = await provider.preparePdf({ pdfBytes: await sourcePdf() });
  await assert.rejects(
    () => provider.embedSignature({ prepared, profile: 'PAdES-B-B' }),
    (error) => error?.code === 'PADES_CERTIFICATE_INVALID',
  );
});

test('WP-05 uses the provider boundary, stores technical evidence and does not trust the legacy gateway', async () => {
  const [migration, pades, providers, engine, adapters] = await Promise.all([
    readFile(migrationPath, 'utf8'), readFile(padesPath, 'utf8'), readFile(providersPath, 'utf8'), readFile(enginePath, 'utf8'), readFile(adaptersPath, 'utf8'),
  ]);
  assert.match(pades, /interface PdfSignatureProvider/);
  assert.match(pades, /ByteRange/);
  assert.match(pades, /SignedData/);
  assert.match(pades, /verifyPdf/);
  assert.match(providers, /PadesBbPdfSignatureProvider/);
  assert.match(engine, /providers\.pdfSignature\.preparePdf/);
  assert.match(engine, /providers\.pdfSignature\.embedSignature/);
  assert.match(engine, /providers\.pdfSignature\.verifyPdf/);
  assert.doesNotMatch(engine, /providers\.pdfSignature\.signPdf/);
  assert.match(engine, /timestamp_token_sha256: null/);
  assert.match(migration, /document_pdf_signatures/);
  assert.match(migration, /pades_byte_range/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.document_pdf_signatures FROM anon, authenticated/);
  assert.match(adapters, /signPdfWithPades/);
});
