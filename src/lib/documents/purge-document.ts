import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

const DOCUMENTS_BUCKET = 'documents';
const CERTIFICATION_BUCKET = 'certification-artifacts';
const NOM151_BUCKET = 'nom151-constancias';

type Row = Record<string, unknown>;

export type PurgeReason = 'USER_REQUEST' | 'AUTO_RECOVERY_EXPIRY' | 'ADMINISTRATIVE';
export type PurgeMethod = 'DIRECT_DELETE' | 'TRASH_PURGE' | 'AUTO_RECOVERY_PURGE';

export type StorageObject = {
  bucket: string;
  path: string;
};

export type DocumentPurgeResult = {
  tombstoneId: string;
  storageObjectCount: number;
};

function tombstoneDisplayMetadata(
  document: Row,
  storageObjectCount: number,
  method: PurgeMethod
) {
  const documentName = String(document.nombre || '').trim();
  const documentTypeRelation = document.tipo_documento;
  const documentType = String(
    document.tipo_documento_nombre ||
      (documentTypeRelation && typeof documentTypeRelation === 'object'
        ? (documentTypeRelation as Record<string, unknown>).nombre || ''
        : '')
  ).trim();
  const createdAt = String(document.created_at || '').trim();
  const trashedAt = String(document.trashed_at || document.deleted_at || '').trim();

  return {
    storage_object_count: storageObjectCount,
    deletion_method: method,
    // This is deliberately limited to the label already visible in Papelera.
    // It lets the owner identify a destroyed document without retaining its content or paths.
    ...(documentName ? { document_name: documentName.slice(0, 255) } : {}),
    ...(documentType ? { document_type: documentType.slice(0, 120) } : {}),
    ...(createdAt ? { document_created_at: createdAt } : {}),
    ...(trashedAt ? { document_trashed_at: trashedAt } : {}),
  };
}

function storagePath(value: unknown) {
  const path = String(value || '').trim();
  return path && !/^https?:\/\//i.test(path) ? path : null;
}

function addPath(byBucket: Map<string, Set<string>>, bucket: string, value: unknown) {
  const path = storagePath(value);
  if (!path) return;
  if (!byBucket.has(bucket)) byBucket.set(bucket, new Set());
  byBucket.get(bucket)?.add(path);
}

function addPathArray(byBucket: Map<string, Set<string>>, bucket: string, value: unknown) {
  if (!Array.isArray(value)) return;
  for (const path of value) addPath(byBucket, bucket, path);
}

function addMetadataPaths(byBucket: Map<string, Set<string>>, value: unknown) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/(^|_)(artifact|verification_report|storage)_path$/i.test(key)) {
      addPath(byBucket, CERTIFICATION_BUCKET, item);
    }
    if (item && typeof item === 'object') addMetadataPaths(byBucket, item);
  }
}

async function queryRows(
  service: SupabaseClient,
  table: string,
  select: string,
  column: string,
  documentId: string
) {
  const result = await service.from(table).select(select).eq(column, documentId);
  if (result.error) throw result.error;
  return (result.data || []) as unknown as Row[];
}

export async function collectDocumentBundleStorage(
  service: SupabaseClient,
  document: Row
): Promise<StorageObject[]> {
  const documentId = String(document.id || '');
  const byBucket = new Map<string, Set<string>>();
  addPath(byBucket, DOCUMENTS_BUCKET, document.storage_path);
  addPath(byBucket, DOCUMENTS_BUCKET, document.sealed_pdf_path);
  addPath(byBucket, DOCUMENTS_BUCKET, document.file_url);

  const [versions, encryption, certifications, nom151, signatures, forms, certCases] =
    await Promise.all([
      queryRows(service, 'document_versions', 'storage_path,file_url', 'document_id', documentId),
      queryRows(
        service,
        'document_encryption_metadata',
        'storage_bucket,storage_path',
        'document_id',
        documentId
      ),
      queryRows(
        service,
        'document_certifications',
        'id,certificate_pdf_path,certified_pdf_path,technical_package_path,source_storage_bucket,source_storage_path,provider_metadata',
        'document_id',
        documentId
      ),
      queryRows(
        service,
        'nom151_constancias_doc',
        'constancia_path,constancia_storage_path,source_storage_bucket,source_storage_path',
        'documento_id',
        documentId
      ),
      queryRows(
        service,
        'signature_evidence',
        'storage_image_path,storage_strokes_path,storage_frames_paths,storage_selfie_path,digital_seal_path',
        'document_id',
        documentId
      ),
      queryRows(service, 'form_responses', 'pdf_output_path', 'document_id', documentId),
      queryRows(
        service,
        'certification_cases',
        'id,original_storage_path',
        'source_document_id',
        documentId
      ),
    ]);

  for (const version of versions) {
    addPath(byBucket, DOCUMENTS_BUCKET, version.storage_path);
    addPath(byBucket, DOCUMENTS_BUCKET, version.file_url);
  }
  for (const item of encryption)
    addPath(byBucket, String(item.storage_bucket || DOCUMENTS_BUCKET), item.storage_path);
  for (const certification of certifications) {
    addPath(byBucket, CERTIFICATION_BUCKET, certification.certificate_pdf_path);
    addPath(byBucket, CERTIFICATION_BUCKET, certification.certified_pdf_path);
    addPath(byBucket, CERTIFICATION_BUCKET, certification.technical_package_path);
    addPath(
      byBucket,
      String(certification.source_storage_bucket || CERTIFICATION_BUCKET),
      certification.source_storage_path
    );
    addMetadataPaths(byBucket, certification.provider_metadata);
  }

  const certificationIds = certifications.map((item) => String(item.id || '')).filter(Boolean);
  const caseIds = certCases.map((item) => String(item.id || '')).filter(Boolean);
  const [timestamps, certificationFiles] = await Promise.all([
    certificationIds.length
      ? service
          .from('timestamp_records')
          .select('request_storage_path,response_storage_path,token_storage_path')
          .in('document_certification_id', certificationIds)
      : Promise.resolve({ data: [], error: null }),
    caseIds.length
      ? service
          .from('certification_files')
          .select('storage_bucket,storage_path')
          .in('certification_id', caseIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (timestamps.error) throw timestamps.error;
  if (certificationFiles.error) throw certificationFiles.error;

  for (const timestamp of (timestamps.data || []) as Row[]) {
    addPath(byBucket, CERTIFICATION_BUCKET, timestamp.request_storage_path);
    addPath(byBucket, CERTIFICATION_BUCKET, timestamp.response_storage_path);
    addPath(byBucket, CERTIFICATION_BUCKET, timestamp.token_storage_path);
  }
  for (const item of nom151) {
    addPath(byBucket, NOM151_BUCKET, item.constancia_path);
    addPath(byBucket, NOM151_BUCKET, item.constancia_storage_path);
    addPath(
      byBucket,
      String(item.source_storage_bucket || CERTIFICATION_BUCKET),
      item.source_storage_path
    );
  }
  for (const item of signatures) {
    addPath(byBucket, DOCUMENTS_BUCKET, item.storage_image_path);
    addPath(byBucket, DOCUMENTS_BUCKET, item.storage_strokes_path);
    addPath(byBucket, DOCUMENTS_BUCKET, item.storage_selfie_path);
    addPath(byBucket, DOCUMENTS_BUCKET, item.digital_seal_path);
    addPathArray(byBucket, DOCUMENTS_BUCKET, item.storage_frames_paths);
  }
  for (const item of forms) addPath(byBucket, DOCUMENTS_BUCKET, item.pdf_output_path);
  for (const item of certCases) addPath(byBucket, DOCUMENTS_BUCKET, item.original_storage_path);
  for (const item of (certificationFiles.data || []) as Row[]) {
    addPath(byBucket, String(item.storage_bucket || CERTIFICATION_BUCKET), item.storage_path);
  }

  return [...byBucket.entries()].flatMap(([bucket, paths]) =>
    [...paths].map((path) => ({ bucket, path }))
  );
}

async function setTombstoneStatus(
  service: SupabaseClient,
  tombstoneId: string,
  update: Record<string, unknown>
) {
  const result = await service
    .from('document_deletion_tombstones')
    .update(update)
    .eq('id', tombstoneId);
  if (result.error) throw result.error;
}

async function removeStorageBundle(service: SupabaseClient, objects: StorageObject[]) {
  const byBucket = new Map<string, string[]>();
  for (const object of objects) {
    const current = byBucket.get(object.bucket) || [];
    current.push(object.path);
    byBucket.set(object.bucket, current);
  }
  for (const [bucket, paths] of byBucket) {
    for (let offset = 0; offset < paths.length; offset += 1000) {
      const result = await service.storage.from(bucket).remove(paths.slice(offset, offset + 1000));
      if (result.error) throw result.error;
    }
  }
}

export async function purgeDocumentBundle(input: {
  service: SupabaseClient;
  document: Row;
  actorId: string | null;
  reason: PurgeReason;
  method: PurgeMethod;
  requestId?: string | null;
}): Promise<DocumentPurgeResult> {
  const { service, document, actorId, reason, method, requestId = null } = input;
  const storageObjects = await collectDocumentBundleStorage(service, document);
  const staged = await service
    .from('document_deletion_tombstones')
    .insert({
      document_id: document.id,
      workspace_id: document.workspace_id || null,
      owner_id: document.owner_id || null,
      actor_id: actorId,
      reason,
      status: 'PENDING',
      request_id: requestId,
      metadata: tombstoneDisplayMetadata(document, storageObjects.length, method),
    })
    .select('id')
    .single();
  if (staged.error) throw staged.error;

  const tombstoneId = String(staged.data.id);
  try {
    await removeStorageBundle(service, storageObjects);
    await setTombstoneStatus(service, tombstoneId, {
      status: 'STORAGE_REMOVED',
      storage_removed_at: new Date().toISOString(),
    });
    const finalized = await service.rpc('purge_document_bundle', {
      p_document_id: document.id,
      p_tombstone_id: tombstoneId,
    });
    if (finalized.error) throw finalized.error;
    return { tombstoneId, storageObjectCount: storageObjects.length };
  } catch (error) {
    await setTombstoneStatus(service, tombstoneId, {
      status: 'FAILED',
      failure_code: 'PURGE_FAILED',
    }).catch(() => undefined);
    throw error;
  }
}
