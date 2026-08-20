import { NextRequest, NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';
import {
  InternalSourceError,
  isValidSha256,
  requireActiveWorkspaceMembership,
  resolveLegacyDocumentStoragePath,
} from '@/lib/documents/internal-source';

const EDITABLE_VERSION_STATUSES = new Set(['draft', 'in_review', 'approved']);

function bearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  return authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

function normalize(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function canReadDocument(
  document: Record<string, any>,
  userId: string,
  userEmail: string,
  role: string
) {
  if (document.owner_id === userId || role === 'owner' || role === 'admin') return true;
  if (!Array.isArray(document.participantes)) return false;
  return document.participantes.some(
    (participant: Record<string, unknown>) =>
      participant?.id === userId || normalize(participant?.email) === userEmail
  );
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: 'Borrador',
    in_review: 'En revision',
    approved: 'Preparada',
    sent: 'En progreso',
    signed: 'Firmada',
    obsolete: 'Obsoleta',
    original: 'Original',
    certified: 'Certificada',
  };
  return labels[status] || status.replaceAll('_', ' ');
}

export async function GET(request: NextRequest) {
  try {
    const token = bearerToken(request);
    if (!token) return NextResponse.json({ error: 'Debes iniciar sesion.' }, { status: 401 });

    const auth = await createAnonClient().auth.getUser(token);
    if (auth.error || !auth.data.user?.email) {
      return NextResponse.json({ error: 'La sesion no es valida.' }, { status: 401 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspaceId') || '';
    const search = normalize(request.nextUrl.searchParams.get('search'));
    const service = createServiceClient();
    const membership = await requireActiveWorkspaceMembership(
      service,
      auth.data.user.id,
      workspaceId
    );

    const documentsResult = await service
      .from('documentos')
      .select(
        'id,documento_id,owner_id,workspace_id,file_name,file_size,file_type,file_hash_sha256,nombre,descripcion,estado,updated_at,created_at,storage_path,file_url,sealed_pdf_path,sealed_pdf_hash,sealed_at,participantes'
      )
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(500);
    if (documentsResult.error) throw documentsResult.error;

    const userEmail = normalize(auth.data.user.email);
    const authorizedDocuments = (documentsResult.data || []).filter((document) =>
      canReadDocument(document, auth.data.user.id, userEmail, String(membership.role))
    );

    const relationsResult = await service
      .from('document_relations')
      .select('id,source_document_id,target_document_id,relation_type,created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })
      .limit(2000);
    if (relationsResult.error) throw relationsResult.error;

    const authorizedById = new Map(authorizedDocuments.map((document) => [document.id, document]));
    const relations = (relationsResult.data || []).filter(
      (relation) =>
        authorizedById.has(relation.source_document_id) &&
        authorizedById.has(relation.target_document_id)
    );
    const derivedDocumentIds = new Set(relations.map((relation) => relation.target_document_id));

    const assetKey = (document: Record<string, any>) => {
      const hash = isValidSha256(document.file_hash_sha256)
        ? document.file_hash_sha256.toLowerCase()
        : null;
      return hash
        ? `${hash}:${document.file_size || 0}:${document.file_type || 'unknown'}`
        : `document:${document.id}`;
    };
    const documentsByAsset = new Map<string, any[]>();
    for (const document of authorizedDocuments) {
      const key = assetKey(document);
      const current = documentsByAsset.get(key) || [];
      current.push(document);
      documentsByAsset.set(key, current);
    }
    const groupedDocumentIds = new Map<string, string[]>();
    const rootDocuments = Array.from(documentsByAsset.values()).map((group) => {
      const ordered = [...group].sort(
        (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
      );
      const root = ordered.find((document) => !derivedDocumentIds.has(document.id)) || ordered[0];
      groupedDocumentIds.set(
        root.id,
        ordered.map((document) => document.id)
      );
      return root;
    });
    const readableDocuments = rootDocuments.filter((document) => {
      if (['borrador', 'draft'].includes(normalize(document.estado))) return false;
      if (!search) return true;
      return [
        document.nombre,
        document.file_name,
        document.documento_id,
        document.descripcion,
      ].some((value) => normalize(value).includes(search));
    });

    const documentIds = readableDocuments.map((document) => document.id);
    const versionsResult = documentIds.length
      ? await service
          .from('document_versions')
          .select(
            'id,document_id,version_number,status,mime_type,byte_size,sha256,storage_path,file_url,created_at,frozen_at,signed_at'
          )
          .in('document_id', documentIds)
          .eq('workspace_id', workspaceId)
          .order('version_number', { ascending: false })
      : { data: [], error: null };
    if (versionsResult.error) throw versionsResult.error;

    const versionsByDocument = new Map<string, any[]>();
    for (const version of versionsResult.data || []) {
      const current = versionsByDocument.get(version.document_id) || [];
      current.push(version);
      versionsByDocument.set(version.document_id, current);
    }

    const relationsBySource = new Map<string, any[]>();
    for (const relation of relations) {
      const current = relationsBySource.get(relation.source_document_id) || [];
      current.push(relation);
      relationsBySource.set(relation.source_document_id, current);
    }

    const collectUsages = (rootDocumentId: string) => {
      const queue = [rootDocumentId];
      const visited = new Set([rootDocumentId]);
      const usagesByDocument = new Map<string, Record<string, unknown>>();
      for (const documentId of groupedDocumentIds.get(rootDocumentId) || []) {
        if (documentId === rootDocumentId) continue;
        const target = authorizedById.get(documentId);
        if (!target) continue;
        const targetClosed = ['completado', 'firmado', 'certificado'].includes(
          normalize(target.estado)
        );
        usagesByDocument.set(documentId, {
          id: `asset:${documentId}`,
          documentId: target.id,
          documentoId: target.documento_id,
          name: target.nombre || target.file_name,
          status: target.estado || 'borrador',
          statusLabel: targetClosed ? 'Completado' : statusLabel(target.estado || 'draft'),
          createdAt: target.created_at,
          relationType: 'derived_from',
        });
      }
      while (queue.length > 0) {
        const sourceId = queue.shift()!;
        for (const relation of relationsBySource.get(sourceId) || []) {
          if (visited.has(relation.target_document_id)) continue;
          visited.add(relation.target_document_id);
          queue.push(relation.target_document_id);
          const target = authorizedById.get(relation.target_document_id);
          if (!target) continue;
          const targetClosed = ['completado', 'firmado', 'certificado'].includes(
            normalize(target.estado)
          );
          usagesByDocument.set(target.id, {
            id: relation.id,
            documentId: target.id,
            documentoId: target.documento_id,
            name: target.nombre || target.file_name,
            status: target.estado || 'borrador',
            statusLabel: targetClosed ? 'Completado' : statusLabel(target.estado || 'draft'),
            createdAt: relation.created_at || target.created_at,
            relationType: relation.relation_type,
          });
        }
      }
      return Array.from(usagesByDocument.values()).sort(
        (left, right) =>
          new Date(String(right.createdAt)).getTime() - new Date(String(left.createdAt)).getTime()
      );
    };

    const documents = readableDocuments.map((document) => {
      const storedVersions = versionsByDocument.get(document.id) || [];
      const originalStoragePath = resolveLegacyDocumentStoragePath(
        document.storage_path,
        document.file_url
      );
      const originalHash = isValidSha256(document.file_hash_sha256)
        ? document.file_hash_sha256.toLowerCase()
        : '';
      const originalAvailable = Boolean(originalStoragePath && originalHash);
      const original = {
        key: 'original',
        id: null,
        variant: 'original',
        number: 1,
        status: 'original',
        label: 'Original cargado',
        sha256: originalHash,
        byteSize: document.file_size,
        mimeType: document.file_type || 'application/octet-stream',
        editable: false,
        closed: false,
        available: originalAvailable,
        createdAt: document.created_at,
        unavailableReason: originalAvailable
          ? null
          : !originalStoragePath
            ? 'El archivo original no se encuentra en Storage.'
            : 'El archivo original no tiene una huella SHA-256 valida.',
      };

      const history = storedVersions
        .filter(
          (version) =>
            !(version.version_number === 1 && version.sha256 === document.file_hash_sha256)
        )
        .map((version) => ({
          key: `version:${version.id}`,
          id: version.id,
          variant: 'version',
          number: version.version_number,
          status: version.status,
          label: `v${version.version_number} - ${statusLabel(version.status)}`,
          sha256: isValidSha256(version.sha256) ? version.sha256.toLowerCase() : '',
          byteSize: version.byte_size,
          mimeType: version.mime_type,
          editable: EDITABLE_VERSION_STATUSES.has(version.status),
          closed: Boolean(version.frozen_at || version.signed_at || version.status === 'signed'),
          available: Boolean(
            resolveLegacyDocumentStoragePath(version.storage_path, version.file_url) &&
            isValidSha256(version.sha256)
          ),
          createdAt: version.created_at,
          unavailableReason: !resolveLegacyDocumentStoragePath(
            version.storage_path,
            version.file_url
          )
            ? 'El archivo de esta version no se encuentra en Storage.'
            : !isValidSha256(version.sha256)
              ? 'Esta version no tiene una huella SHA-256 valida.'
              : null,
        }));

      const maxNumber = Math.max(
        1,
        ...storedVersions.map((version) => version.version_number || 0)
      );
      const certified =
        document.sealed_pdf_path && isValidSha256(document.sealed_pdf_hash)
          ? [
              {
                key: 'certified',
                id: null,
                variant: 'certified',
                number: maxNumber + 1,
                status: 'certified',
                label: `v${maxNumber + 1} - Certificada`,
                sha256: document.sealed_pdf_hash,
                byteSize: document.file_size,
                mimeType: 'application/pdf',
                editable: false,
                closed: true,
                available: true,
                createdAt: document.sealed_at || document.updated_at || document.created_at,
                unavailableReason: null,
              },
            ]
          : [];
      const versions = [original, ...history, ...certified];
      const closed =
        certified.length > 0 ||
        ['completado', 'firmado', 'certificado'].includes(normalize(document.estado));
      const usages = collectUsages(document.id);

      return {
        id: document.id,
        documentoId: document.documento_id,
        name: document.nombre || document.file_name,
        fileName: document.file_name,
        description: document.descripcion,
        status: document.estado || 'borrador',
        statusLabel: closed
          ? certified.length
            ? 'Certificado'
            : 'Completado'
          : statusLabel(document.estado || 'draft'),
        updatedAt: document.updated_at || document.created_at,
        closed,
        recommendedKey: original.key,
        versions,
        usageCount: usages.length,
        firstUsedAt:
          usages.length > 0
            ? usages.reduce((earliest, usage) =>
                new Date(String(usage.createdAt)).getTime() <
                new Date(String(earliest.createdAt)).getTime()
                  ? usage
                  : earliest
              ).createdAt
            : null,
        usages,
      };
    });

    return NextResponse.json(
      { documents },
      {
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );
  } catch (error) {
    if (error instanceof InternalSourceError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    console.error('[DOCUBOX][desde-docubox] No se pudo listar el repositorio:', error);
    return NextResponse.json(
      { error: 'No se pudo consultar el repositorio de Docubox.' },
      { status: 500 }
    );
  }
}
