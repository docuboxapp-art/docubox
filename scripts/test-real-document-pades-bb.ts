import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { build } from 'esbuild';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const execFileAsync = promisify(execFile);
const cacheDirectory = join(process.cwd(), 'node_modules', '.cache', 'docubox-real-pades-product');
const bundlePath = join(cacheDirectory, 'real-pades-product.cjs');
const outputDirectory = join(process.cwd(), 'output', 'pdf');
const openssl =
  process.env.OPENSSL_BIN ||
  (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');

interface RealDocument {
  id: string;
  documento_id: string;
  owner_id: string;
  workspace_id: string;
  nombre: string;
  estado: string;
  fecha_completado: string;
  sealed_pdf_path: string;
  sealed_pdf_hash: string | null;
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function loadRuntime() {
  await mkdir(cacheDirectory, { recursive: true });
  await build({
    stdin: {
      contents: [
        "export { integratePadesBbFinalDocument, createPadesBbProductProviderSet } from './src/lib/certification/product-integration';",
      ].join('\n'),
      resolveDir: process.cwd(),
      sourcefile: 'real-pades-product-entry.ts',
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

async function realDocument(supabase: any): Promise<RealDocument> {
  const requestedId = process.env.REAL_PADES_DOCUMENT_ID?.trim();
  if (process.env.CRYPTO_PROVIDER_MODE === 'production' && !requestedId) {
    throw new Error('PRODUCTION_REAL_PADES_DOCUMENT_ID_REQUIRED');
  }
  let query = supabase
    .from('documentos')
    .select(
      'id,documento_id,owner_id,workspace_id,nombre,estado,fecha_completado,sealed_pdf_path,sealed_pdf_hash'
    )
    .eq('estado', 'completado')
    .not('sealed_pdf_path', 'is', null)
    .order('fecha_completado', { ascending: false })
    .limit(25);
  if (requestedId) query = query.eq('id', requestedId);
  const result = await query;
  if (result.error) throw result.error;
  const candidate = (result.data || []).find(
    (item: RealDocument) =>
      item.workspace_id &&
      item.owner_id &&
      item.fecha_completado &&
      item.sealed_pdf_path &&
      !item.sealed_pdf_path.includes('/pades/')
  );
  if (!candidate) throw new Error('REAL_COMPLETED_VISUAL_DOCUMENT_NOT_FOUND');
  return candidate as RealDocument;
}

async function countRows(supabase: any, table: string, documentId: string) {
  const result = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('document_id', documentId);
  if (result.error) throw result.error;
  return result.count || 0;
}

try {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('SUPABASE_SERVER_CONFIGURATION_MISSING');
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const runtime = await loadRuntime();
  const document = await realDocument(supabase);
  const visualDownload = await supabase.storage
    .from('documents')
    .download(document.sealed_pdf_path);
  if (visualDownload.error || !visualDownload.data)
    throw visualDownload.error || new Error('REAL_VISUAL_PDF_NOT_FOUND');
  const visualBytes = new Uint8Array(await visualDownload.data.arrayBuffer());
  const visualHash = sha256(visualBytes);
  if (document.sealed_pdf_hash && document.sealed_pdf_hash !== visualHash) {
    throw new Error('REAL_VISUAL_PDF_HASH_MISMATCH');
  }

  const input = {
    documentId: document.id,
    documentOwnerId: document.owner_id,
    workspaceId: document.workspace_id,
    triggeredBy: document.owner_id,
    visualPdfBytes: visualBytes,
    visualPdfSha256: visualHash,
    completedAt: document.fecha_completado,
    signaturesApplied: 1,
  };
  const first = await runtime.integratePadesBbFinalDocument(supabase, input);
  const certificationsAfterFirst = await countRows(
    supabase,
    'document_certifications',
    document.id
  );
  const second = await runtime.integratePadesBbFinalDocument(supabase, input);
  const certificationsAfterSecond = await countRows(
    supabase,
    'document_certifications',
    document.id
  );
  if (
    first.certificationUuid !== second.certificationUuid ||
    first.documentVersionId !== second.documentVersionId ||
    first.storagePath !== second.storagePath ||
    first.sha256 !== second.sha256
  )
    throw new Error('PRODUCT_PADES_RETRY_NOT_IDEMPOTENT');

  const certificationResult = await supabase
    .from('document_certifications')
    .select(
      'id,certification_uuid,document_version_id,status,execution_status,pades_profile,pdf_signature_status,certificate_status,verification_status,certified_pdf_path,certified_pdf_sha256,pades_byte_range,pades_certificate_fingerprint_sha256,pades_verification_result,pades_verified_at,provider_metadata'
    )
    .eq('document_id', document.id)
    .eq('document_version_id', first.documentVersionId)
    .single();
  if (certificationResult.error || !certificationResult.data)
    throw certificationResult.error || new Error('PRODUCT_CERTIFICATION_MISSING');
  const certification = certificationResult.data;
  const primary = certification.pades_verification_result?.primary || {};
  const independent = certification.pades_verification_result?.independent || {};
  if (
    certification.status !== 'COMPLETED' ||
    certification.execution_status !== 'completed' ||
    certification.pades_profile !== 'PAdES-B-B' ||
    certification.pdf_signature_status !== 'valid' ||
    certification.certificate_status !== 'valid' ||
    certification.verification_status !== 'valid' ||
    !primary.valid ||
    !primary.byteRangeValid ||
    !primary.cmsValid ||
    !primary.certificateValid ||
    !primary.certificateKeyMatches ||
    !independent.valid ||
    !independent.byteRangeValid ||
    !independent.cmsValid ||
    !independent.certificateValid ||
    !independent.certificateKeyMatches
  )
    throw new Error('PRODUCT_CERTIFICATION_NOT_FULLY_VERIFIED');
  if (process.env.CRYPTO_PROVIDER_MODE === 'production') {
    if (
      certification.provider_metadata?.environment !== 'production' ||
      certification.provider_metadata?.kms?.provider !== 'gcp' ||
      certification.provider_metadata?.kms?.protection_level !== 'hsm'
    ) {
      throw new Error('PRODUCTION_HSM_PROVENANCE_MISSING');
    }
  }

  const finalDownload = await supabase.storage.from('documents').download(first.storagePath);
  if (finalDownload.error || !finalDownload.data)
    throw finalDownload.error || new Error('PRODUCT_FINAL_PDF_NOT_FOUND');
  const finalBytes = new Uint8Array(await finalDownload.data.arrayBuffer());
  if (sha256(finalBytes) !== first.sha256 || first.sha256 !== certification.certified_pdf_sha256) {
    throw new Error('PRODUCT_FINAL_PDF_HASH_MISMATCH');
  }
  const providers = runtime.createPadesBbProductProviderSet();
  const internalVerification = await providers.pdfSignature.verifyPdf({
    pdfBytes: finalBytes,
    expectedCertificateFingerprintSha256: certification.pades_certificate_fingerprint_sha256,
  });
  if (!internalVerification.valid)
    throw new Error(`PRODUCT_FINAL_PDF_VERIFY_FAILED:${internalVerification.detail || 'INVALID'}`);

  const altered = new Uint8Array(finalBytes);
  altered[20] ^= 1;
  const alteredVerification = await providers.pdfSignature.verifyPdf({
    pdfBytes: altered,
    expectedCertificateFingerprintSha256: certification.pades_certificate_fingerprint_sha256,
  });
  if (alteredVerification.valid) throw new Error('PRODUCT_PADES_BYTE_MUTATION_NOT_DETECTED');

  const artifactRoot = dirname(certification.certified_pdf_path);
  const cmsDownload = await supabase.storage
    .from('certification-artifacts')
    .download(`${artifactRoot}/public/pdf-signature.cms`);
  if (cmsDownload.error || !cmsDownload.data)
    throw cmsDownload.error || new Error('PRODUCT_PADES_CMS_NOT_FOUND');
  const cmsBytes = new Uint8Array(await cmsDownload.data.arrayBuffer());
  const byteRange = certification.pades_byte_range;
  if (!Array.isArray(byteRange) || byteRange.length !== 4)
    throw new Error('PRODUCT_PADES_BYTE_RANGE_MISSING');
  const detached = Buffer.concat([
    Buffer.from(finalBytes).subarray(byteRange[0], byteRange[0] + byteRange[1]),
    Buffer.from(finalBytes).subarray(byteRange[2], byteRange[2] + byteRange[3]),
  ]);
  const independentDirectory = await mkdtemp(join(tmpdir(), 'docubox-product-pades-openssl-'));
  try {
    const cmsPath = join(independentDirectory, 'signature.cms');
    const contentPath = join(independentDirectory, 'detached-content.bin');
    const verifiedPath = join(independentDirectory, 'verified-content.bin');
    await Promise.all([writeFile(cmsPath, cmsBytes), writeFile(contentPath, detached)]);
    await execFileAsync(
      openssl,
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
      { windowsHide: true }
    );
    if (!(await readFile(verifiedPath)).equals(detached))
      throw new Error('PRODUCT_OPENSSL_CONTENT_MISMATCH');
  } finally {
    await rm(independentDirectory, { recursive: true, force: true });
  }

  if (certificationsAfterSecond !== certificationsAfterFirst)
    throw new Error('PRODUCT_PADES_DUPLICATE_CERTIFICATION_CREATED');
  const versionCertificationCount = await supabase
    .from('document_certifications')
    .select('id', { count: 'exact', head: true })
    .eq('document_id', document.id)
    .eq('document_version_id', first.documentVersionId);
  if (versionCertificationCount.error) throw versionCertificationCount.error;
  if (versionCertificationCount.count !== 1)
    throw new Error('PRODUCT_PADES_VERSION_CERTIFICATION_NOT_UNIQUE');
  const documentResult = await supabase
    .from('documentos')
    .select('sealed_pdf_path,sealed_pdf_hash')
    .eq('id', document.id)
    .single();
  if (
    documentResult.error ||
    documentResult.data?.sealed_pdf_path !== first.storagePath ||
    documentResult.data?.sealed_pdf_hash !== first.sha256
  ) {
    throw new Error('PRODUCT_FINAL_PDF_NOT_PROMOTED');
  }

  await mkdir(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, `docubox-real-${document.id}-pades-bb.pdf`);
  await writeFile(outputPath, finalBytes);

  console.log('Real Docubox document PAdES-B-B');
  console.log('--------------------------------');
  console.log(`Document: ${document.id}`);
  console.log(`Document version: ${first.documentVersionId}`);
  console.log(`Certification: ${first.certificationUuid}`);
  console.log('Final PDF downloadable: OK');
  console.log('PDF digital signature detected: OK');
  console.log('Internal verification: PASS');
  console.log('Independent verification: PASS');
  console.log('OpenSSL verification: PASS');
  console.log('One-byte mutation: FAIL as expected');
  console.log('document_certifications persistence: OK');
  console.log('Storage promotion after verification: OK');
  console.log('Idempotent retry: OK');
  console.log(`Output: ${outputPath}`);
  console.log('');
  console.log('REAL DOCUMENT PADES-B-B VERIFIED');
  if (process.env.CRYPTO_PROVIDER_MODE === 'production') {
    console.log('PRODUCTION PADES-B-B VERIFIED');
  }
} catch (error) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : error instanceof Error
        ? error.message
        : 'UNKNOWN_ERROR';
  console.error(`REAL DOCUMENT PADES-B-B FAILED: ${code}`);
  if (error instanceof Error && error.message && error.message !== code) {
    console.error(`Detail: ${error.message}`);
  }
  process.exitCode = 1;
} finally {
  await rm(cacheDirectory, { recursive: true, force: true });
}
