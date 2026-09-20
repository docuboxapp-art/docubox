import type { NextRequest } from 'next/server';
import { readDocumentStorageObject } from '@/lib/crypto/document-encryption';
import { appendPackageEvent, canUserViewPackageResource } from '@/lib/document-package/server';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string; resourceId: string }> }
) {
  try {
    const { documentId, resourceId } = await context.params;
    const access = await requireDocumentAccess(request, documentId);
    const resourceResult = await access.service
      .from('document_package_resources')
      .select(
        'id,workspace_id,document_id,storage_bucket,storage_path,original_name,mime_type,sha256,interaction_mode,malware_scan_status'
      )
      .eq('id', resourceId)
      .eq('document_id', documentId)
      .is('deleted_at', null)
      .maybeSingle();
    if (resourceResult.error) throw resourceResult.error;
    const resource = resourceResult.data;
    if (!resource || resource.malware_scan_status === 'quarantined') {
      return Response.json(
        { error: 'Recurso no encontrado.' },
        { status: 404, headers: privateHeaders }
      );
    }
    const visibility = await canUserViewPackageResource({
      service: access.service,
      documentId,
      resourceId,
      user: access.user,
      privileged: access.role !== 'AUTHORIZED',
    });
    if (!visibility.allowed) {
      return Response.json(
        { error: 'Recurso no encontrado.' },
        { status: 404, headers: privateHeaders }
      );
    }
    const file = await readDocumentStorageObject({
      service: access.service,
      storageBucket: resource.storage_bucket,
      storagePath: resource.storage_path,
      expectedPlaintextSha256: resource.sha256,
      userId: access.user.id,
      requestId: request.headers.get('x-request-id'),
      accessEvent:
        request.nextUrl.searchParams.get('download') === '1'
          ? 'DOCUMENT_DOWNLOADED'
          : 'DOCUMENT_VIEWED',
    });
    const participant = visibility.participant;
    if (participant) {
      const interactionType =
        request.nextUrl.searchParams.get('download') === '1' ? 'downloaded' : 'viewed';
      const eventKey = `resource:${resourceId}:${participant.id}:${interactionType}`;
      await access.service.from('document_resource_interactions').upsert(
        {
          workspace_id: resource.workspace_id,
          document_id: documentId,
          resource_id: resourceId,
          participant_reference_id: participant.id,
          interaction_type: interactionType,
          event_key: eventKey,
        },
        { onConflict: 'document_id,event_key', ignoreDuplicates: true }
      );
      await appendPackageEvent({
        service: access.service,
        workspaceId: resource.workspace_id,
        documentId,
        participantReferenceId: participant.id,
        actorUserId: access.user.id,
        eventType: `package.resource.${interactionType}`,
        eventKey,
        payload: { resource_id: resourceId },
      });
    }
    const download = request.nextUrl.searchParams.get('download') === '1';
    return new Response(file.plaintext, {
      headers: {
        ...privateHeaders,
        'Content-Type': resource.mime_type,
        'Content-Length': String(file.plaintext.byteLength),
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(resource.original_name)}`,
      },
    });
  } catch (error) {
    const response = documentAccessResponse(error);
    return Response.json(response.body, { status: response.status, headers: privateHeaders });
  }
}
