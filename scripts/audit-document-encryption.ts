import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

type Classification =
  | 'ENCRYPTED'
  | 'PLAINTEXT_ELIGIBLE'
  | 'PLAINTEXT_NOT_ELIGIBLE'
  | 'CORRUPT'
  | 'ORPHAN'
  | 'DUPLICATE'
  | 'HISTORICAL_ARTIFACT'
  | 'UNKNOWN_REQUIRES_REVIEW'
  | 'MISSING';

type Reference = {
  source: 'documentos' | 'document_versions' | 'document_certifications' | 'nom151';
  documentId: string;
  documentVersionId: string | null;
  tenantId: string | null;
  ownerId: string | null;
  artifactKind: 'document' | 'visual_pdf' | 'signed_pdf' | 'evidence';
  expectedSha256: string | null;
  active: boolean;
};

type StorageFile = { path: string; size: number | null; mimeType: string | null };

type DocumentRow = {
  id: string;
  documento_id: string | null;
  owner_id: string | null;
  workspace_id: string | null;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  storage_path: string | null;
  file_hash_sha256: string | null;
  sealed_pdf_path: string | null;
  sealed_pdf_hash: string | null;
  deleted_at: string | null;
  estado: string | null;
};

type VersionRow = {
  id: string;
  document_id: string;
  workspace_id: string | null;
  storage_path: string | null;
  sha256: string | null;
  version_number: number;
};

type CertificationRow = {
  document_id: string;
  document_version_id: string | null;
  tenant_id: string | null;
  source_storage_bucket: string | null;
  source_storage_path: string | null;
  source_document_hash: string | null;
  certified_pdf_path: string | null;
  certified_pdf_sha256: string | null;
};

type Nom151Row = {
  documento_id: string;
  document_version_id: string | null;
  source_storage_bucket: string | null;
  source_storage_path: string | null;
  document_digest: string | null;
};

type EncryptionMetadataRow = {
  id: string;
  tenant_id: string;
  document_id: string;
  document_version_id: string;
  artifact_kind: string;
  storage_path: string;
  encryption_version: string;
  encryption_algorithm: string;
  ciphertext_sha256: string;
  plaintext_sha256: string;
  kms_provider: string;
  kms_key_version: string;
  status: string;
};

type InventoryObject = {
  storage_bucket: 'documents';
  storage_path: string;
  byte_size: number | null;
  physical_mime_type: string | null;
  physical_signature: 'PDF' | 'ENCRYPTED_BINARY' | 'OTHER_BINARY' | 'MISSING';
  physical_sha256: string | null;
  classification: Classification;
  reason_codes: string[];
  references: Reference[];
  encryption: EncryptionMetadataRow | Record<string, unknown> | null;
};

function option(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || null;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function validSha256(value: unknown): value is string {
  return /^[0-9a-f]{64}$/i.test(String(value || ''));
}

function isPdf(bytes: Uint8Array) {
  return Buffer.from(bytes).subarray(0, 5).toString('ascii') === '%PDF-';
}

async function fetchAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
) {
  const rows: T[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    if (page.error) throw page.error;
    rows.push(...(page.data || []));
    if ((page.data || []).length < pageSize) return rows;
  }
}

async function listStorageFiles(service: SupabaseClient) {
  const pending = [''];
  const files: StorageFile[] = [];
  const pageSize = 100;
  while (pending.length) {
    const prefix = pending.pop() || '';
    let offset = 0;
    while (true) {
      const page = await service.storage
        .from('documents')
        .list(prefix, { limit: pageSize, offset, sortBy: { column: 'name', order: 'asc' } });
      if (page.error) throw page.error;
      for (const item of page.data || []) {
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id || item.metadata) {
          const metadata = (item.metadata || {}) as Record<string, unknown>;
          files.push({
            path,
            size: Number.isFinite(Number(metadata.size)) ? Number(metadata.size) : null,
            mimeType:
              typeof metadata.mimetype === 'string'
                ? metadata.mimetype
                : typeof metadata.contentType === 'string'
                  ? metadata.contentType
                  : null,
          });
        } else {
          pending.push(path);
        }
      }
      if ((page.data || []).length < pageSize) break;
      offset += pageSize;
    }
  }
  return files;
}

const service = createClient(
  required('NEXT_PUBLIC_SUPABASE_URL'),
  required('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } }
);
const tenantFilter = option('tenant');
const documentFilter = option('document');
const outputPath = option('output');
const summaryOnly = process.argv.includes('--summary');

const documents = await fetchAll<DocumentRow>((from, to) => {
  let query = service
    .from('documentos')
    .select(
      'id,documento_id,owner_id,workspace_id,file_name,file_type,file_size,storage_path,file_hash_sha256,sealed_pdf_path,sealed_pdf_hash,deleted_at,estado'
    )
    .order('id', { ascending: true })
    .range(from, to);
  if (tenantFilter) query = query.eq('workspace_id', tenantFilter);
  if (documentFilter) query = query.or(`id.eq.${documentFilter},documento_id.eq.${documentFilter}`);
  return query;
});
const documentById = new Map(documents.map((row) => [row.id, row]));
const documentIds = [...documentById.keys()];

const versions = documentIds.length
  ? await fetchAll<VersionRow>((from, to) =>
      service
        .from('document_versions')
        .select('id,document_id,workspace_id,storage_path,sha256,version_number')
        .in('document_id', documentIds)
        .order('version_number', { ascending: false })
        .range(from, to)
    )
  : [];
const versionsByDocument = new Map<string, VersionRow[]>();
for (const version of versions) {
  versionsByDocument.set(version.document_id, [
    ...(versionsByDocument.get(version.document_id) || []),
    version,
  ]);
}

const [certifications, nom151Rows, metadataRows] = await Promise.all([
  fetchAll<CertificationRow>((from, to) =>
    service
      .from('document_certifications')
      .select(
        'document_id,document_version_id,tenant_id,source_storage_bucket,source_storage_path,source_document_hash,certified_pdf_path,certified_pdf_sha256'
      )
      .range(from, to)
  ),
  fetchAll<Nom151Row>((from, to) =>
    service
      .from('nom151_constancias_doc')
      .select(
        'documento_id,document_version_id,source_storage_bucket,source_storage_path,document_digest'
      )
      .range(from, to)
  ),
  fetchAll<EncryptionMetadataRow>((from, to) =>
    service
      .from('document_encryption_metadata')
      .select(
        'id,tenant_id,document_id,document_version_id,artifact_kind,storage_path,encryption_version,encryption_algorithm,ciphertext_sha256,plaintext_sha256,kms_provider,kms_key_version,status'
      )
      .eq('storage_bucket', 'documents')
      .eq('status', 'active')
      .range(from, to)
  ),
]);

const references = new Map<string, Reference[]>();
function addReference(path: unknown, reference: Reference) {
  const normalized = String(path || '').trim();
  if (!normalized) return;
  references.set(normalized, [...(references.get(normalized) || []), reference]);
}

for (const document of documents) {
  const active = !document.deleted_at;
  const base = {
    source: 'documentos' as const,
    documentId: document.id,
    documentVersionId: null,
    tenantId: document.workspace_id,
    ownerId: document.owner_id,
    active,
  };
  addReference(document.storage_path, {
    ...base,
    artifactKind: 'document',
    expectedSha256: document.file_hash_sha256,
  });
  addReference(document.sealed_pdf_path, {
    ...base,
    artifactKind: 'signed_pdf',
    expectedSha256: document.sealed_pdf_hash,
  });
}

for (const version of versions) {
  const document = documentById.get(version.document_id);
  if (!document) continue;
  addReference(version.storage_path, {
    source: 'document_versions',
    documentId: version.document_id,
    documentVersionId: version.id,
    tenantId: version.workspace_id,
    ownerId: document.owner_id,
    artifactKind: 'visual_pdf',
    expectedSha256: version.sha256,
    active: !document.deleted_at,
  });
}

for (const certification of certifications) {
  const document = documentById.get(certification.document_id);
  const reference = {
    source: 'document_certifications' as const,
    documentId: certification.document_id,
    documentVersionId: certification.document_version_id,
    tenantId: certification.tenant_id || document?.workspace_id || null,
    ownerId: document?.owner_id || null,
    active: false,
  };
  if (certification.source_storage_bucket === 'documents') {
    addReference(certification.source_storage_path, {
      ...reference,
      artifactKind: 'evidence',
      expectedSha256: certification.source_document_hash,
    });
  }
}

for (const row of nom151Rows) {
  if (row.source_storage_bucket !== 'documents') continue;
  const document = documentById.get(row.documento_id);
  addReference(row.source_storage_path, {
    source: 'nom151',
    documentId: row.documento_id,
    documentVersionId: row.document_version_id,
    tenantId: document?.workspace_id || null,
    ownerId: document?.owner_id || null,
    artifactKind: 'evidence',
    expectedSha256: row.document_digest,
    active: false,
  });
}

const metadataByPath = new Map(metadataRows.map((row) => [row.storage_path, row]));
const storageFiles =
  tenantFilter || documentFilter
    ? (await listStorageFiles(service)).filter((file) => references.has(file.path))
    : await listStorageFiles(service);
const physicalPaths = new Set(storageFiles.map((file) => file.path));
const objects: InventoryObject[] = [];

for (const file of storageFiles) {
  const stored = await service.storage.from('documents').download(file.path);
  if (stored.error || !stored.data) continue;
  const bytes = Buffer.from(await stored.data.arrayBuffer());
  const startsWithPdf = isPdf(bytes);
  const physicalSha256 = sha256(bytes);
  const refs = references.get(file.path) || [];
  const activeRefs = refs.filter((reference) => reference.active);
  const historicalRefs = refs.filter((reference) => !reference.active);
  const metadata = metadataByPath.get(file.path) || null;
  let classification: Classification;
  const reasonCodes: string[] = [];

  if (metadata) {
    classification =
      !startsWithPdf && physicalSha256 === metadata.ciphertext_sha256 ? 'ENCRYPTED' : 'CORRUPT';
    if (classification === 'CORRUPT') reasonCodes.push('ENCRYPTED_OBJECT_INTEGRITY_MISMATCH');
  } else if (activeRefs.length) {
    const expectedHashes = activeRefs
      .map((reference) => reference.expectedSha256?.toLowerCase())
      .filter(validSha256);
    if (!startsWithPdf || !expectedHashes.includes(physicalSha256)) {
      classification = 'CORRUPT';
      reasonCodes.push(startsWithPdf ? 'REGISTERED_SHA256_MISMATCH' : 'ACTIVE_OBJECT_NOT_PDF');
    } else {
      const documentIdsForPath = new Set(activeRefs.map((reference) => reference.documentId));
      const tenantIds = new Set(activeRefs.map((reference) => reference.tenantId).filter(Boolean));
      const documentId = activeRefs[0]?.documentId;
      const document = documentId ? documentById.get(documentId) : null;
      const candidateVersions = documentId ? versionsByDocument.get(documentId) || [] : [];
      if (documentIdsForPath.size !== 1) reasonCodes.push('AMBIGUOUS_DOCUMENT_ASSOCIATION');
      if (tenantIds.size !== 1 || !document?.workspace_id)
        reasonCodes.push('TENANT_ASSOCIATION_INVALID');
      if (!document?.owner_id) reasonCodes.push('OWNER_REQUIRED_FOR_APPLICATION_VALIDATION');
      if (!candidateVersions.length) reasonCodes.push('DOCUMENT_VERSION_REQUIRED');
      if (expectedHashes.some((hash) => hash !== physicalSha256)) {
        reasonCodes.push('REFERENCE_HASH_CONFLICT');
      }
      classification = reasonCodes.length ? 'PLAINTEXT_NOT_ELIGIBLE' : 'PLAINTEXT_ELIGIBLE';
    }
  } else if (historicalRefs.length) {
    classification = 'HISTORICAL_ARTIFACT';
    reasonCodes.push('HISTORICAL_REFERENCE_ONLY');
  } else if (startsWithPdf) {
    classification = 'ORPHAN';
    reasonCodes.push('NO_DATABASE_REFERENCE');
  } else {
    classification = 'UNKNOWN_REQUIRES_REVIEW';
    reasonCodes.push('UNREFERENCED_NON_PDF_OBJECT');
  }

  bytes.fill(0);
  objects.push({
    storage_bucket: 'documents',
    storage_path: file.path,
    byte_size: file.size,
    physical_mime_type: file.mimeType,
    physical_signature: startsWithPdf ? 'PDF' : metadata ? 'ENCRYPTED_BINARY' : 'OTHER_BINARY',
    physical_sha256: physicalSha256,
    classification,
    reason_codes: reasonCodes,
    references: refs,
    encryption: metadata
      ? {
          id: metadata.id,
          encryption_version: metadata.encryption_version,
          encryption_algorithm: metadata.encryption_algorithm,
          ciphertext_sha256: metadata.ciphertext_sha256,
          plaintext_sha256: metadata.plaintext_sha256,
          kms_provider: metadata.kms_provider,
          kms_key_version: metadata.kms_key_version,
          status: metadata.status,
        }
      : null,
  });
}

const objectsByHash = new Map<string, InventoryObject[]>();
for (const object of objects) {
  if (!object.physical_sha256) continue;
  objectsByHash.set(object.physical_sha256, [
    ...(objectsByHash.get(object.physical_sha256) || []),
    object,
  ]);
}
for (const object of objects) {
  if (object.classification !== 'ORPHAN' || !object.physical_sha256) continue;
  const matches = objectsByHash.get(object.physical_sha256) || [];
  if (matches.length > 1) {
    object.classification = 'DUPLICATE';
    object.reason_codes = ['CONTENT_DUPLICATES_ANOTHER_STORAGE_OBJECT'];
  }
}

for (const [path, refs] of references) {
  if (physicalPaths.has(path)) continue;
  const activeRefs = refs.filter((reference) => reference.active);
  const metadata = metadataByPath.get(path) || null;
  if (!activeRefs.length && !metadata) continue;
  objects.push({
    storage_bucket: 'documents',
    storage_path: path,
    byte_size: null,
    physical_mime_type: null,
    physical_signature: 'MISSING',
    physical_sha256: null,
    classification: 'MISSING' satisfies Classification,
    reason_codes: ['REFERENCED_OBJECT_MISSING'],
    references: activeRefs,
    encryption: metadata,
  });
}

const counts = objects.reduce<Record<string, number>>((accumulator, object) => {
  accumulator[object.classification] = (accumulator[object.classification] || 0) + 1;
  return accumulator;
}, {});
const migrationManifest = objects
  .filter((object) => object.classification === 'PLAINTEXT_ELIGIBLE')
  .map((object) => {
    const activeRefs = object.references.filter((reference) => reference.active);
    const primary =
      activeRefs.find((reference) => reference.source === 'documentos') || activeRefs[0];
    if (!primary || !object.physical_sha256) {
      throw new Error('MIGRATION_MANIFEST_REFERENCE_INVALID');
    }
    const versionsForDocument = versionsByDocument.get(primary.documentId) || [];
    const pathVersion = activeRefs.find((reference) => reference.documentVersionId);
    const selectedVersion =
      versionsForDocument.find((version) => version.id === pathVersion?.documentVersionId) ||
      versionsForDocument[0];
    if (!selectedVersion) throw new Error('MIGRATION_MANIFEST_VERSION_INVALID');
    const artifactKind = activeRefs.some((reference) => reference.artifactKind === 'document')
      ? 'document'
      : activeRefs.some((reference) => reference.artifactKind === 'signed_pdf')
        ? 'signed_pdf'
        : 'visual_pdf';
    return {
      document_id: primary.documentId,
      document_version_id: selectedVersion.id,
      tenant_id: primary.tenantId,
      actor_user_id: primary.ownerId,
      source_bucket: 'documents',
      source_path: object.storage_path,
      physical_sha256: object.physical_sha256,
      registered_sha256: primary.expectedSha256,
      byte_size: object.byte_size,
      artifact_kind: artifactKind,
      target_encrypted_path: `tenants/${primary.tenantId}/documents/${primary.documentId}/versions/${selectedVersion.id}/legacy/${artifactKind}-${object.physical_sha256.slice(0, 16)}.enc`,
      status: 'MIGRATION_ELIGIBLE',
      pointer_sources: [...new Set(activeRefs.map((reference) => reference.source))],
    };
  });

const report = {
  generated_at: new Date().toISOString(),
  mode: 'READ_ONLY_PHYSICAL_INVENTORY',
  counts,
  physical_objects: storageFiles.length,
  referenced_paths: references.size,
  metadata_records: metadataRows.length,
  migration_manifest: migrationManifest,
  objects,
};

if (outputPath) {
  const absolute = resolve(outputPath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

console.info(
  JSON.stringify(
    summaryOnly
      ? {
          generated_at: report.generated_at,
          mode: report.mode,
          counts,
          physical_objects: report.physical_objects,
          referenced_paths: report.referenced_paths,
          metadata_records: report.metadata_records,
          migration_eligible: migrationManifest.length,
          output: outputPath || null,
        }
      : report,
    null,
    2
  )
);
