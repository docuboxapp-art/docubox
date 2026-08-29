import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { build } from 'esbuild';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const execFileAsync = promisify(execFile);
const openssl =
  process.env.OPENSSL_BIN ||
  (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
const tsaServerPath = new URL('../infra/tsa/server.mjs', import.meta.url);
const cacheDirectory = join(process.cwd(), 'node_modules', '.cache', 'docubox-real-pades-bt');
const bundlePath = join(cacheDirectory, 'real-pades-bt.cjs');
const outputDirectory = join(process.cwd(), 'output', 'pdf');
const productionMode = process.env.CRYPTO_PROVIDER_MODE === 'production';

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function opensslRun(args: string[], cwd?: string) {
  return execFileAsync(openssl, args, { cwd, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
}

async function createDevelopmentTsa() {
  const directory = await mkdtemp(join(tmpdir(), 'docubox-real-pades-bt-tsa-'));
  const data = join(directory, 'data');
  await mkdir(data);
  const rootKey = join(data, 'root.key.pem');
  const rootCert = join(data, 'root.crt.pem');
  const tsaKey = join(data, 'tsa.key.pem');
  const tsaCsr = join(data, 'tsa.csr.pem');
  const tsaCert = join(data, 'tsa.crt.pem');
  const chain = join(data, 'tsa-chain.pem');
  const extensions = join(directory, 'tsa.ext');
  const config = join(directory, 'openssl-tsa.cnf');
  await writeFile(
    extensions,
    [
      '[tsa_certificate]',
      'basicConstraints=critical,CA:FALSE',
      'keyUsage=critical,digitalSignature,nonRepudiation',
      'extendedKeyUsage=critical,timeStamping',
      'subjectKeyIdentifier=hash',
      'authorityKeyIdentifier=keyid,issuer',
      '',
    ].join('\n')
  );
  await opensslRun(
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:3072',
      '-nodes',
      '-sha256',
      '-days',
      '365',
      '-keyout',
      rootKey,
      '-out',
      rootCert,
      '-subj',
      '/C=MX/O=Docubox/OU=Development/CN=Docubox PAdES B-T Development Root',
    ],
    directory
  );
  await opensslRun(
    [
      'req',
      '-new',
      '-newkey',
      'rsa:3072',
      '-nodes',
      '-sha256',
      '-keyout',
      tsaKey,
      '-out',
      tsaCsr,
      '-subj',
      '/C=MX/O=Docubox/OU=Development/CN=Docubox PAdES B-T Development TSA',
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
      extensions,
      '-extensions',
      'tsa_certificate',
    ],
    directory
  );
  await writeFile(chain, await readFile(rootCert));
  await writeFile(join(data, 'tsaserial'), '01\n');
  await writeFile(
    config,
    [
      '[tsa]',
      'default_tsa=tsa_config1',
      '[tsa_config1]',
      'dir=./data',
      'serial=$dir/tsaserial',
      'crypto_device=builtin',
      'signer_cert=$dir/tsa.crt.pem',
      'certs=$dir/tsa-chain.pem',
      'signer_key=$dir/tsa.key.pem',
      'signer_digest=sha256',
      'default_policy=1.3.6.1.4.1.55555.1.1',
      'digests=sha256',
      'accuracy=secs:1',
      'ordering=yes',
      'tsa_name=yes',
      'ess_cert_id_chain=yes',
      'ess_cert_id_alg=sha256',
      '',
    ].join('\n')
  );
  return { directory, config, rootCert, tsaCert, chain };
}

async function startTsa(pki: Awaited<ReturnType<typeof createDevelopmentTsa>>) {
  const port = 20500 + Math.floor(Math.random() * 1000);
  const token = `docubox-bt-${Date.now()}`;
  const child = spawn(process.execPath, [fileURLToPath(tsaServerPath)], {
    cwd: pki.directory,
    env: {
      ...process.env,
      TSA_PORT: String(port),
      TSA_INTERNAL_TOKEN: token,
      TSA_CONFIG_PATH: pki.config,
      OPENSSL_BIN: openssl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('REAL_TSA_START_TIMEOUT')), 8_000);
    child.stdout.on('data', (data) => {
      if (String(data).includes('listening')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`REAL_TSA_EARLY_EXIT_${code}`)));
  });
  return {
    url: `http://127.0.0.1:${port}/internal/tsa`,
    token,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    },
  };
}

async function loadRuntime() {
  await mkdir(cacheDirectory, { recursive: true });
  await build({
    stdin: {
      contents:
        "export { upgradePadesBbCertificationToBt } from './src/lib/certification/product-integration'; export { createCertificationProviderSet } from './src/lib/certification/providers';",
      resolveDir: process.cwd(),
      sourcefile: 'real-pades-bt-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    external: ['@google-cloud/kms', '@supabase/supabase-js'],
    logLevel: 'silent',
  });
  return createRequire(import.meta.url)(bundlePath);
}

function cmsFromPdf(pdfBytes: Uint8Array) {
  const text = Buffer.from(pdfBytes).toString('latin1');
  const matches = [...text.matchAll(/\/Contents\s*<([0-9A-Fa-f]+)>/g)];
  const hex = matches.at(-1)?.[1];
  if (!hex) throw new Error('PADES_BT_CMS_NOT_FOUND');
  const padded = Buffer.from(hex, 'hex');
  if (padded[0] !== 0x30) throw new Error('PADES_BT_CMS_DER_INVALID');
  let lengthBytes = 0;
  let payloadLength = padded[1];
  if ((padded[1] & 0x80) !== 0) {
    lengthBytes = padded[1] & 0x7f;
    payloadLength = 0;
    for (let index = 0; index < lengthBytes; index += 1) {
      payloadLength = payloadLength * 256 + padded[2 + index];
    }
  }
  const totalLength = 2 + lengthBytes + payloadLength;
  return padded.subarray(0, totalLength);
}

async function countRows(supabase: SupabaseClient, table: string, column: string, value: string) {
  const result = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq(column, value);
  if (result.error) throw result.error;
  return result.count || 0;
}

let tsa: Awaited<ReturnType<typeof startTsa>> | null = null;
let pki: Awaited<ReturnType<typeof createDevelopmentTsa>> | null = null;

try {
  await opensslRun(['version']);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('SUPABASE_SERVER_CONFIGURATION_MISSING');
  if (!productionMode) {
    pki = await createDevelopmentTsa();
    tsa = await startTsa(pki);
  } else if (process.env.TSA_POLICY?.trim().toLowerCase() !== 'external-free') {
    throw new Error('PRODUCTION_EXTERNAL_TSA_POLICY_REQUIRED');
  }
  process.env.PADES_REQUIRED_LEVEL = 'B-T';
  if (tsa && pki) {
    process.env.DOCUBOX_TSA_PROVIDER = 'rfc3161';
    process.env.DOCUBOX_TSA_URL = tsa.url;
    process.env.DOCUBOX_TSA_INTERNAL_TOKEN = tsa.token;
    process.env.DOCUBOX_TSA_POLICY_OID = '1.3.6.1.4.1.55555.1.1';
    process.env.DOCUBOX_TSA_DIGEST_ALGORITHM = 'sha256';
    process.env.DOCUBOX_TSA_CERTIFICATE_PATH = pki.tsaCert;
    process.env.DOCUBOX_TSA_CHAIN_PATH = pki.chain;
    process.env.DOCUBOX_TSA_TRUST_ROOT_PATH = pki.rootCert;
    process.env.DOCUBOX_TSA_TIMEOUT_MS = '8000';
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const requestedDocumentId = process.env.REAL_PADES_DOCUMENT_ID?.trim();
  let query = supabase
    .from('document_certifications')
    .select(
      'id,certification_uuid,document_id,document_version_id,certified_pdf_sha256,pades_byte_range,pades_certificate_fingerprint_sha256'
    )
    .eq('status', 'COMPLETED')
    .eq('execution_status', 'completed')
    .eq('pades_profile', 'PAdES-B-B')
    .eq('pdf_signature_status', 'valid')
    .eq('certificate_status', 'valid')
    .eq('verification_status', 'valid')
    .order('pades_verified_at', { ascending: false })
    .limit(1);
  if (requestedDocumentId) query = query.eq('document_id', requestedDocumentId);
  const sourceResult = await query.maybeSingle();
  if (sourceResult.error || !sourceResult.data)
    throw sourceResult.error || new Error('REAL_PADES_BB_CERTIFICATION_NOT_FOUND');
  const source = sourceResult.data;
  const certificationCountBefore = await countRows(
    supabase,
    'document_certifications',
    'document_id',
    source.document_id
  );
  const timestampCountBefore = await countRows(
    supabase,
    'timestamp_records',
    'document_certification_id',
    source.id
  );
  const runtime = await loadRuntime();
  const providers = runtime.createCertificationProviderSet();
  const tsaHealth = await providers.timestampAuthority.healthCheck();
  if (!tsaHealth.ready) throw new Error(`REAL_TSA_HEALTH_FAILED:${tsaHealth.missing?.join(',')}`);

  const first = await runtime.upgradePadesBbCertificationToBt(
    supabase,
    {
      documentId: source.document_id,
      triggeredBy: process.env.REAL_PADES_TRIGGERED_BY || undefined,
    },
    providers
  );
  const second = await runtime.upgradePadesBbCertificationToBt(
    supabase,
    {
      documentId: source.document_id,
      triggeredBy: process.env.REAL_PADES_TRIGGERED_BY || undefined,
    },
    providers
  );
  if (
    first.certificationUuid !== second.certificationUuid ||
    first.documentVersionId !== second.documentVersionId ||
    first.storagePath !== second.storagePath ||
    first.sha256 !== second.sha256 ||
    second.alreadyVerified !== true
  )
    throw new Error('PRODUCT_PADES_BT_RETRY_NOT_IDEMPOTENT');

  const certificationResult = await supabase
    .from('document_certifications')
    .select(
      'id,certification_uuid,document_id,document_version_id,status,execution_status,pades_profile,pdf_signature_status,certificate_status,timestamp_status,verification_status,certified_pdf_path,certified_pdf_sha256,pades_byte_range,pades_verification_result,pades_verified_at,provider_metadata'
    )
    .eq('id', source.id)
    .single();
  if (certificationResult.error || !certificationResult.data)
    throw certificationResult.error || new Error('PADES_BT_CERTIFICATION_MISSING');
  const certification = certificationResult.data;
  const primary = certification.pades_verification_result?.primary || {};
  const independent = certification.pades_verification_result?.independent || {};
  for (const verification of [primary, independent]) {
    if (
      verification.valid !== true ||
      verification.profile !== 'PAdES-B-T' ||
      verification.byteRangeValid !== true ||
      verification.cmsValid !== true ||
      verification.certificateValid !== true ||
      verification.certificateKeyMatches !== true ||
      verification.timestamp?.valid !== true ||
      verification.timestamp?.messageImprintValid !== true ||
      verification.timestamp?.nonceValid !== true ||
      verification.timestamp?.policyValid !== true ||
      verification.timestamp?.cmsValid !== true ||
      verification.timestamp?.certificateValid !== true ||
      verification.timestamp?.chainValid !== true ||
      verification.timestamp?.tsaEkuValid !== true
    )
      throw new Error('PADES_BT_VERIFICATION_INCOMPLETE');
  }
  if (
    certification.pades_profile !== 'PAdES-B-T' ||
    certification.timestamp_status !== 'valid' ||
    certification.certified_pdf_sha256 !== first.sha256
  )
    throw new Error('PADES_BT_PERSISTENCE_INVALID');

  const timestampResult = await supabase
    .from('timestamp_records')
    .select('*')
    .eq('document_certification_id', source.id)
    .single();
  if (timestampResult.error || !timestampResult.data)
    throw timestampResult.error || new Error('RFC3161_RECORD_MISSING');
  const timestamp = timestampResult.data;
  if (
    timestamp.status !== 'VALID' ||
    !timestamp.request_storage_path ||
    !timestamp.response_storage_path ||
    !timestamp.token_storage_path ||
    timestamp.timestamp_token_sha256 !== first.timestamp?.tokenSha256
  )
    throw new Error('RFC3161_RECORD_INVALID');

  let tsaTrustRootPath = pki?.rootCert || null;
  if (!tsaTrustRootPath) {
    const trustBundleRoot =
      process.env.DOCUBOX_TSA_TRUST_BUNDLE_ROOT || join('infra', 'tsa', 'trust-bundles');
    const bundleName = String(first.timestamp?.trustBundleId || '');
    const providerDirectory = bundleName.startsWith('freetsa-')
      ? 'freetsa'
      : bundleName.startsWith('open-tsa-')
        ? 'open-tsa'
        : null;
    const version = bundleName.match(/-v(\d+)$/)?.[1];
    if (!providerDirectory || !version) throw new Error('EXTERNAL_TSA_TRUST_BUNDLE_UNKNOWN');
    const bundleDirectory = join(process.cwd(), trustBundleRoot, providerDirectory, `v${version}`);
    const manifest = JSON.parse(await readFile(join(bundleDirectory, 'manifest.json'), 'utf8'));
    tsaTrustRootPath = join(bundleDirectory, manifest.trustRoot.path);
  }

  const finalDownload = await supabase.storage.from('documents').download(first.storagePath);
  if (finalDownload.error || !finalDownload.data)
    throw finalDownload.error || new Error('PADES_BT_FINAL_PDF_MISSING');
  const finalBytes = new Uint8Array(await finalDownload.data.arrayBuffer());
  if (sha256(finalBytes) !== first.sha256) throw new Error('PADES_BT_FINAL_HASH_MISMATCH');
  const verification = await providers.pdfSignature.verifyPdf({
    pdfBytes: finalBytes,
    expectedCertificateFingerprintSha256: source.pades_certificate_fingerprint_sha256,
  });
  if (
    !verification.valid ||
    verification.profile !== 'PAdES-B-T' ||
    !verification.timestamp?.valid
  ) {
    throw new Error(`PADES_BT_FINAL_VERIFY_FAILED:${verification.detail || 'INVALID'}`);
  }
  const altered = new Uint8Array(finalBytes);
  altered[20] ^= 1;
  if ((await providers.pdfSignature.verifyPdf({ pdfBytes: altered })).valid) {
    throw new Error('PADES_BT_BYTE_MUTATION_NOT_DETECTED');
  }

  const [requestDownload, responseDownload] = await Promise.all([
    supabase.storage.from('certification-artifacts').download(timestamp.request_storage_path),
    supabase.storage.from('certification-artifacts').download(timestamp.response_storage_path),
  ]);
  if (requestDownload.error || !requestDownload.data)
    throw requestDownload.error || new Error('RFC3161_TSQ_MISSING');
  if (responseDownload.error || !responseDownload.data)
    throw responseDownload.error || new Error('RFC3161_TSR_MISSING');
  const externalDirectory = await mkdtemp(join(tmpdir(), 'docubox-real-pades-bt-openssl-'));
  try {
    const cmsPath = join(externalDirectory, 'signature-bt.cms');
    const contentPath = join(externalDirectory, 'detached-content.bin');
    const verifiedPath = join(externalDirectory, 'verified-content.bin');
    const requestPath = join(externalDirectory, 'request.tsq');
    const responsePath = join(externalDirectory, 'response.tsr');
    const byteRange = certification.pades_byte_range;
    if (!Array.isArray(byteRange) || byteRange.length !== 4)
      throw new Error('PADES_BT_BYTE_RANGE_MISSING');
    if (JSON.stringify(byteRange) !== JSON.stringify(source.pades_byte_range))
      throw new Error('PADES_BT_BYTE_RANGE_CHANGED');
    const detached = Buffer.concat([
      Buffer.from(finalBytes).subarray(byteRange[0], byteRange[0] + byteRange[1]),
      Buffer.from(finalBytes).subarray(byteRange[2], byteRange[2] + byteRange[3]),
    ]);
    await Promise.all([
      writeFile(cmsPath, cmsFromPdf(finalBytes)),
      writeFile(contentPath, detached),
      writeFile(requestPath, new Uint8Array(await requestDownload.data.arrayBuffer())),
      writeFile(responsePath, new Uint8Array(await responseDownload.data.arrayBuffer())),
    ]);
    await opensslRun(
      [
        'cms',
        '-verify',
        '-binary',
        '-inform',
        'DER',
        '-in',
        cmsPath,
        '-content',
        contentPath,
        '-noverify',
        '-out',
        verifiedPath,
      ],
      externalDirectory
    );
    if (!(await readFile(verifiedPath)).equals(detached))
      throw new Error('PADES_BT_OPENSSL_CONTENT_MISMATCH');
    await opensslRun(
      [
        'ts',
        '-verify',
        '-queryfile',
        requestPath,
        '-in',
        responsePath,
        '-CAfile',
        tsaTrustRootPath,
      ],
      externalDirectory
    );
  } finally {
    await rm(externalDirectory, { recursive: true, force: true });
  }

  const certificationCountAfter = await countRows(
    supabase,
    'document_certifications',
    'document_id',
    source.document_id
  );
  const timestampCountAfter = await countRows(
    supabase,
    'timestamp_records',
    'document_certification_id',
    source.id
  );
  if (
    certificationCountAfter !== certificationCountBefore ||
    timestampCountAfter !== Math.max(1, timestampCountBefore)
  ) {
    throw new Error('PADES_BT_DUPLICATE_EVIDENCE_CREATED');
  }
  const documentResult = await supabase
    .from('documentos')
    .select('sealed_pdf_path,sealed_pdf_hash')
    .eq('id', source.document_id)
    .single();
  if (
    documentResult.error ||
    documentResult.data?.sealed_pdf_path !== first.storagePath ||
    documentResult.data?.sealed_pdf_hash !== first.sha256
  )
    throw new Error('PADES_BT_FINAL_NOT_PROMOTED');

  await mkdir(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, `docubox-real-${source.document_id}-pades-bt.pdf`);
  await writeFile(outputPath, finalBytes);
  console.info('Real Docubox document PAdES-B-T');
  console.info('--------------------------------');
  console.info(`Document: ${source.document_id}`);
  console.info(`Document version: ${first.documentVersionId}`);
  console.info(`Certification: ${first.certificationUuid}`);
  console.info(`TSA provider: ${first.timestamp?.provider}`);
  console.info(`TSA policy: ${first.timestamp?.policyOid}`);
  console.info(`TSA genTime: ${first.timestamp?.genTime}`);
  console.info('B-B source preserved: OK');
  console.info('SignatureTimeStamp unsigned attribute: OK');
  console.info('ByteRange preserved: OK');
  console.info('Internal verification: PASS');
  console.info('Independent verification: PASS');
  console.info('OpenSSL CMS verification: PASS');
  console.info('OpenSSL RFC 3161 verification: PASS');
  console.info('One-byte mutation: FAIL as expected');
  console.info('Storage and timestamp_records: OK');
  console.info('Idempotent retry: OK');
  console.info(`Output: ${outputPath}`);
  console.info('');
  console.info('REAL DOCUMENT PADES-B-T VERIFIED');
  if (productionMode) console.info('PRODUCTION PADES-B-T VERIFIED');
} catch (error) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : error instanceof Error
        ? error.message
        : 'UNKNOWN_ERROR';
  console.error(`REAL DOCUMENT PADES-B-T FAILED: ${code}`);
  if (error instanceof Error && error.message !== code) console.error(`Detail: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (tsa) await tsa.stop();
  if (pki) await rm(pki.directory, { recursive: true, force: true });
  await rm(cacheDirectory, { recursive: true, force: true });
}
