import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { build } from 'esbuild';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const cacheDirectory = join(process.cwd(), 'node_modules', '.cache', 'docubox-real-nom151');
const bundlePath = join(cacheDirectory, 'real-nom151.cjs');

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function loadRuntime() {
  await mkdir(cacheDirectory, { recursive: true });
  await build({
    stdin: {
      contents: [
        "export { issueNom151ForVerifiedPadesBt, revalidateNom151 } from './src/lib/nom151/service';",
        "export { createNom151Provider } from './src/lib/nom151/provider';",
      ].join('\n'),
      resolveDir: process.cwd(),
      sourcefile: 'real-nom151-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    external: ['@supabase/supabase-js'],
    plugins: [
      {
        name: 'server-only-test-shim',
        setup(context) {
          context.onResolve({ filter: /^server-only$/ }, () => ({
            path: 'server-only',
            namespace: 'docubox-test-shim',
          }));
          context.onLoad({ filter: /.*/, namespace: 'docubox-test-shim' }, () => ({
            contents: 'export {};',
            loader: 'js',
          }));
        },
      },
    ],
    logLevel: 'silent',
  });
  return createRequire(import.meta.url)(bundlePath);
}

function mutate(bytes: Uint8Array) {
  const changed = new Uint8Array(bytes);
  const index = Math.max(0, Math.floor(changed.byteLength / 2));
  changed[index] ^= 0x01;
  return changed;
}

try {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('SUPABASE_SERVER_CONFIGURATION_MISSING');
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const runtime = await loadRuntime();

  const certifications = await supabase
    .from('document_certifications')
    .select(
      'id,document_id,document_version_id,certified_pdf_path,certified_pdf_sha256,pades_verified_at'
    )
    .eq('status', 'COMPLETED')
    .eq('execution_status', 'completed')
    .eq('pades_profile', 'PAdES-B-T')
    .eq('pdf_signature_status', 'valid')
    .eq('certificate_status', 'valid')
    .eq('timestamp_status', 'valid')
    .eq('verification_status', 'valid')
    .not('certified_pdf_path', 'is', null)
    .order('pades_verified_at', { ascending: false })
    .limit(20);
  if (certifications.error) throw certifications.error;
  if (!certifications.data?.length) throw new Error('VERIFIED_PADES_BT_DOCUMENT_NOT_FOUND');

  let selected: NonNullable<typeof certifications.data>[number] | null = null;
  let ownerId = '';
  for (const candidate of certifications.data) {
    const document = await supabase
      .from('documentos')
      .select('owner_id')
      .eq('id', candidate.document_id)
      .maybeSingle();
    if (!document.error && document.data?.owner_id) {
      selected = candidate;
      ownerId = document.data.owner_id;
      break;
    }
  }
  if (!selected || !ownerId) throw new Error('VERIFIED_PADES_BT_OWNER_NOT_FOUND');

  const first = await runtime.issueNom151ForVerifiedPadesBt(supabase, {
    documentId: selected.document_id,
    requestedBy: ownerId,
  });
  if (!first.verification?.valid) throw new Error('NOM151_INDEPENDENT_VERIFICATION_FAILED');
  if (!first.verification.digestBindingValid) throw new Error('NOM151_DIGEST_BINDING_FAILED');
  if (!first.verification.cmsSignatureValid) throw new Error('NOM151_CMS_SIGNATURE_FAILED');
  if (!first.verification.certificateValid) throw new Error('NOM151_CERTIFICATE_VALIDITY_FAILED');

  const row = await supabase
    .from('nom151_constancias_doc')
    .select('*')
    .eq('id', first.recordId)
    .single();
  if (row.error || !row.data) throw row.error || new Error('NOM151_RECORD_NOT_FOUND');
  if (row.data.document_certification_id !== selected.id)
    throw new Error('NOM151_PADES_LINK_MISMATCH');
  if (row.data.document_version_id !== selected.document_version_id)
    throw new Error('NOM151_VERSION_LINK_MISMATCH');
  if (row.data.document_digest !== selected.certified_pdf_sha256)
    throw new Error('NOM151_PERSISTED_DIGEST_MISMATCH');
  if (row.data.verification_status !== 'verified')
    throw new Error('NOM151_NOT_PERSISTED_AS_VERIFIED');

  const [artifactDownload, pdfDownload] = await Promise.all([
    supabase.storage.from('nom151-constancias').download(row.data.constancia_path),
    supabase.storage.from('certification-artifacts').download(selected.certified_pdf_path),
  ]);
  if (artifactDownload.error || !artifactDownload.data)
    throw artifactDownload.error || new Error('NOM151_ARTIFACT_NOT_FOUND');
  if (pdfDownload.error || !pdfDownload.data)
    throw pdfDownload.error || new Error('NOM151_SOURCE_PDF_NOT_FOUND');
  const artifact = new Uint8Array(await artifactDownload.data.arrayBuffer());
  const pdf = new Uint8Array(await pdfDownload.data.arrayBuffer());
  if (sha256(artifact) !== row.data.constancia_sha256)
    throw new Error('NOM151_ARTIFACT_HASH_MISMATCH');
  if (sha256(pdf) !== row.data.document_digest) throw new Error('NOM151_SOURCE_HASH_MISMATCH');

  const provider = runtime.createNom151Provider();
  const alteredPdf = await provider.verifyArtifact(artifact, mutate(pdf), row.data.document_digest);
  if (alteredPdf.valid || alteredPdf.digestBindingValid)
    throw new Error('NOM151_ALTERED_PDF_NOT_DETECTED');
  const alteredArtifact = await provider.verifyArtifact(
    mutate(artifact),
    pdf,
    row.data.document_digest
  );
  if (alteredArtifact.valid) throw new Error('NOM151_ALTERED_ARTIFACT_NOT_DETECTED');

  const revalidated = await runtime.revalidateNom151(supabase, first.recordId, provider);
  if (!revalidated.valid) throw new Error('NOM151_REVALIDATION_FAILED');
  if (!revalidated.verification.rootTrusted) throw new Error('NOM151_UNTRUSTED_ROOT');
  if (revalidated.verification.chainValid !== true) throw new Error('NOM151_CHAIN_INVALID');
  if (!revalidated.verification.certificateProfileValid) {
    throw new Error('NOM151_SIGNING_CERT_INVALID');
  }
  if (!revalidated.verification.tstPolicyValid) throw new Error('NOM151_TST_POLICY_INVALID');

  const persistedTrust = await supabase
    .from('nom151_constancias_doc')
    .select(
      'environment,production_trusted,trust_bundle_version,trust_root_fingerprint,chain_fingerprints,certificate_key_usage,certificate_extended_key_usage,certificate_policy_oids,tst_policy_oid'
    )
    .eq('id', first.recordId)
    .single();
  if (persistedTrust.error || !persistedTrust.data) {
    throw persistedTrust.error || new Error('NOM151_TRUST_EVIDENCE_NOT_FOUND');
  }
  if (!persistedTrust.data.trust_bundle_version || !persistedTrust.data.trust_root_fingerprint) {
    throw new Error('NOM151_TRUST_EVIDENCE_INCOMPLETE');
  }

  const second = await runtime.issueNom151ForVerifiedPadesBt(
    supabase,
    { documentId: selected.document_id, requestedBy: ownerId },
    provider
  );
  if (!second.alreadyIssued || second.recordId !== first.recordId) {
    throw new Error('NOM151_IDEMPOTENCY_FAILED');
  }
  const duplicateCount = await supabase
    .from('nom151_constancias_doc')
    .select('id', { count: 'exact', head: true })
    .eq('documento_id', selected.document_id)
    .eq('document_version_id', selected.document_version_id)
    .eq('document_digest', selected.certified_pdf_sha256)
    .eq('provider', 'nubarium-nom151')
    .in('status', ['processing', 'issued']);
  if (duplicateCount.error) throw duplicateCount.error;
  if (duplicateCount.count !== 1) throw new Error('NOM151_DUPLICATE_RECORD_DETECTED');

  const resultEnvironment = revalidated.environment || first.environment;
  const productionTrusted = revalidated.productionTrusted === true;
  const result =
    productionTrusted && resultEnvironment === 'production'
      ? 'REAL DOCUMENT NOM151 VERIFIED'
      : resultEnvironment === 'sandbox'
        ? 'REAL DOCUMENT NOM151 SANDBOX VERIFIED'
        : 'NOM151_PROVIDER_NOT_PRODUCTION';
  console.info(
    JSON.stringify(
      {
        result,
        document_id: selected.document_id,
        document_version_id: selected.document_version_id,
        certification_id: selected.id,
        nom151_record_id: first.recordId,
        environment: resultEnvironment,
        production_trusted: productionTrusted,
        artifact_format: row.data.artifact_format,
        digest_binding_valid: first.verification.digestBindingValid,
        cms_signature_valid: first.verification.cmsSignatureValid,
        certificate_valid_at_issuance: first.verification.certificateValid,
        certificate_profile_valid: revalidated.verification.certificateProfileValid,
        key_usage: revalidated.verification.certificateKeyUsages,
        extended_key_usage_oids: revalidated.verification.certificateExtendedKeyUsageOids,
        certificate_policy_oids: revalidated.verification.certificatePolicyOids,
        tst_policy_oid: revalidated.verification.policyOid,
        chain_status: revalidated.verification.chainStatus,
        root_trusted: revalidated.verification.rootTrusted,
        trust_bundle_version: persistedTrust.data.trust_bundle_version,
        trust_root_fingerprint: persistedTrust.data.trust_root_fingerprint,
        altered_pdf_detected: !alteredPdf.valid,
        altered_artifact_detected: !alteredArtifact.valid,
        revalidation_valid: revalidated.valid,
        idempotent_retry: second.alreadyIssued,
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
