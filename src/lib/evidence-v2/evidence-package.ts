import 'server-only';

import archiver from 'archiver';
import { createHash } from 'node:crypto';
import { PassThrough, Readable, Transform } from 'node:stream';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createEvidenceManifest, evidenceReadme } from './package-manifest';

type PackageFile = {
  path: string;
  mediaType: string;
  size: number;
  sha256: string;
  relation: string;
  storageBucket: string;
  storagePath: string;
};

function artifactFile(
  artifact: Record<string, unknown>
): Pick<PackageFile, 'path' | 'mediaType' | 'relation'> {
  const id = String(artifact.id);
  switch (artifact.artifact_type) {
    case 'pades_pdf':
      return {
        path: '01-documento/documento-firmado.pdf',
        mediaType: 'application/pdf',
        relation: 'final_signed_document',
      };
    case 'nom151_constancia':
      return {
        path: `03-constancias/nom151-${id}.tst`,
        mediaType: 'application/timestamp-reply',
        relation: 'nom151_constancia',
      };
    case 'verification_report':
      return {
        path: `03-constancias/constancia-firma-${id}.pdf`,
        mediaType: 'application/pdf',
        relation: 'signature_certificate',
      };
    case 'rfc3161_token':
      return {
        path: `04-tiempo/timestamp-rfc3161-${id}.tst`,
        mediaType: 'application/timestamp-reply',
        relation: 'rfc3161_timestamp',
      };
    case 'opentimestamps_proof':
      return {
        path: `04-tiempo/opentimestamps-${id}.ots`,
        mediaType: 'application/vnd.opentimestamps.ots',
        relation: 'opentimestamps_proof',
      };
    case 'certificate':
      return {
        path: `05-certificados/certificado-${id}.pem`,
        mediaType: 'application/x-pem-file',
        relation: 'certificate',
      };
    case 'autograph_signature_image':
      return {
        path: `06-firmas/autografas/firma-${id}.png`,
        mediaType: 'image/png',
        relation: 'autograph_image',
      };
    case 'autograph_signature_strokes':
      return {
        path: `06-firmas/autografas/trazos-${id}.json`,
        mediaType: 'application/json',
        relation: 'autograph_strokes',
      };
    case 'efirma_signature_bundle':
      return {
        path: `06-firmas/efirma/firma-${id}.json`,
        mediaType: 'application/json',
        relation: 'efirma_bundle',
      };
    default:
      return {
        path: `05-certificados/artefacto-${id}.bin`,
        mediaType: 'application/octet-stream',
        relation: String(artifact.artifact_type),
      };
  }
}

async function signedSource(service: SupabaseClient, file: PackageFile) {
  const signed = await service.storage
    .from(file.storageBucket)
    .createSignedUrl(file.storagePath, 300);
  if (signed.error || !signed.data?.signedUrl)
    throw signed.error || new Error('EVIDENCE_PACKAGE_SIGNED_URL_FAILED');
  const response = await fetch(signed.data.signedUrl, { cache: 'no-store' });
  if (!response.ok || !response.body) throw new Error('EVIDENCE_PACKAGE_ARTIFACT_READ_FAILED');
  file.size = Number(response.headers.get('content-length') || file.size || 0);
  const hasher = createHash('sha256');
  let actualSize = 0;
  const integrity = new Transform({
    transform(chunk, _encoding, callback) {
      const bytes = Buffer.from(chunk);
      hasher.update(bytes);
      actualSize += bytes.length;
      callback(null, bytes);
    },
    flush(callback) {
      const actualHash = hasher.digest('hex');
      if (actualHash !== file.sha256 || (file.size > 0 && actualSize !== file.size)) {
        callback(new Error(`EVIDENCE_PACKAGE_INTEGRITY_FAILED:${file.path}`));
        return;
      }
      callback();
    },
  });
  return Readable.fromWeb(response.body as never).pipe(integrity);
}

export async function createEvidencePackageZipStream(service: SupabaseClient, documentId: string) {
  const packageResult = await service
    .from('evidence_packages')
    .select('*')
    .eq('document_id', documentId)
    .not('closed_at', 'is', null)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (packageResult.error || !packageResult.data)
    throw packageResult.error || new Error('EVIDENCE_PACKAGE_NOT_READY');
  const [artifactsResult, supplementsResult] = await Promise.all([
    service
      .from('evidence_package_artifacts')
      .select('*')
      .eq('package_id', packageResult.data.id)
      .order('created_at'),
    service
      .from('evidence_supplements')
      .select('*')
      .eq('package_id', packageResult.data.id)
      .order('sequence_number'),
  ]);
  if (artifactsResult.error || supplementsResult.error)
    throw artifactsResult.error || supplementsResult.error;

  const files: PackageFile[] = [
    {
      path: '02-evidencia/evidencia.xml',
      mediaType: 'application/xml',
      size: 0,
      sha256: packageResult.data.xml_sha256,
      relation: 'base_evidence_xml',
      storageBucket: packageResult.data.xml_storage_bucket,
      storagePath: packageResult.data.xml_storage_path,
    },
  ];
  for (const artifact of artifactsResult.data || []) {
    files.push({
      ...artifactFile(artifact),
      size: Number(artifact.size_bytes || 0),
      sha256: artifact.object_sha256,
      storageBucket: artifact.storage_bucket,
      storagePath: artifact.storage_path,
    });
  }
  for (const supplement of supplementsResult.data || []) {
    if (supplement.source_artifact_path && supplement.source_artifact_sha256) {
      const sourcePath =
        supplement.supplement_type === 'NOM151'
          ? `03-constancias/nom151-supplement-${supplement.id}.tst`
          : `04-tiempo/opentimestamps-supplement-${supplement.id}.ots`;
      files.push({
        path: sourcePath,
        mediaType: supplement.source_artifact_media_type || 'application/octet-stream',
        size: 0,
        sha256: supplement.source_artifact_sha256,
        relation: `supplement_source_${String(supplement.supplement_type).toLowerCase()}`,
        storageBucket: supplement.source_artifact_bucket,
        storagePath: supplement.source_artifact_path,
      });
    }
    files.push({
      path: `07-suplementos/supplement-${String(supplement.sequence_number).padStart(3, '0')}.xml`,
      mediaType: 'application/xml',
      size: 0,
      sha256: supplement.supplement_sha256,
      relation: `supplement_${String(supplement.supplement_type).toLowerCase()}`,
      storageBucket: supplement.storage_bucket,
      storagePath: supplement.storage_path,
    });
  }

  const output = new PassThrough();
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (error) => output.destroy(error));
  archive.pipe(output);
  for (const file of files) archive.append(await signedSource(service, file), { name: file.path });
  const manifest = createEvidenceManifest({
    documentId,
    packageRow: packageResult.data,
    files: files.map(({ path, mediaType, size, sha256, relation }) => ({
      path,
      mediaType,
      size,
      sha256,
      relation,
    })),
    supplements: supplementsResult.data || [],
  });
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
  archive.append(evidenceReadme(), { name: 'README.txt' });
  void archive.finalize();
  return {
    stream: Readable.toWeb(output) as ReadableStream,
    package: packageResult.data,
    manifest,
  };
}
