import { appendDocumentOperationalEvent } from '@/lib/documents/operational-events';
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

function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat('es-MX', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request, route: { params: Promise<{ documentId: string }> }) {
  let idempotencyContext: {
    auth: Awaited<ReturnType<typeof authorizePublicApi>>;
    id: string;
  } | null = null;
  try {
    const auth = await authorizePublicApi(request, 'documents.schedule', { limit: 30 });
    const { documentId } = await route.params;
    const body = await request.json();
    const idempotency = await beginPublicApiIdempotency(
      auth,
      request,
      `document.schedule:${documentId}`,
      body
    );
    if (idempotency.replay) return idempotency.replay;
    idempotencyContext = { auth, id: idempotency.id };
    const scheduledAt = new Date(String(body.scheduled_at || ''));
    const timezone = String(body.timezone || 'UTC');
    if (
      Number.isNaN(scheduledAt.getTime()) ||
      scheduledAt.getTime() <= Date.now() ||
      !validTimezone(timezone)
    ) {
      throw new PublicApiError(
        400,
        'invalid_schedule',
        'Fecha futura y zona horaria valida son obligatorias.'
      );
    }
    const document = await assertPublicApiDocument(auth, documentId);
    if (!['borrador', 'programado'].includes(String(document.estado))) {
      throw new PublicApiError(
        409,
        'document_not_schedulable',
        'El documento no admite programacion.'
      );
    }
    const schedule = await auth.service
      .from('document_send_schedules')
      .upsert(
        {
          workspace_id: auth.credential.workspace_id,
          document_id: documentId,
          created_by: auth.credential.created_by,
          scheduled_at: scheduledAt.toISOString(),
          timezone,
          status: 'scheduled',
          idempotency_key: `public-api:${idempotency.id}`,
          payload: { source: 'public_api', credential_id: auth.credential.id, schema_version: 1 },
        },
        { onConflict: 'document_id' }
      )
      .select('id,scheduled_at,timezone,status')
      .single();
    if (schedule.error) throw schedule.error;
    const state = await auth.service
      .from('documentos')
      .update({ estado: 'programado' })
      .eq('id', documentId)
      .eq('workspace_id', auth.credential.workspace_id)
      .in('estado', ['borrador', 'programado']);
    if (state.error) throw state.error;
    const event = await appendDocumentOperationalEvent(auth.service, {
      documentId,
      workspaceId: auth.credential.workspace_id,
      actorUserId: auth.credential.created_by,
      eventType: 'document.send_scheduled',
      eventKey: `public-api-schedule:${idempotency.id}`,
      source: 'api',
      payload: {
        schedule_id: schedule.data.id,
        scheduled_at: schedule.data.scheduled_at,
        timezone,
      },
    });
    const responseBody = { data: { ...schedule.data, event_id: event.id } };
    await completePublicApiIdempotency(auth, idempotency.id, 201, responseBody);
    return Response.json(responseBody, { status: 201 });
  } catch (cause) {
    if (idempotencyContext) {
      await failPublicApiIdempotency(idempotencyContext.auth, idempotencyContext.id).catch(
        () => undefined
      );
    }
    return publicApiResponse(cause);
  }
}
