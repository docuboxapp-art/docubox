import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { build } from 'esbuild';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const execFileAsync = promisify(execFile);
const openssl =
  process.env.OPENSSL_BIN ||
  (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
const cacheDirectory = join(process.cwd(), 'node_modules', '.cache', 'docubox-external-tsa-e2e');
const bundlePath = join(cacheDirectory, 'external-tsa-e2e.cjs');
const outputDirectory = join(process.cwd(), 'output', 'pdf');
const trustRoot = join(process.cwd(), 'infra', 'tsa', 'trust-bundles');

type RealDocument = {
  id: string;
  owner_id: string;
  workspace_id: string;
  nombre: string;
  fecha_completado: string;
  sealed_pdf_path: string;
  sealed_pdf_hash: string | null;
};

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function opensslRun(args: string[], cwd?: string) {
  return execFileAsync(openssl, args, {
    cwd,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
}

async function loadRuntime() {
  await mkdir(cacheDirectory, { recursive: true });
  await build({
    stdin: {
      contents: [
        "export { integratePadesBbFinalDocument, upgradePadesBbCertificationToBt } from './src/lib/certification/product-integration';",
        "export { createCertificationProviderSet } from './src/lib/certification/providers';",
        "export { loadExternalTsaTrustBundle, ExternalRfc3161Provider, TimeStampProviderRouter } from './src/lib/certification/external-timestamp';",
        "export { PadesBbPdfSignatureProvider } from './src/lib/certification/pades';",
        "export { IndependentPadesVerificationProvider } from './src/lib/certification/independent-verification';",
      ].join('\n'),
      resolveDir: process.cwd(),
      sourcefile: 'external-tsa-e2e-entry.ts',
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
  const hex = [...text.matchAll(/\/Contents\s*<([0-9A-Fa-f]+)>/g)].at(-1)?.[1];
  if (!hex) throw new Error('PADES_BT_CMS_NOT_FOUND');
  const padded = Buffer.from(hex, 'hex');
  if (padded[0] !== 0x30) throw new Error('PADES_BT_CMS_DER_INVALID');
  const firstLength = padded[1];
  if (firstLength === undefined) throw new Error('PADES_BT_CMS_LENGTH_MISSING');
  let headerLength = 2;
  let contentLength = firstLength;
  if ((firstLength & 0x80) !== 0) {
    const lengthBytes = firstLength & 0x7f;
    headerLength += lengthBytes;
    contentLength = 0;
    for (let index = 0; index < lengthBytes; index += 1) {
      contentLength = contentLength * 256 + (padded[2 + index] || 0);
    }
  }
  return padded.subarray(0, headerLength + contentLength);
}

async function requireProvenanceMigration(supabase: SupabaseClient) {
  const result = await supabase
    .from('timestamp_records')
    .select('id,tsa_provider_role,trust_bundle_id,fallback_used')
    .limit(1);
  if (result.error) {
    throw new Error(`EXTERNAL_TSA_PROVENANCE_MIGRATION_MISSING:${result.error.message}`);
  }
}

async function eligibleDocuments(supabase: SupabaseClient) {
  const documents = await supabase
    .from('documentos')
    .select('id,owner_id,workspace_id,nombre,fecha_completado,sealed_pdf_path,sealed_pdf_hash')
    .eq('estado', 'completado')
    .not('sealed_pdf_path', 'is', null)
    .order('fecha_completado', { ascending: false })
    .limit(50);
  if (documents.error) throw documents.error;
  const candidates = (documents.data || []).filter(
    (document: RealDocument) =>
      document.owner_id &&
      document.workspace_id &&
      document.fecha_completado &&
      document.sealed_pdf_path &&
      !document.sealed_pdf_path.includes('/pades/')
  ) as RealDocument[];
  if (!candidates.length) throw new Error('REAL_COMPLETED_VISUAL_DOCUMENT_NOT_FOUND');
  const certifications = await supabase
    .from('document_certifications')
    .select('document_id')
    .in(
      'document_id',
      candidates.map((item) => item.id)
    );
  if (certifications.error) throw certifications.error;
  const certified = new Set((certifications.data || []).map((item) => item.document_id));
  const eligible = candidates.filter((item) => !certified.has(item.id));
  if (eligible.length < 2) {
    throw new Error(`TWO_REAL_UNCERTIFIED_DOCUMENTS_REQUIRED:found=${eligible.length}`);
  }
  return eligible.slice(0, 2);
}

async function createBbSource(supabase: SupabaseClient, runtime: any, document: RealDocument) {
  const source = await supabase.storage.from('documents').download(document.sealed_pdf_path);
  if (source.error || !source.data) throw source.error || new Error('REAL_VISUAL_PDF_NOT_FOUND');
  const visualPdfBytes = new Uint8Array(await source.data.arrayBuffer());
  const visualPdfSha256 = sha256(visualPdfBytes);
  if (document.sealed_pdf_hash && document.sealed_pdf_hash !== visualPdfSha256) {
    throw new Error('REAL_VISUAL_PDF_HASH_MISMATCH');
  }
  return runtime.integratePadesBbFinalDocument(supabase, {
    documentId: document.id,
    documentOwnerId: document.owner_id,
    workspaceId: document.workspace_id,
    triggeredBy: document.owner_id,
    visualPdfBytes,
    visualPdfSha256,
    completedAt: document.fecha_completado,
    signaturesApplied: 1,
  });
}

async function providersFor(runtime: any, forceFallback: boolean) {
  const base = runtime.createCertificationProviderSet();
  if (!forceFallback) return base;
  const [freeBundle, openBundle] = await Promise.all([
    runtime.loadExternalTsaTrustBundle(join(trustRoot, 'freetsa', 'v1')),
    runtime.loadExternalTsaTrustBundle(join(trustRoot, 'open-tsa', 'v1')),
  ]);
  const forcedPrimaryBundle = {
    ...freeBundle,
    manifest: { ...freeBundle.manifest, endpoint: 'https://127.0.0.1:1/tsr' },
  };
  const primary = new runtime.ExternalRfc3161Provider({
    id: 'freetsa',
    role: 'PRIMARY',
    endpointId: 'freetsa-controlled-unavailable-e2e',
    bundle: forcedPrimaryBundle,
    timeoutMs: 500,
    maxRequestsPerMinute: 30,
  });
  const fallback = new runtime.ExternalRfc3161Provider({
    id: 'open-tsa',
    role: 'FALLBACK',
    endpointId: 'open-tsa-official-tsr',
    bundle: openBundle,
    timeoutMs: 8_000,
    maxRequestsPerMinute: 60,
  });
  const timestampAuthority = new runtime.TimeStampProviderRouter({
    primary,
    fallback,
    retryDelayMs: 25,
    circuitFailureThreshold: 5,
    circuitCooldownMs: 30_000,
    random: () => 0,
  });
  const pdfSignature = new runtime.PadesBbPdfSignatureProvider(
    base.keyManagement,
    base.certificate,
    timestampAuthority
  );
  const independentVerification = new runtime.IndependentPadesVerificationProvider(
    new runtime.PadesBbPdfSignatureProvider(
      base.keyManagement,
      base.certificate,
      timestampAuthority
    )
  );
  return { ...base, timestampAuthority, pdfSignature, independentVerification };
}

async function countRows(supabase: SupabaseClient, table: string, column: string, value: string) {
  const result = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq(column, value);
  if (result.error) throw result.error;
  return result.count || 0;
}

async function verifyExternalResult(
  supabase: SupabaseClient,
  runtime: any,
  document: RealDocument,
  providers: any,
  expected: {
    provider: 'freetsa' | 'open-tsa';
    role: 'PRIMARY' | 'FALLBACK';
    bundle: 'freetsa-v1' | 'open-tsa-v1';
    fallback: boolean;
  }
) {
  const first = await runtime.upgradePadesBbCertificationToBt(
    supabase,
    { documentId: document.id, triggeredBy: document.owner_id },
    providers
  );
  const certificationIdResult = await supabase
    .from('document_certifications')
    .select('id')
    .eq('document_id', document.id)
    .single();
  if (certificationIdResult.error || !certificationIdResult.data) {
    throw certificationIdResult.error || new Error('EXTERNAL_TSA_CERTIFICATION_MISSING');
  }
  const timestampCount = await countRows(
    supabase,
    'timestamp_records',
    'document_certification_id',
    certificationIdResult.data.id
  );
  const second = await runtime.upgradePadesBbCertificationToBt(
    supabase,
    { documentId: document.id, triggeredBy: document.owner_id },
    providers
  );
  if (
    first.certificationUuid !== second.certificationUuid ||
    first.documentVersionId !== second.documentVersionId ||
    first.storagePath !== second.storagePath ||
    first.sha256 !== second.sha256 ||
    second.alreadyVerified !== true
  ) {
    throw new Error('EXTERNAL_TSA_RETRY_NOT_IDEMPOTENT');
  }

  const certificationResult = await supabase
    .from('document_certifications')
    .select(
      'id,pades_profile,pades_byte_range,pades_certificate_fingerprint_sha256,pades_verification_result,timestamp_status,certified_pdf_sha256'
    )
    .eq('document_id', document.id)
    .single();
  if (certificationResult.error || !certificationResult.data) {
    throw certificationResult.error || new Error('EXTERNAL_TSA_CERTIFICATION_MISSING');
  }
  const certification = certificationResult.data;
  const timestampResult = await supabase
    .from('timestamp_records')
    .select('*')
    .eq('document_certification_id', certification.id)
    .single();
  if (timestampResult.error || !timestampResult.data) {
    throw timestampResult.error || new Error('EXTERNAL_TSA_RECORD_MISSING');
  }
  const timestamp = timestampResult.data;
  const verifications = [
    certification.pades_verification_result?.primary,
    certification.pades_verification_result?.independent,
  ];
  for (const verification of verifications) {
    if (
      verification?.valid !== true ||
      verification?.profile !== 'PAdES-B-T' ||
      verification?.byteRangeValid !== true ||
      verification?.cmsValid !== true ||
      verification?.certificateValid !== true ||
      verification?.certificateKeyMatches !== true ||
      verification?.timestamp?.valid !== true ||
      verification?.timestamp?.messageImprintValid !== true ||
      verification?.timestamp?.nonceValid !== true ||
      verification?.timestamp?.policyValid !== true ||
      verification?.timestamp?.cmsValid !== true ||
      verification?.timestamp?.certificateValid !== true ||
      verification?.timestamp?.chainValid !== true ||
      verification?.timestamp?.tsaEkuValid !== true
    ) {
      throw new Error('EXTERNAL_TSA_PADES_BT_VERIFICATION_INCOMPLETE');
    }
  }
  if (
    certification.pades_profile !== 'PAdES-B-T' ||
    certification.timestamp_status !== 'valid' ||
    timestamp.status !== 'VALID' ||
    timestamp.tsa_name !== expected.provider ||
    timestamp.tsa_provider_role !== expected.role ||
    timestamp.trust_bundle_id !== expected.bundle ||
    timestamp.fallback_used !== expected.fallback ||
    (expected.fallback && !timestamp.primary_failure_code)
  ) {
    throw new Error('EXTERNAL_TSA_PROVENANCE_INVALID');
  }

  const finalDownload = await supabase.storage.from('documents').download(first.storagePath);
  if (finalDownload.error || !finalDownload.data) {
    throw finalDownload.error || new Error('EXTERNAL_TSA_FINAL_PDF_MISSING');
  }
  const finalBytes = new Uint8Array(await finalDownload.data.arrayBuffer());
  if (sha256(finalBytes) !== first.sha256 || first.sha256 !== certification.certified_pdf_sha256) {
    throw new Error('EXTERNAL_TSA_FINAL_HASH_MISMATCH');
  }
  const verification = await providers.pdfSignature.verifyPdf({
    pdfBytes: finalBytes,
    expectedCertificateFingerprintSha256: certification.pades_certificate_fingerprint_sha256,
  });
  if (
    !verification.valid ||
    verification.profile !== 'PAdES-B-T' ||
    !verification.timestamp?.valid
  ) {
    throw new Error(`EXTERNAL_TSA_FINAL_VERIFY_FAILED:${verification.detail || 'INVALID'}`);
  }
  const altered = new Uint8Array(finalBytes);
  altered[20] ^= 1;
  if ((await providers.pdfSignature.verifyPdf({ pdfBytes: altered })).valid) {
    throw new Error('EXTERNAL_TSA_BYTE_MUTATION_NOT_DETECTED');
  }

  const [requestDownload, responseDownload] = await Promise.all([
    supabase.storage.from('certification-artifacts').download(timestamp.request_storage_path),
    supabase.storage.from('certification-artifacts').download(timestamp.response_storage_path),
  ]);
  if (requestDownload.error || !requestDownload.data)
    throw requestDownload.error || new Error('EXTERNAL_TSA_TSQ_MISSING');
  if (responseDownload.error || !responseDownload.data)
    throw responseDownload.error || new Error('EXTERNAL_TSA_TSR_MISSING');
  const work = await mkdtemp(join(tmpdir(), `docubox-${expected.provider}-openssl-`));
  try {
    const cmsPath = join(work, 'signature.cms');
    const contentPath = join(work, 'detached-content.bin');
    const verifiedPath = join(work, 'verified-content.bin');
    const requestPath = join(work, 'request.tsq');
    const responsePath = join(work, 'response.tsr');
    const byteRange = certification.pades_byte_range;
    if (!Array.isArray(byteRange) || byteRange.length !== 4)
      throw new Error('EXTERNAL_TSA_BYTE_RANGE_MISSING');
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
      work
    );
    if (!(await readFile(verifiedPath)).equals(detached))
      throw new Error('EXTERNAL_TSA_OPENSSL_CONTENT_MISMATCH');
    const bundleDirectory = join(trustRoot, expected.provider, 'v1');
    const manifest = JSON.parse(await readFile(join(bundleDirectory, 'manifest.json'), 'utf8'));
    const tsaArgs = [
      'ts',
      '-verify',
      '-queryfile',
      requestPath,
      '-in',
      responsePath,
      '-CAfile',
      join(bundleDirectory, manifest.trustRoot.path),
    ];
    if (expected.provider === 'open-tsa') {
      tsaArgs.push('-untrusted', join(bundleDirectory, manifest.certificateChain.path));
    }
    await opensslRun(tsaArgs, work);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  const timestampCountAfterRetry = await countRows(
    supabase,
    'timestamp_records',
    'document_certification_id',
    certification.id
  );
  if (timestampCount !== 1 || timestampCountAfterRetry !== 1) {
    throw new Error('EXTERNAL_TSA_DUPLICATE_TIMESTAMP_CREATED');
  }
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = join(
    outputDirectory,
    `docubox-real-${document.id}-${expected.provider}-pades-bt.pdf`
  );
  await writeFile(outputPath, finalBytes);
  return { first, timestamp, outputPath };
}

try {
  process.env.TSA_POLICY = 'external-free';
  process.env.PADES_REQUIRED_LEVEL = 'B-T';
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('SUPABASE_SERVER_CONFIGURATION_MISSING');
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  await requireProvenanceMigration(supabase);
  const runtime = await loadRuntime();
  const [freeDocument, fallbackDocument] = await eligibleDocuments(supabase);

  await createBbSource(supabase, runtime, freeDocument);
  const freeProviders = await providersFor(runtime, false);
  const freeHealth = await freeProviders.timestampAuthority.healthCheck();
  if (!freeHealth.ready)
    throw new Error(`FREETSA_HEALTH_FAILED:${freeHealth.detail || freeHealth.missing?.join(',')}`);
  const free = await verifyExternalResult(supabase, runtime, freeDocument, freeProviders, {
    provider: 'freetsa',
    role: 'PRIMARY',
    bundle: 'freetsa-v1',
    fallback: false,
  });
  console.info('FreeTSA connectivity: PASS');
  console.info('RFC3161 request/token/imprint/nonce/policy: PASS');
  console.info('TSA certificate/chain/trusted root: PASS');
  console.info('OpenSSL CMS/RFC3161: PASS');
  console.info(`Output: ${free.outputPath}`);
  console.info('REAL EXTERNAL FREETSA PADES-B-T VERIFIED');

  await createBbSource(supabase, runtime, fallbackDocument);
  const fallbackProviders = await providersFor(runtime, true);
  const fallback = await verifyExternalResult(
    supabase,
    runtime,
    fallbackDocument,
    fallbackProviders,
    {
      provider: 'open-tsa',
      role: 'FALLBACK',
      bundle: 'open-tsa-v1',
      fallback: true,
    }
  );
  console.info('Controlled FreeTSA unavailability: PASS');
  console.info(`Primary failure: ${fallback.timestamp.primary_failure_code}`);
  console.info('Open TSA RFC3161/OpenSSL/PAdES-B-T: PASS');
  console.info(`Output: ${fallback.outputPath}`);
  console.info('REAL EXTERNAL TSA FALLBACK VERIFIED');
  console.info('REAL EXTERNAL TSA PADES-B-T VERIFIED');
} catch (error) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : error instanceof Error
        ? error.message
        : 'UNKNOWN_ERROR';
  console.error(`REAL EXTERNAL TSA PADES-B-T FAILED: ${code}`);
  if (error instanceof Error && error.message !== code) console.error(`Detail: ${error.message}`);
  process.exitCode = 1;
} finally {
  await rm(cacheDirectory, { recursive: true, force: true });
}
