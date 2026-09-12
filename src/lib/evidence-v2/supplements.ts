import 'server-only';

import { canonicalizeRFC8785, sha256Hex } from '@/lib/certification/canonical';
import { createCertificationProviderSet } from '@/lib/certification/providers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { registerEvidenceSigningKey } from './trust-registry';

function esc(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type SupplementSource = {
  type: 'NOM151' | 'OPENTIMESTAMPS' | 'CERTIFICATION' | 'VERIFICATION';
  table: string;
  id: string;
  status: string;
  artifactBucket: string;
  artifactPath: string;
  artifactHash: string;
  mediaType: string;
  issuedAt?: string | null;
};

type SupplementPackageRow = {
  id: string;
  package_id: string;
  evidence_root_sha256: string;
  tenant_id: string;
  document_id: string;
  document_version_id: string;
};

export async function appendEvidenceSupplement(
  service: SupabaseClient,
  packageRow: SupplementPackageRow,
  source: SupplementSource
) {
  const existing = await service
    .from('evidence_supplements')
    .select('id')
    .eq('package_id', packageRow.id)
    .eq('supplement_type', source.type)
    .eq('source_table', source.table)
    .eq('source_record_id', source.id)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;
  const previous = await service
    .from('evidence_supplements')
    .select('sequence_number,supplement_sha256')
    .eq('package_id', packageRow.id)
    .order('sequence_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (previous.error) throw previous.error;
  const sequence = Number(previous.data?.sequence_number || 0) + 1;
  const createdAt = new Date().toISOString();
  const core = {
    schema: 'docubox-evidence-supplement-v1',
    base_package_id: packageRow.package_id,
    base_evidence_root: packageRow.evidence_root_sha256,
    sequence,
    type: source.type,
    source_table: source.table,
    source_record_id: source.id,
    source_status: source.status,
    artifact_sha256: source.artifactHash,
    issued_at: source.issuedAt || null,
    previous_supplement_sha256: previous.data?.supplement_sha256 || null,
    created_at: createdAt,
  };
  const canonical = canonicalizeRFC8785(core);
  const digest = sha256Hex(canonical);
  const signature = await createCertificationProviderSet().keyManagement.signDigest({
    purpose: 'EVIDENCE_SEAL',
    canonicalBytes: Buffer.from(canonical),
    digestSha256: digest,
    idempotencyKey: `evidence-supplement:${packageRow.id}:${sequence}:${source.id}`,
  });
  await registerEvidenceSigningKey(service, signature);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<EvidenceSupplement xmlns="https://docubox.com.mx/schema/evidence/v2" version="1.0" sequence="${sequence}">\n  <BasePackageID>${esc(packageRow.package_id)}</BasePackageID>\n  <BaseEvidenceRoot algoritmo="SHA-256">${esc(packageRow.evidence_root_sha256)}</BaseEvidenceRoot>\n  <Type>${source.type}</Type>\n  <Source table="${esc(source.table)}" ref="${esc(source.id)}" status="${esc(source.status)}"/>\n  <ArtifactSHA256 algoritmo="SHA-256">${source.artifactHash}</ArtifactSHA256>\n  <PreviousSupplementSHA256 algoritmo="SHA-256">${esc(previous.data?.supplement_sha256)}</PreviousSupplementSHA256>\n  <CoreDigest algoritmo="SHA-256" canonicalization="RFC8785">${digest}</CoreDigest>\n  <EvidenceSeal algorithm="${esc(signature.algorithm)}" keyId="${esc(signature.keyId)}" keyVersion="${esc(signature.keyVersion)}" fingerprint="${signature.publicKeyFingerprintSha256}" signedAt="${signature.signedAt}">${signature.signatureBase64}</EvidenceSeal>\n</EvidenceSupplement>`;
  const xmlHash = sha256Hex(xml);
  const path = `${packageRow.tenant_id}/${packageRow.document_id}/${packageRow.document_version_id}/evidence-v2/${packageRow.package_id}/supplements/${String(sequence).padStart(3, '0')}-${source.type.toLowerCase()}.xml`;
  const upload = await service.storage
    .from('evidence-v2-artifacts')
    .upload(path, Buffer.from(xml), { contentType: 'application/xml', upsert: false });
  if (upload.error) throw upload.error;
  const readBack = await service.storage.from('evidence-v2-artifacts').download(path);
  if (
    readBack.error ||
    !readBack.data ||
    sha256Hex(new Uint8Array(await readBack.data.arrayBuffer())) !== xmlHash
  ) {
    await service.storage.from('evidence-v2-artifacts').remove([path]);
    throw readBack.error || new Error('EVIDENCE_SUPPLEMENT_READBACK_FAILED');
  }
  const inserted = await service
    .from('evidence_supplements')
    .insert({
      package_id: packageRow.id,
      sequence_number: sequence,
      supplement_type: source.type,
      source_table: source.table,
      source_record_id: source.id,
      previous_supplement_sha256: previous.data?.supplement_sha256 || null,
      supplement_sha256: xmlHash,
      storage_path: path,
      source_artifact_bucket: source.artifactBucket,
      source_artifact_path: source.artifactPath,
      source_artifact_sha256: source.artifactHash,
      source_artifact_media_type: source.mediaType,
      docubox_signature: signature,
      created_at: createdAt,
    })
    .select('id')
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data;
}

export async function synchronizeEvidenceSupplementsForDocument(
  service: SupabaseClient,
  documentId: string
) {
  const packageResult = await service
    .from('evidence_packages')
    .select('*')
    .eq('document_id', documentId)
    .eq('schema_version', '2.1')
    .not('closed_at', 'is', null)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (packageResult.error || !packageResult.data) return [];
  const [nom, ots, baseArtifacts] = await Promise.all([
    service
      .from('nom151_constancias_doc')
      .select(
        'id,status,verification_status,constancia_sha256,constancia_storage_path,constancia_path,issued_at'
      )
      .eq('documento_id', documentId)
      .eq('verification_status', 'verified')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    service
      .from('document_blockchain_evidence')
      .select('id,status,proof_sha256,proof_storage_path,verified_at,anchored_at')
      .eq('document_id', documentId)
      .eq('status', 'VERIFIED')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    service
      .from('evidence_package_artifacts')
      .select('source_table,source_record_id')
      .eq('package_id', packageResult.data.id),
  ]);
  if (nom.error || ots.error || baseArtifacts.error)
    throw nom.error || ots.error || baseArtifacts.error;
  const includedSources = new Set(
    (baseArtifacts.data || []).map(
      (artifact) => `${artifact.source_table || ''}:${artifact.source_record_id || ''}`
    )
  );
  const created = [];
  if (
    nom.data?.constancia_sha256 &&
    (nom.data.constancia_storage_path || nom.data.constancia_path) &&
    !includedSources.has(`nom151_constancias_doc:${nom.data.id}`)
  ) {
    created.push(
      await appendEvidenceSupplement(service, packageResult.data, {
        type: 'NOM151',
        table: 'nom151_constancias_doc',
        id: nom.data.id,
        status: 'verified',
        artifactBucket: 'nom151-constancias',
        artifactPath: nom.data.constancia_storage_path || nom.data.constancia_path,
        artifactHash: nom.data.constancia_sha256,
        mediaType: 'application/timestamp-reply',
        issuedAt: nom.data.issued_at,
      })
    );
  }
  if (
    ots.data?.proof_sha256 &&
    ots.data.proof_storage_path &&
    !includedSources.has(`document_blockchain_evidence:${ots.data.id}`)
  ) {
    created.push(
      await appendEvidenceSupplement(service, packageResult.data, {
        type: 'OPENTIMESTAMPS',
        table: 'document_blockchain_evidence',
        id: ots.data.id,
        status: 'verified_bitcoin',
        artifactBucket: 'blockchain-evidence',
        artifactPath: ots.data.proof_storage_path,
        artifactHash: ots.data.proof_sha256,
        mediaType: 'application/vnd.opentimestamps.ots',
        issuedAt: ots.data.verified_at || ots.data.anchored_at,
      })
    );
  }
  const expected: string[] = Array.isArray(
    packageResult.data.verification_summary?.readiness?.pendingSupplements
  )
    ? packageResult.data.verification_summary.readiness.pendingSupplements.map(String)
    : [];
  if (expected.length > 0) {
    const supplements = await service
      .from('evidence_supplements')
      .select('supplement_type')
      .eq('package_id', packageResult.data.id);
    if (supplements.error) throw supplements.error;
    const available = new Set((supplements.data || []).map((row) => String(row.supplement_type)));
    if (expected.every((type) => available.has(type))) {
      const finalized = await service
        .from('evidence_finalizations')
        .update({
          state: 'EVIDENCE_READY',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('package_id', packageResult.data.id)
        .eq('state', 'EVIDENCE_READY_WITH_PENDING_SUPPLEMENTS');
      if (finalized.error) throw finalized.error;
    }
  }
  return created;
}

export async function processPendingEvidenceSupplements(service: SupabaseClient, limit = 20) {
  const packages = await service
    .from('evidence_packages')
    .select('document_id')
    .eq('schema_version', '2.1')
    .not('closed_at', 'is', null)
    .order('generated_at', { ascending: false })
    .limit(limit);
  if (packages.error) throw packages.error;
  for (const row of packages.data || [])
    await synchronizeEvidenceSupplementsForDocument(service, row.document_id);
}
