import {
  authorizePublicApi,
  beginPublicApiIdempotency,
  completePublicApiIdempotency,
  failPublicApiIdempotency,
  publicApiResponse,
} from '@/lib/public-api/server';
import { createPublicWebhook, publicWebhookSafeColumns } from '@/lib/public-api/webhooks';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const auth = await authorizePublicApi(request, 'webhooks.manage');
    const result = await auth.service
      .from('organization_webhook_endpoints')
      .select(publicWebhookSafeColumns)
      .eq('workspace_id', auth.credential.workspace_id)
      .order('created_at', { ascending: false });
    if (result.error) throw result.error;
    return Response.json({ data: result.data || [] });
  } catch (cause) {
    return publicApiResponse(cause);
  }
}

export async function POST(request: Request) {
  let idempotencyContext: {
    auth: Awaited<ReturnType<typeof authorizePublicApi>>;
    id: string;
  } | null = null;
  try {
    const auth = await authorizePublicApi(request, 'webhooks.manage', { limit: 20 });
    const body = await request.json();
    const idempotency = await beginPublicApiIdempotency(auth, request, 'webhooks.create', body);
    if (idempotency.replay) return idempotency.replay;
    idempotencyContext = { auth, id: idempotency.id };
    const created = await createPublicWebhook(auth, body);
    await completePublicApiIdempotency(auth, idempotency.id, 201, created);
    return Response.json(created, { status: 201 });
  } catch (cause) {
    if (idempotencyContext) {
      await failPublicApiIdempotency(idempotencyContext.auth, idempotencyContext.id).catch(
        () => undefined
      );
    }
    return publicApiResponse(cause);
  }
}
