import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authorizeOrganizationRequest, organizationApiFailure } from '@/lib/organization/server';
import { isPhaseDFeatureEnabled, PHASE_D_FLAGS } from '@/lib/organization/phase-d';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const workspaceSchema = z.string().uuid();
const createSchema = z.object({
  workspace_id: z.string().uuid(),
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  duration_value: z.number().int().min(1).max(1200),
  duration_unit: z.enum(['days', 'months', 'years']),
  completion_action: z.enum(['review', 'eligible_for_purge']).default('review'),
  applies_to: z.record(z.string(), z.unknown()).default({}),
});

export async function GET(request: Request) {
  try {
    const workspaceId = workspaceSchema.parse(
      new URL(request.url).searchParams.get('workspace_id') || ''
    );
    const { service } = await authorizeOrganizationRequest(request, workspaceId, 'retention.read');
    const enabled = await isPhaseDFeatureEnabled(service, PHASE_D_FLAGS.retention);
    if (!enabled) return Response.json({ success: true, enabled: false, data: [] });
    const result = await service
      .from('organization_retention_policies')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (result.error) throw result.error;
    return Response.json({ success: true, enabled: true, data: result.data || [] });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}

export async function POST(request: Request) {
  try {
    const input = createSchema.parse(await request.json());
    const { user, service } = await authorizeOrganizationRequest(
      request,
      input.workspace_id,
      'retention.manage'
    );
    if (!(await isPhaseDFeatureEnabled(service, PHASE_D_FLAGS.retention))) {
      return Response.json({ success: false, code: 'feature_disabled' }, { status: 404 });
    }
    const latest = await service
      .from('organization_retention_policies')
      .select('version')
      .eq('workspace_id', input.workspace_id)
      .eq('name', input.name)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest.error) throw latest.error;
    const inserted = await service
      .from('organization_retention_policies')
      .insert({
        workspace_id: input.workspace_id,
        name: input.name,
        description: input.description || null,
        version: Number(latest.data?.version || 0) + 1,
        duration_value: input.duration_value,
        duration_unit: input.duration_unit,
        completion_action: input.completion_action,
        applies_to: input.applies_to,
        created_by: user.id,
      })
      .select('*')
      .single();
    if (inserted.error) throw inserted.error;
    await service.from('organization_audit_events').insert({
      workspace_id: input.workspace_id,
      actor_user_id: user.id,
      event_type: 'retention.policy.created',
      resource_type: 'organization_retention_policy',
      resource_id: inserted.data.id,
      summary: 'Politica de retencion creada',
      payload: { version: inserted.data.version, duration_unit: input.duration_unit },
      outcome: 'success',
      severity: 'high',
      module: 'retention',
      origin: 'api',
      correlation_id: randomUUID(),
    });
    return Response.json({ success: true, data: inserted.data }, { status: 201 });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}
