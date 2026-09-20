import { appendDocumentOperationalEvent } from '@/lib/documents/operational-events';
import {
  deliverDocumentInvitations,
  type DeliveryParticipant,
} from '@/lib/orchestration/document-delivery';
import {
  assertPublicApiDocument,
  authorizePublicApi,
  beginPublicApiIdempotency,
  completePublicApiIdempotency,
  failPublicApiIdempotency,
  PublicApiError,
  publicApiResponse,
} from '@/lib/public-api/server';

export const runtime = 'nodejs';

const terminal = new Set(['completado', 'cancelado', 'rechazado', 'vencido', 'expirado']);

export async function POST(request: Request, route: { params: Promise<{ documentId: string }> }) {
  let idempotencyContext: {
    auth: Awaited<ReturnType<typeof authorizePublicApi>>;
    id: string;
  } | null = null;
  try {
    const auth = await authorizePublicApi(request, 'documents.send', { limit: 30 });
    const { documentId } = await route.params;
    const body = await request.json().catch(() => ({}));
    const idempotency = await beginPublicApiIdempotency(
      auth,
      request,
      `document.send:${documentId}`,
      body
    );
    if (idempotency.replay) return idempotency.replay;
    idempotencyContext = { auth, id: idempotency.id };
    const document = await assertPublicApiDocument(auth, documentId);
    if (terminal.has(String(document.estado || '').toLowerCase())) {
      throw new PublicApiError(
        409,
        'document_not_sendable',
        'El documento no puede enviarse en su estado actual.'
      );
    }
    const participants = Array.isArray(document.participantes)
      ? (document.participantes as DeliveryParticipant[])
      : [];
    const visible = participants.map((participant) => ({
      ...participant,
      visible: participant.visible !== false,
    }));
    const delivery = await deliverDocumentInvitations(auth.service, {
      documentId,
      workspaceId: auth.credential.workspace_id,
      ownerId: document.owner_id,
      documentName: document.nombre || 'Documento',
      documentDescription: document.descripcion,
      participants: visible,
    });
    if (document.estado === 'borrador' || document.estado === 'programado') {
      const updated = await auth.service
        .from('documentos')
        .update({ estado: 'en_proceso', participantes: visible })
        .eq('id', documentId)
        .eq('workspace_id', auth.credential.workspace_id)
        .in('estado', ['borrador', 'programado']);
      if (updated.error) throw updated.error;
    }
    const event = await appendDocumentOperationalEvent(auth.service, {
      documentId,
      workspaceId: auth.credential.workspace_id,
      actorUserId: auth.credential.created_by,
      eventType: 'document.sent',
      eventKey: `public-api-send:${idempotency.id}`,
      source: 'api',
      payload: { credential_id: auth.credential.id, invitations_attempted: delivery.attempted },
    });
    const responseBody = {
      data: { document_id: documentId, status: 'sent', event_id: event.id, delivery },
    };
    await completePublicApiIdempotency(auth, idempotency.id, 202, responseBody);
    return Response.json(responseBody, { status: 202 });
  } catch (cause) {
    if (idempotencyContext) {
      await failPublicApiIdempotency(idempotencyContext.auth, idempotencyContext.id).catch(
        () => undefined
      );
    }
    return publicApiResponse(cause);
  }
}
