import { randomUUID } from 'crypto';
import { z } from 'zod';
import { authenticateOrganizationRequest, organizationApiFailure } from '@/lib/organization/server';
import { normalizeCollaborationAccess } from '@/lib/collaboration/domain';
import { authorizeCollaborationRequest, recordCollaborationAudit } from '@/lib/collaboration/server';

export const runtime = 'nodejs';

const settingsSchema = z.object({
  workspace_id: z.string().uuid(),
  action: z.literal('update_settings'),
  settings: z.object({
    status: z.enum(['pending', 'configured', 'read_only', 'disabled']).optional(),
    primary_admin_member_id: z.string().uuid().nullable().optional(),
    backup_admin_member_id: z.string().uuid().nullable().optional(),
    default_comment_visibility: z.enum(['private', 'internal', 'shared', 'formal']).optional(),
    allow_external_comments: z.boolean().optional(),
    allow_external_downloads: z.boolean().optional(),
    watermark_external_files: z.boolean().optional(),
    default_due_days: z.number().int().min(1).max(365).optional(),
    default_sla_hours: z.number().int().min(1).max(8760).optional(),
    retention_days: z.number().int().min(30).max(36500).optional(),
    timezone: z.string().trim().min(1).max(120).optional(),
    notification_preferences: z.record(z.string(), z.unknown()).optional(),
    quiet_hours: z.record(z.string(), z.unknown()).optional(),
    enabled_unit_ids: z.array(z.string().uuid()).max(500).optional(),
    onboarding_completed_at: z.string().datetime().nullable().optional(),
  }).strict(),
});

const trialSchema = z.object({
  workspace_id: z.string().uuid(),
  action: z.literal('start_trial'),
  product_key: z.enum(['docubox_colabora', 'docubox_colabora_pro']).default('docubox_colabora'),
  idempotency_key: z.string().uuid().optional(),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspace_id') || '';
    const authenticated = await authenticateOrganizationRequest(request);
    const { data, error } = await authenticated.userClient.rpc('get_my_collaboration_access', {
      ws_id: workspaceId,
    });
    if (error) throw error;

    const access = normalizeCollaborationAccess(data);
    let settings = null;
    if (access.accessible) {
      const result = await authenticated.service
        .from('collaboration_settings')
        .select('*')
        .eq('workspace_id', workspaceId)
        .maybeSingle();
      if (result.error) throw result.error;
      settings = result.data;
    }
    return Response.json({ success: true, access, settings });
  } catch (error) {
    return organizationApiFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body?.action === 'start_trial') {
      const input = trialSchema.parse(body);
      const authenticated = await authenticateOrganizationRequest(request);
      const { data, error } = await authenticated.userClient.rpc('activate_collaboration_trial', {
        ws_id: input.workspace_id,
        requested_product_key: input.product_key,
        request_key: input.idempotency_key || randomUUID(),
      });
      if (error) throw error;
      return Response.json({ success: true, data });
    }

    const input = settingsSchema.parse(body);
    const { service, user } = await authorizeCollaborationRequest(
      request,
      input.workspace_id,
      'collaboration.manage_settings',
      true,
    );
    const result = await service
      .from('collaboration_settings')
      .update({ ...input.settings, updated_at: new Date().toISOString() })
      .eq('workspace_id', input.workspace_id)
      .select('*')
      .single();
    if (result.error) throw result.error;
    await recordCollaborationAudit(service, {
      workspaceId: input.workspace_id,
      actorUserId: user.id,
      eventType: 'collaboration.settings_updated',
      resourceType: 'collaboration_settings',
      resourceId: result.data.id,
      summary: 'Se actualizo la configuracion de Docubox Colabora.',
      payload: { changed_keys: Object.keys(input.settings) },
    });
    return Response.json({ success: true, data: result.data });
  } catch (error) {
    return organizationApiFailure(error);
  }
}
