import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sha256Hex } from './canonical';
import { CertificationError } from './types';
import {
  documentEncryptionPolicy,
  readDocumentStorageObject,
} from '@/lib/crypto/document-encryption';

const IMMUTABLE_SOURCE_BUCKET = 'certification-artifacts';
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

type SourceDocument = {
  id: string;
  workspace_id: string | null;
  file_url: string | null;
  storage_path: string | null;
  file_type: string | null;
  sealed_pdf_path: string | null;
};

type DocumentVersionRow = {
  id: string;
  workspace_id: string;
  document_id: string;
  version_number: number;
  status: string;
  file_url: string | null;
  storage_path: string | null;
  mime_type: string;
  byte_size: number | null;
  sha256: string;
  frozen_at: string | null;
  metadata: Record<string, unknown> | null;
};

export type FrozenCertificationSource = {
  versionId: string;
  versionNumber: number;
  bytes: Uint8Array;
  sha256: string;
  sizeBytes: number;
  storageBucket: string;
  storagePath: string;
};

type StorageReference = { bucket: string; path: string };

function parseStorageReference(raw: string | null | undefined): StorageReference | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const match = url.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
    return match
      ? { bucket: decodeURIComponent(match[1]), path: decodeURIComponent(match[2]) }
      : null;
  } catch {
    return null;
  }
}

async function downloadFirstAvailable(
  supabase: SupabaseClient,
  references: StorageReference[],
  fallbackUrl?: string | null,
) {
  const unique = references.filter((reference, index, all) => (
    reference.path
    && all.findIndex((candidate) => candidate.bucket === reference.bucket && candidate.path === reference.path) === index
  ));
  for (const reference of unique) {
    const result = await supabase.storage.from(reference.bucket).download(reference.path);
    if (!result.error && result.data) {
      return {
        bytes: new Uint8Array(await result.data.arrayBuffer()),
        reference,
      };
    }
  }

  if (fallbackUrl && /^https?:/i.test(fallbackUrl)) {
    const response = await fetch(fallbackUrl, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (response?.ok) {
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        reference: parseStorageReference(fallbackUrl),
      };
    }
  }
  return null;
}

export function assertSourceHash(bytes: Uint8Array, expectedSha256: string) {
  const normalizedExpected = expectedSha256.trim().toLowerCase();
  const actual = sha256Hex(bytes);
  if (!SHA256_PATTERN.test(normalizedExpected) || actual !== normalizedExpected) {
    throw new CertificationError(
      'DOCUMENT_VERSION_HASH_MISMATCH',
      'Los bytes de la version documental no coinciden con su hash registrado.',
      409,
    );
  }
  return actual;
}

export function assertVersionScope(
  version: Pick<DocumentVersionRow, 'document_id' | 'workspace_id'>,
  documentId: string,
  workspaceId: string,
) {
  if (version.document_id !== documentId || version.workspace_id !== workspaceId) {
    throw new CertificationError(
      'DOCUMENT_VERSION_SCOPE_MISMATCH',
      'La version solicitada no pertenece al documento y espacio de trabajo autorizados.',
      403,
    );
  }
}

export async function downloadCurrentDocumentBytes(
  supabase: SupabaseClient,
  document: SourceDocument,
) {
  const references: StorageReference[] = [];
  if (document.sealed_pdf_path) {
    references.push({ bucket: 'documents-signed', path: document.sealed_pdf_path });
    references.push({ bucket: 'documents', path: document.sealed_pdf_path });
  }
  if (document.storage_path) references.push({ bucket: 'documents', path: document.storage_path });
  const fromUrl = parseStorageReference(document.file_url);
  if (fromUrl) references.push(fromUrl);
  if (document.file_url && !/^https?:/i.test(document.file_url)) {
    references.push({ bucket: 'documents', path: document.file_url });
  }

  const result = await downloadFirstAvailable(supabase, references, document.file_url);
  if (!result) {
    throw new CertificationError(
      'DOCUMENT_BYTES_UNAVAILABLE',
      'No fue posible recuperar los bytes del documento cerrado.',
      422,
    );
  }
  return result.bytes;
}

function versionReferences(version: DocumentVersionRow) {
  const references: StorageReference[] = [];
  const metadataBucket = typeof version.metadata?.storage_bucket === 'string'
    ? version.metadata.storage_bucket
    : null;
  if (version.storage_path && metadataBucket) {
    references.push({ bucket: metadataBucket, path: version.storage_path });
  }
  if (version.storage_path) {
    references.push({ bucket: 'documents', path: version.storage_path });
    references.push({ bucket: IMMUTABLE_SOURCE_BUCKET, path: version.storage_path });
  }
  const fromUrl = parseStorageReference(version.file_url);
  if (fromUrl) references.push(fromUrl);
  return references;
}

async function loadVersionBytes(supabase: SupabaseClient, version: DocumentVersionRow) {
  if (documentEncryptionPolicy().enabled && version.storage_path) {
    const bucket = typeof version.metadata?.storage_bucket === 'string'
      ? version.metadata.storage_bucket
      : 'documents';
    const decrypted = await readDocumentStorageObject({
      service: supabase,
      storageBucket: bucket,
      storagePath: version.storage_path,
      expectedPlaintextSha256: version.sha256,
    });
    assertSourceHash(decrypted.plaintext, version.sha256);
    return new Uint8Array(decrypted.plaintext);
  }
  const downloaded = await downloadFirstAvailable(supabase, versionReferences(version), version.file_url);
  if (!downloaded) {
    throw new CertificationError(
      'DOCUMENT_VERSION_BYTES_UNAVAILABLE',
      'No fue posible recuperar los bytes de la version documental seleccionada.',
      422,
    );
  }
  assertSourceHash(downloaded.bytes, version.sha256);
  return downloaded.bytes;
}

async function uploadImmutableSource(
  supabase: SupabaseClient,
  path: string,
  bytes: Uint8Array,
  mimeType: string,
) {
  const upload = await supabase.storage.from(IMMUTABLE_SOURCE_BUCKET).upload(path, bytes, {
    contentType: mimeType || 'application/pdf',
    cacheControl: 'private, max-age=0',
    upsert: false,
  });
  if (!upload.error) return;

  const existing = await supabase.storage.from(IMMUTABLE_SOURCE_BUCKET).download(path);
  if (!existing.error && existing.data) {
    const existingBytes = new Uint8Array(await existing.data.arrayBuffer());
    if (sha256Hex(existingBytes) === sha256Hex(bytes)) return;
  }
  throw new CertificationError('IMMUTABLE_SOURCE_WRITE_FAILED', upload.error.message, 500);
}

export async function resolveAndFreezeCertificationSource({
  supabase,
  document,
  actorUserId,
  requestedVersionId,
}: {
  supabase: SupabaseClient;
  document: SourceDocument;
  actorUserId: string;
  requestedVersionId?: string | null;
}): Promise<FrozenCertificationSource> {
  if (!document.workspace_id) {
    throw new CertificationError(
      'DOCUMENT_WORKSPACE_REQUIRED',
      'El documento debe pertenecer a un espacio de trabajo antes de certificarse.',
      422,
    );
  }

  let versionQuery = supabase
    .from('document_versions')
    .select('id,workspace_id,document_id,version_number,status,file_url,storage_path,mime_type,byte_size,sha256,frozen_at,metadata')
    .eq('workspace_id', document.workspace_id)
    .eq('document_id', document.id);
  versionQuery = requestedVersionId
    ? versionQuery.eq('id', requestedVersionId)
    : versionQuery.order('version_number', { ascending: false }).limit(1);
  const versionResult = await versionQuery.maybeSingle();
  if (versionResult.error) {
    throw new CertificationError('DOCUMENT_VERSION_READ_FAILED', versionResult.error.message, 500);
  }

  let version = versionResult.data as DocumentVersionRow | null;
  let bytes: Uint8Array;

  if (!version && requestedVersionId) {
    throw new CertificationError('DOCUMENT_VERSION_NOT_FOUND', 'La version documental solicitada no existe.', 404);
  }

  if (!version) {
    bytes = await downloadCurrentDocumentBytes(supabase, document);
    const hash = sha256Hex(bytes);
    const versionId = randomUUID();
    const inserted = await supabase
      .from('document_versions')
      .insert({
        id: versionId,
        workspace_id: document.workspace_id,
        document_id: document.id,
        version_number: 1,
        status: 'approved',
        file_url: document.file_url,
        storage_path: document.storage_path,
        mime_type: document.file_type || 'application/pdf',
        byte_size: bytes.byteLength,
        sha256: hash,
        change_reason: 'Version exacta registrada para certificacion',
        created_by: actorUserId,
        metadata: { source: 'certification_foundation', schema_version: 1 },
      })
      .select('id,workspace_id,document_id,version_number,status,file_url,storage_path,mime_type,byte_size,sha256,frozen_at,metadata')
      .single();

    if (inserted.error) {
      if (inserted.error.code !== '23505') {
        throw new CertificationError('DOCUMENT_VERSION_CREATE_FAILED', inserted.error.message, 500);
      }
      const raced = await supabase
        .from('document_versions')
        .select('id,workspace_id,document_id,version_number,status,file_url,storage_path,mime_type,byte_size,sha256,frozen_at,metadata')
        .eq('workspace_id', document.workspace_id)
        .eq('document_id', document.id)
        .order('version_number', { ascending: false })
        .limit(1)
        .single();
      if (raced.error) throw new CertificationError('DOCUMENT_VERSION_READ_FAILED', raced.error.message, 500);
      version = raced.data as DocumentVersionRow;
      bytes = await loadVersionBytes(supabase, version);
    } else {
      version = inserted.data as DocumentVersionRow;
    }
  } else {
    assertVersionScope(version, document.id, document.workspace_id);
    bytes = await loadVersionBytes(supabase, version);
  }

  const hash = assertSourceHash(bytes, version.sha256);
  const encryptedSource = documentEncryptionPolicy().enabled && Boolean(version.storage_path);
  const immutablePath = encryptedSource
    ? version.storage_path!
    : `${document.workspace_id}/${document.id}/versions/${version.id}/source-${hash}.pdf`;
  const immutableBucket = encryptedSource
    ? (typeof version.metadata?.storage_bucket === 'string' ? version.metadata.storage_bucket : 'documents')
    : IMMUTABLE_SOURCE_BUCKET;
  if (!encryptedSource) {
    await uploadImmutableSource(supabase, immutablePath, bytes, version.mime_type);
  }

  if (!version.frozen_at && !['sent', 'signed'].includes(version.status)) {
    const frozenAt = new Date().toISOString();
    const frozen = await supabase
      .from('document_versions')
      .update({
        status: 'sent',
        storage_path: immutablePath,
        file_url: null,
        byte_size: bytes.byteLength,
        sha256: hash,
        frozen_at: frozenAt,
        metadata: {
          ...(version.metadata || {}),
          storage_bucket: immutableBucket,
          immutable_source: true,
          immutable_source_sha256: hash,
          frozen_by: 'certification_foundation',
        },
      })
      .eq('id', version.id)
      .is('frozen_at', null);
    if (frozen.error) {
      throw new CertificationError('DOCUMENT_VERSION_FREEZE_FAILED', frozen.error.message, 500);
    }
  }

  return {
    versionId: version.id,
    versionNumber: version.version_number,
    bytes,
    sha256: hash,
    sizeBytes: bytes.byteLength,
    storageBucket: immutableBucket,
    storagePath: immutablePath,
  };
}

export async function verifyFrozenCertificationSource(
  supabase: SupabaseClient,
  source: Pick<FrozenCertificationSource, 'storageBucket' | 'storagePath' | 'sha256'>,
) {
  if (documentEncryptionPolicy().enabled) {
    const decrypted = await readDocumentStorageObject({
      service: supabase,
      storageBucket: source.storageBucket,
      storagePath: source.storagePath,
      expectedPlaintextSha256: source.sha256,
    });
    assertSourceHash(decrypted.plaintext, source.sha256);
    return new Uint8Array(decrypted.plaintext);
  }
  const downloaded = await supabase.storage.from(source.storageBucket).download(source.storagePath);
  if (downloaded.error || !downloaded.data) {
    throw new CertificationError(
      'IMMUTABLE_SOURCE_READ_FAILED',
      downloaded.error?.message || 'No fue posible recuperar la version congelada.',
      500,
    );
  }
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  assertSourceHash(bytes, source.sha256);
  return bytes;
}
