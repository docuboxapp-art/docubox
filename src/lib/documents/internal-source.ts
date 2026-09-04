import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import {
  documentEncryptionPolicy,
  readDocumentStorageObject,
} from '@/lib/crypto/document-encryption';

export type InternalSourceVariant = 'original' | 'version' | 'certified';

export type InternalSourceRequest = {
  workspaceId: string;
  documentId: string;
  versionId?: string | null;
  variant: InternalSourceVariant;
};

export type ResolvedInternalSource = {
  workspaceId: string;
  documentId: string;
  versionId: string | null;
  variant: InternalSourceVariant;
  documentoId: string;
  fileName: string;
  fileSize: number | null;
  fileType: string;
  sha256: string;
  storagePath: string;
  versionNumber: number;
  versionStatus: string;
};

export class InternalSourceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export function isValidSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

export function resolveLegacyDocumentStoragePath(storagePath: unknown, fileUrl: unknown) {
  const directPath = String(storagePath || '').trim();
  if (directPath) return directPath;

  const rawUrl = String(fileUrl || '').trim();
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    const configuredHost = process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
      : null;
    if (configuredHost && url.host !== configuredHost) return null;

    const markers = [
      '/storage/v1/object/sign/documents/',
      '/storage/v1/object/authenticated/documents/',
      '/storage/v1/object/public/documents/',
    ];
    const marker = markers.find((candidate) => url.pathname.includes(candidate));
    if (!marker) return null;

    const encodedPath = url.pathname.slice(url.pathname.indexOf(marker) + marker.length);
    const decodedPath = decodeURIComponent(encodedPath).replace(/^\/+/, '');
    return decodedPath && !decodedPath.includes('..') ? decodedPath : null;
  } catch {
    return null;
  }
}

function normalizeEmail(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function isListedParticipant(participants: unknown, user: User) {
  if (!Array.isArray(participants)) return false;
  const email = normalizeEmail(user.email);
  return participants.some((participant) => {
    if (!participant || typeof participant !== 'object') return false;
    const row = participant as Record<string, unknown>;
    return row.id === user.id || (email && normalizeEmail(row.email) === email);
  });
}

export async function requireActiveWorkspaceMembership(
  service: SupabaseClient,
  userId: string,
  workspaceId: string
) {
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new InternalSourceError(400, 'INVALID_WORKSPACE', 'El espacio de trabajo no es valido.');
  }

  const membership = await service
    .from('workspace_members')
    .select('role,status,access_expires_at')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();

  if (membership.error) throw membership.error;
  const expiresAt = membership.data?.access_expires_at
    ? new Date(membership.data.access_expires_at).getTime()
    : null;
  if (!membership.data || (expiresAt !== null && expiresAt <= Date.now())) {
    throw new InternalSourceError(
      403,
      'WORKSPACE_ACCESS_DENIED',
      'No tienes acceso a este espacio de trabajo.'
    );
  }

  return membership.data;
}

export async function resolveInternalDocumentSource(
  service: SupabaseClient,
  user: User,
  request: InternalSourceRequest
): Promise<ResolvedInternalSource> {
  if (!UUID_PATTERN.test(request.documentId)) {
    throw new InternalSourceError(400, 'INVALID_DOCUMENT', 'El documento de origen no es valido.');
  }

  const membership = await requireActiveWorkspaceMembership(service, user.id, request.workspaceId);

  const documentResult = await service
    .from('documentos')
    .select(
      'id,documento_id,owner_id,workspace_id,file_name,file_size,file_type,file_hash_sha256,storage_path,file_url,participantes,sealed_pdf_path,sealed_pdf_hash,estado'
    )
    .eq('id', request.documentId)
    .eq('workspace_id', request.workspaceId)
    .is('deleted_at', null)
    .maybeSingle();

  if (documentResult.error) throw documentResult.error;
  if (!documentResult.data) {
    throw new InternalSourceError(
      404,
      'SOURCE_NOT_FOUND',
      'El documento de origen no existe o ya no esta disponible.'
    );
  }

  const document = documentResult.data;
  const isManager = membership.role === 'owner' || membership.role === 'admin';
  const canRead =
    document.owner_id === user.id || isManager || isListedParticipant(document.participantes, user);
  if (!canRead) {
    throw new InternalSourceError(
      403,
      'SOURCE_ACCESS_DENIED',
      'No tienes permiso para reutilizar este documento.'
    );
  }

  if (request.variant === 'certified') {
    if (!document.sealed_pdf_path || !isValidSha256(document.sealed_pdf_hash)) {
      throw new InternalSourceError(
        409,
        'CERTIFIED_VERSION_UNAVAILABLE',
        'La version certificada no esta disponible.'
      );
    }
    return {
      workspaceId: request.workspaceId,
      documentId: document.id,
      versionId: null,
      variant: 'certified',
      documentoId: document.documento_id,
      fileName: document.file_name,
      fileSize: document.file_size,
      fileType: 'application/pdf',
      sha256: document.sealed_pdf_hash.toLowerCase(),
      storagePath: document.sealed_pdf_path,
      versionNumber: 0,
      versionStatus: 'certified',
    };
  }

  if (request.versionId) {
    if (!UUID_PATTERN.test(request.versionId)) {
      throw new InternalSourceError(
        400,
        'INVALID_VERSION',
        'La version seleccionada no es valida.'
      );
    }
    const versionResult = await service
      .from('document_versions')
      .select('id,version_number,status,storage_path,file_url,mime_type,byte_size,sha256')
      .eq('id', request.versionId)
      .eq('workspace_id', request.workspaceId)
      .eq('document_id', document.id)
      .maybeSingle();
    if (versionResult.error) throw versionResult.error;
    const versionStoragePath = resolveLegacyDocumentStoragePath(
      versionResult.data?.storage_path,
      versionResult.data?.file_url
    );
    if (!versionStoragePath || !isValidSha256(versionResult.data?.sha256)) {
      throw new InternalSourceError(
        404,
        'VERSION_NOT_FOUND',
        'La version seleccionada ya no esta disponible.'
      );
    }
    return {
      workspaceId: request.workspaceId,
      documentId: document.id,
      versionId: versionResult.data.id,
      variant: 'version',
      documentoId: document.documento_id,
      fileName: document.file_name,
      fileSize: versionResult.data.byte_size ?? document.file_size,
      fileType: versionResult.data.mime_type || document.file_type || 'application/octet-stream',
      sha256: versionResult.data.sha256.toLowerCase(),
      storagePath: versionStoragePath,
      versionNumber: versionResult.data.version_number,
      versionStatus: versionResult.data.status,
    };
  }

  const originalStoragePath = resolveLegacyDocumentStoragePath(
    document.storage_path,
    document.file_url
  );
  if (!originalStoragePath || !isValidSha256(document.file_hash_sha256)) {
    throw new InternalSourceError(
      409,
      'ORIGINAL_UNAVAILABLE',
      'El archivo original no esta disponible para reutilizarse.'
    );
  }

  let originalBytes: Buffer;
  let originalMimeType = document.file_type || 'application/octet-stream';
  if (documentEncryptionPolicy().enabled) {
    const decrypted = await readDocumentStorageObject({
      service,
      storageBucket: 'documents',
      storagePath: originalStoragePath,
      expectedPlaintextSha256: document.file_hash_sha256,
      userId: user.id,
    });
    originalBytes = decrypted.plaintext;
    originalMimeType = document.file_type || decrypted.mimeType;
  } else {
    const originalObject = await service.storage.from('documents').download(originalStoragePath);
    if (originalObject.error || !originalObject.data) {
      throw new InternalSourceError(
        404,
        'ORIGINAL_FILE_NOT_FOUND',
        'El archivo original no esta disponible en Storage.'
      );
    }
    originalBytes = Buffer.from(await originalObject.data.arrayBuffer());
    originalMimeType = document.file_type || originalObject.data.type || 'application/octet-stream';
  }
  const verifiedSha256 = createHash('sha256').update(originalBytes).digest('hex');
  const originalSize = originalBytes.byteLength;
  originalBytes.fill(0);

  return {
    workspaceId: request.workspaceId,
    documentId: document.id,
    versionId: null,
    variant: 'original',
    documentoId: document.documento_id,
    fileName: document.file_name,
    fileSize: originalSize,
    fileType: originalMimeType,
    sha256: verifiedSha256,
    storagePath: originalStoragePath,
    versionNumber: 1,
    versionStatus: 'original',
  };
}
