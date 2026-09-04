import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

type InventoryObject = {
  storage_bucket: 'documents';
  storage_path: string;
  byte_size: number;
  physical_mime_type: string | null;
  physical_signature: string;
  physical_sha256: string;
  classification: 'ORPHAN' | 'HISTORICAL_ARTIFACT' | string;
  reason_codes: string[];
  references: Array<{
    source: string;
    documentId: string;
    documentVersionId: string | null;
    tenantId: string | null;
    ownerId: string | null;
    artifactKind: string;
    expectedSha256: string | null;
    active: boolean;
  }>;
};

type Inventory = { objects: InventoryObject[] };

type DocumentRow = {
  id: string;
  owner_id: string | null;
  workspace_id: string | null;
  storage_path: string | null;
  sealed_pdf_path: string | null;
  file_hash_sha256: string | null;
  sealed_pdf_hash: string | null;
  deleted_at: string | null;
  legal_hold: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

type VersionRow = {
  id: string;
  document_id: string;
  workspace_id: string | null;
  storage_path: string | null;
  sha256: string | null;
  status: string | null;
  created_at: string | null;
};

type CertificationRow = {
  id: string;
  document_id: string;
  document_version_id: string | null;
  source_storage_bucket: string | null;
  source_storage_path: string | null;
  source_document_hash: string | null;
  certified_pdf_path: string | null;
  certified_pdf_sha256: string | null;
  pades_profile: string | null;
  verification_status: string | null;
  provider_metadata: Record<string, unknown> | null;
};

type Nom151Row = {
  id: string;
  documento_id: string;
  document_version_id: string | null;
  source_storage_bucket: string | null;
  source_storage_path: string | null;
  document_digest: string | null;
  constancia_path: string | null;
  status: string | null;
  verification_status: string | null;
};

type LiveReference = {
  table: 'documentos' | 'document_versions' | 'document_certifications' | 'nom151_constancias_doc';
  row_id: string;
  field:
    | 'storage_path'
    | 'sealed_pdf_path'
    | 'source_storage_path'
    | 'certified_pdf_path'
    | 'provider_metadata';
  json_paths: string[];
};

type StorageTechnicalMetadata = {
  created_at: string | null;
  updated_at: string | null;
  last_accessed_at: string | null;
};

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function option(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || null;
}

function documentIdFromObject(object: InventoryObject) {
  const referenced = object.references.find((reference) => reference.documentId)?.documentId;
  if (referenced) return referenced;
  const ids = [
    ...object.storage_path.matchAll(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
    ),
  ].map((match) => match[0]);
  return ids[1] || null;
}

function findExactStringPaths(value: unknown, needle: string, path = '$', matches: string[] = []) {
  if (value === needle) {
    matches.push(path);
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      findExactStringPaths(entry, needle, `${path}[${index}]`, matches)
    );
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      findExactStringPaths(entry, needle, `${path}.${key}`, matches);
    }
  }
  return matches;
}

function artifactKind(object: InventoryObject, references: LiveReference[]) {
  if (/\/pades(?:-bt)?\//i.test(object.storage_path)) return 'certified_pdf' as const;
  if (/\/visual\//i.test(object.storage_path)) return 'visual_pdf' as const;
  if (references.some((reference) => reference.field === 'sealed_pdf_path'))
    return 'signed_pdf' as const;
  if (references.some((reference) => reference.table === 'nom151_constancias_doc')) {
    return 'evidence' as const;
  }
  return 'document' as const;
}

async function fetchRows<T>(
  service: SupabaseClient,
  table: string,
  key: string,
  ids: string[],
  select: string
) {
  if (!ids.length) return [];
  const result = await service.from(table).select(select).in(key, ids);
  if (result.error) throw result.error;
  return (result.data || []) as unknown as T[];
}

async function storageTechnicalMetadata(service: SupabaseClient, targetPaths: Set<string>) {
  const result = new Map<string, StorageTechnicalMetadata>();
  const pending = [''];
  while (pending.length) {
    const prefix = pending.pop() || '';
    let offset = 0;
    while (true) {
      const page = await service.storage.from('documents').list(prefix, {
        limit: 100,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (page.error) throw page.error;
      for (const item of page.data || []) {
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id || item.metadata) {
          if (targetPaths.has(path)) {
            result.set(path, {
              created_at: item.created_at || null,
              updated_at: item.updated_at || null,
              last_accessed_at: item.last_accessed_at || null,
            });
          }
        } else {
          pending.push(path);
        }
      }
      if ((page.data || []).length < 100) break;
      offset += 100;
    }
  }
  return result;
}

const inputPath = resolve(option('input') || 'output/legacy-encryption-final-2026-08-31.json');
const outputPath = resolve(
  option('output') || 'output/final-encryption-closure-forensic-2026-08-31.json'
);
const inventory = JSON.parse(await readFile(inputPath, 'utf8')) as Inventory;
const candidates = inventory.objects.filter((object) =>
  ['ORPHAN', 'HISTORICAL_ARTIFACT'].includes(object.classification)
);
const candidateDocumentIds = [
  ...new Set(
    candidates.map(documentIdFromObject).filter((value): value is string => Boolean(value))
  ),
];
const service = createClient(
  requiredEnvironment('NEXT_PUBLIC_SUPABASE_URL'),
  requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const [documents, versions, certifications, nom151Rows, legalEvidenceRows, signatureEvidenceRows] =
  await Promise.all([
    fetchRows<DocumentRow>(
      service,
      'documentos',
      'id',
      candidateDocumentIds,
      'id,owner_id,workspace_id,storage_path,sealed_pdf_path,file_hash_sha256,sealed_pdf_hash,deleted_at,legal_hold,created_at,updated_at'
    ),
    fetchRows<VersionRow>(
      service,
      'document_versions',
      'document_id',
      candidateDocumentIds,
      'id,document_id,workspace_id,storage_path,sha256,status,created_at'
    ),
    fetchRows<CertificationRow>(
      service,
      'document_certifications',
      'document_id',
      candidateDocumentIds,
      'id,document_id,document_version_id,source_storage_bucket,source_storage_path,source_document_hash,certified_pdf_path,certified_pdf_sha256,pades_profile,verification_status,provider_metadata'
    ),
    fetchRows<Nom151Row>(
      service,
      'nom151_constancias_doc',
      'documento_id',
      candidateDocumentIds,
      'id,documento_id,document_version_id,source_storage_bucket,source_storage_path,document_digest,constancia_path,status,verification_status'
    ),
    fetchRows<{ id: string; document_id: string }>(
      service,
      'legal_evidence_events',
      'document_id',
      candidateDocumentIds,
      'id,document_id'
    ),
    fetchRows<{ id: string; document_id: string }>(
      service,
      'signature_evidence',
      'document_id',
      candidateDocumentIds,
      'id,document_id'
    ),
  ]);

const technicalMetadata = await storageTechnicalMetadata(
  service,
  new Set(candidates.map((candidate) => candidate.storage_path))
);
const objectsByHash = new Map<string, InventoryObject[]>();
for (const object of inventory.objects) {
  objectsByHash.set(object.physical_sha256, [
    ...(objectsByHash.get(object.physical_sha256) || []),
    object,
  ]);
}

const classified = candidates.map((object) => {
  const documentId = documentIdFromObject(object);
  const document = documents.find((row) => row.id === documentId) || null;
  const documentVersions = versions.filter((row) => row.document_id === documentId);
  const documentCertifications = certifications.filter((row) => row.document_id === documentId);
  const documentNom151Rows = nom151Rows.filter((row) => row.documento_id === documentId);
  const liveReferences: LiveReference[] = [];

  if (document) {
    for (const field of ['storage_path', 'sealed_pdf_path'] as const) {
      if (document[field] === object.storage_path) {
        liveReferences.push({ table: 'documentos', row_id: document.id, field, json_paths: [] });
      }
    }
  }
  for (const version of documentVersions) {
    if (version.storage_path === object.storage_path) {
      liveReferences.push({
        table: 'document_versions',
        row_id: version.id,
        field: 'storage_path',
        json_paths: [],
      });
    }
  }
  for (const certification of documentCertifications) {
    for (const field of ['source_storage_path', 'certified_pdf_path'] as const) {
      if (certification[field] === object.storage_path) {
        liveReferences.push({
          table: 'document_certifications',
          row_id: certification.id,
          field,
          json_paths: [],
        });
      }
    }
    const jsonPaths = findExactStringPaths(certification.provider_metadata, object.storage_path);
    if (jsonPaths.length) {
      liveReferences.push({
        table: 'document_certifications',
        row_id: certification.id,
        field: 'provider_metadata',
        json_paths: jsonPaths,
      });
    }
  }
  for (const row of documentNom151Rows) {
    if (
      row.source_storage_bucket === 'documents' &&
      row.source_storage_path === object.storage_path
    ) {
      liveReferences.push({
        table: 'nom151_constancias_doc',
        row_id: row.id,
        field: 'source_storage_path',
        json_paths: [],
      });
    }
  }

  const expectedHashes = new Set(
    [
      document?.storage_path === object.storage_path ? document.file_hash_sha256 : null,
      document?.sealed_pdf_path === object.storage_path ? document.sealed_pdf_hash : null,
      ...documentVersions
        .filter((row) => row.storage_path === object.storage_path)
        .map((row) => row.sha256),
      ...documentCertifications.flatMap((row) => [
        row.source_storage_path === object.storage_path ? row.source_document_hash : null,
        row.certified_pdf_path === object.storage_path ? row.certified_pdf_sha256 : null,
        findExactStringPaths(row.provider_metadata, object.physical_sha256).length
          ? object.physical_sha256
          : null,
      ]),
      ...documentNom151Rows
        .filter((row) => row.source_storage_path === object.storage_path)
        .map((row) => row.document_digest),
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase())
  );
  const exactHashBinding = expectedHashes.has(object.physical_sha256.toLowerCase());
  const duplicateObjects = (objectsByHash.get(object.physical_sha256) || []).filter(
    (candidate) => candidate.storage_path !== object.storage_path
  );
  const legalEvidenceCount = legalEvidenceRows.filter(
    (row) => row.document_id === documentId
  ).length;
  const signatureEvidenceCount = signatureEvidenceRows.filter(
    (row) => row.document_id === documentId
  ).length;
  const hasExactVersion = documentVersions.length === 1;
  const canEncrypt = Boolean(
    document?.workspace_id &&
    document.owner_id &&
    hasExactVersion &&
    exactHashBinding &&
    liveReferences.length
  );

  let finalClassification:
    | 'ORPHAN_HISTORICAL_REQUIRED'
    | 'ORPHAN_DUPLICATE'
    | 'ORPHAN_MANUAL_REVIEW_REQUIRED'
    | 'HISTORICAL_ENCRYPTION_REQUIRED'
    | 'MANUAL_REVIEW_REQUIRED';
  const reasonCodes: string[] = [];
  if (object.classification === 'ORPHAN') {
    if (canEncrypt && liveReferences.some((reference) => reference.field === 'provider_metadata')) {
      finalClassification = 'ORPHAN_HISTORICAL_REQUIRED';
      reasonCodes.push('PADES_BB_EVIDENCE_REFERENCE_RECOVERED');
    } else if (duplicateObjects.length) {
      finalClassification = 'ORPHAN_DUPLICATE';
      reasonCodes.push('EXACT_SHA256_CANONICAL_COPY_EXISTS');
    } else {
      finalClassification = 'ORPHAN_MANUAL_REVIEW_REQUIRED';
      reasonCodes.push(
        document ? 'SAFE_DOCUMENT_VERSION_BINDING_UNAVAILABLE' : 'DOCUMENT_ASSOCIATION_MISSING'
      );
      if (!duplicateObjects.length) reasonCodes.push('UNIQUE_COPY_CANNOT_BE_DELETED');
    }
  } else if (canEncrypt) {
    finalClassification = 'HISTORICAL_ENCRYPTION_REQUIRED';
    reasonCodes.push('SENSITIVE_PDF_WITH_EXACT_DOCUMENT_VERSION_BINDING');
  } else {
    finalClassification = 'MANUAL_REVIEW_REQUIRED';
    reasonCodes.push('SENSITIVE_HISTORICAL_PDF');
    if (!documentVersions.length) reasonCodes.push('DOCUMENT_VERSION_BINDING_MISSING');
    if (!exactHashBinding) reasonCodes.push('REGISTERED_HASH_BINDING_NOT_EXACT');
    if (legalEvidenceCount || signatureEvidenceCount)
      reasonCodes.push('LEGAL_RETENTION_REFERENCE_EXISTS');
  }

  const kind = artifactKind(object, liveReferences);
  const version = hasExactVersion ? documentVersions[0] : null;
  const targetEncryptedPath = canEncrypt
    ? `tenants/${document!.workspace_id}/documents/${documentId}/versions/${version!.id}/historical/${kind}-${object.physical_sha256.slice(0, 16)}.enc`
    : null;
  return {
    storage_bucket: object.storage_bucket,
    storage_path: object.storage_path,
    byte_size: object.byte_size,
    physical_sha256: object.physical_sha256,
    physical_format: object.physical_signature,
    inferred_mime_type: object.physical_mime_type,
    storage_dates: technicalMetadata.get(object.storage_path) || null,
    initial_classification: object.classification,
    final_classification: finalClassification,
    classification_reason_codes: reasonCodes,
    contains_sensitive_or_document_data: true,
    stored_as: 'PLAINTEXT',
    retention_required: Boolean(
      liveReferences.length ||
      legalEvidenceCount ||
      signatureEvidenceCount ||
      !duplicateObjects.length
    ),
    legal_evidence: Boolean(
      legalEvidenceCount ||
      signatureEvidenceCount ||
      documentCertifications.length ||
      documentNom151Rows.length
    ),
    document_id: documentId,
    document_version_id: version?.id || null,
    tenant_id: document?.workspace_id || null,
    actor_user_id: document?.owner_id || null,
    document_deleted: Boolean(document?.deleted_at),
    legal_hold: document?.legal_hold === true,
    certification_count: documentCertifications.length,
    nom151_count: documentNom151Rows.length,
    legal_evidence_count: legalEvidenceCount,
    signature_evidence_count: signatureEvidenceCount,
    canonical_duplicates: duplicateObjects.map((candidate) => ({
      storage_path: candidate.storage_path,
      classification: candidate.classification,
    })),
    live_references: liveReferences,
    artifact_kind: kind,
    encryption_eligible: canEncrypt,
    target_encrypted_path: targetEncryptedPath,
  };
});

const counts = classified.reduce<Record<string, number>>((accumulator, object) => {
  accumulator[object.final_classification] = (accumulator[object.final_classification] || 0) + 1;
  return accumulator;
}, {});
const migrationManifest = classified
  .filter((object) => object.encryption_eligible)
  .map((object) => ({
    document_id: object.document_id,
    document_version_id: object.document_version_id,
    tenant_id: object.tenant_id,
    actor_user_id: object.actor_user_id,
    source_bucket: object.storage_bucket,
    source_path: object.storage_path,
    physical_sha256: object.physical_sha256,
    byte_size: object.byte_size,
    artifact_kind: object.artifact_kind,
    target_encrypted_path: object.target_encrypted_path,
    classification: object.final_classification,
    live_references: object.live_references,
  }));
const report = {
  generated_at: new Date().toISOString(),
  mode: 'READ_ONLY_FINAL_ENCRYPTION_FORENSICS',
  source_inventory_sha256: createHash('sha256')
    .update(await readFile(inputPath))
    .digest('hex'),
  initial: { orphan: 11, historical_artifact: 59 },
  counts,
  encryption_eligible: migrationManifest.length,
  migration_manifest: migrationManifest,
  objects: classified,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.info(
  JSON.stringify(
    {
      generated_at: report.generated_at,
      mode: report.mode,
      counts,
      encryption_eligible: report.encryption_eligible,
      output: outputPath,
    },
    null,
    2
  )
);
