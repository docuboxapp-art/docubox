import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  authorizeOrganizationRequest,
  OrganizationApiError,
  organizationApiFailure,
} from '@/lib/organization/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const workspaceId = z
      .string()
      .uuid()
      .parse(new URL(request.url).searchParams.get('workspace_id'));
    const { service } = await authorizeOrganizationRequest(request, workspaceId, 'billing.read');
    const subscription = await service
      .from('subscriptions')
      .select(
        'id,status,current_period_start,current_period_end,documents_limit,documents_used,subscription_plans(name)'
      )
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (subscription.error) throw subscription.error;
    const history = subscription.data
      ? await service
          .from('subscription_history')
          .select(
            'id,plan_name,amount,interval,event_type,period_start,period_end,notes,created_at'
          )
          .eq('subscription_id', subscription.data.id)
          .order('created_at', { ascending: false })
          .limit(200)
      : { data: [], error: null };
    if (history.error) throw history.error;
    return Response.json(
      { success: true, subscription: subscription.data, history: history.data || [] },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}

const centerSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(30)
    .regex(/^[A-Z0-9._-]+$/),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  budget: z.number().nonnegative().max(999999999999.99).nullable().optional(),
  currency: z.string().trim().toUpperCase().length(3).default('MXN'),
  alert_threshold_percent: z.number().int().min(1).max(100).default(80),
});

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    const body = await request.json().catch(() => ({}));
    const workspaceId = z.string().uuid().parse(body.workspace_id);
    const action = String(body.action || '');
    const { user, service } = await authorizeOrganizationRequest(
      request,
      workspaceId,
      'billing.manage'
    );
    if (action !== 'create_cost_center')
      throw new OrganizationApiError(
        400,
        'unsupported_billing_action',
        'La operación solicitada no está disponible.'
      );
    const center = centerSchema.parse(body.cost_center || {});
    const inserted = await service
      .from('organization_cost_centers')
      .insert({
        workspace_id: workspaceId,
        ...center,
        description: center.description?.trim() || null,
      })
      .select('id')
      .single();
    if (inserted.error) throw inserted.error;
    const audit = await service.from('organization_audit_events').insert({
      workspace_id: workspaceId,
      actor_user_id: user.id,
      event_type: 'billing.cost_center.created',
      resource_type: 'organization_cost_center',
      resource_id: inserted.data.id,
      summary: 'Centro de costo creado',
      payload: { code: center.code, currency: center.currency },
      outcome: 'success',
      severity: 'info',
      module: 'billing',
      origin: 'api',
      correlation_id: requestId,
      ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      user_agent: request.headers.get('user-agent'),
    });
    if (audit.error) throw audit.error;
    return Response.json({ success: true, id: inserted.data.id }, { status: 201 });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}
