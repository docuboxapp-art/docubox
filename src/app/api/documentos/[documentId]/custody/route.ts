import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  authorizeOrganizationRequest,
  OrganizationApiError,
  organizationApiFailure,
  requireOrganizationReauthentication,
} from '@/lib/organization/server';
import { isPhaseDFeatureEnabled, PHASE_D_FLAGS } from '@/lib/organization/phase-d';
import {
  crossTenantCustodyApiFailure,
  resolveDestinationOrganization,
} from '@/lib/organization/cross-tenant-custody';
import {
  consumeServerRateLimit,
  ServerRateLimitUnavailableError,
} from '@/lib/security/server-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const inputSchema = z.object({
  workspace_id: z.string().uuid(),
  custodian_member_id: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
  idempotency_key: z.string().min(16).max(240).optional(),
});

const crossTenantInputSchema = z.object({
  workspace_id: z.string().uuid(),
  destination_organization: z.string().trim().min(2).max(120),
  reason: z.string().trim().min(3).max(500),
  idempotency_key: z.string().min(16).max(240).optional(),
});

async function enforceCustodyRateLimit(request: Request, userId: string, documentId: string) {
  const ip =
    request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  return consumeServerRateLimit({
    scope: 'document.cross-tenant-custody.manage',
    identifiers: [documentId, userId, ip],
    limit: 10,
    windowSeconds: 60,
  });
}

export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    const workspaceId = z
      .string()
      .uuid()
      .parse(new URL(request.url).searchParams.get('workspace_id') || '');
    const { service } = await authorizeOrganizationRequest(request, workspaceId, 'resources.read');
    const document = await service
      .from('documentos')
      .select(
        'id,workspace_id,current_custodian_workspace_id,custody_updated_at,estado,legal_hold_active,legal_hold_status,retention_status,retention_until'
      )
      .eq('id', documentId)
      .maybeSingle();
    if (document.error) throw document.error;
    if (!document.data)
      throw new OrganizationApiError(404, 'document_not_found', 'Documento no encontrado.');
    const currentCustodianWorkspaceId =
      document.data.current_custodian_workspace_id || document.data.workspace_id;
    if (currentCustodianWorkspaceId !== workspaceId) {
      throw new OrganizationApiError(
        403,
        'custody_scope_denied',
        'La organización no tiene la custodia vigente del documento.'
      );
    }
    const [history, members, policies, assignments, transfers] = await Promise.all([
      service
        .from('document_custody_history')
        .select('*')
        .eq('document_id', documentId)
        .order('transferred_at', { ascending: false }),
      service
        .from('workspace_members')
        .select('id,user_id,role,status,user_profiles(full_name,email)')
        .eq('workspace_id', workspaceId)
        .eq('status', 'active'),
      service
        .from('organization_retention_policies')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('status', 'active')
        .order('name'),
      service
        .from('document_retention_policy_assignments')
        .select('*,organization_retention_policies(name)')
        .eq('document_id', documentId)
        .order('applied_at', { ascending: false }),
      service
        .from('document_custody_transfers')
        .select(
          'id,source_workspace_id,destination_workspace_id,requested_at,reason,status,accepted_at,rejected_at,cancelled_at,completed_at,expires_at,correlation_id'
        )
        .eq('document_id', documentId)
        .order('requested_at', { ascending: false }),
    ]);
    for (const result of [history, members, policies, assignments, transfers])
      if (result.error) throw result.error;

    const workspaceIds = [
      ...new Set(
        (transfers.data || []).flatMap((transfer) => [
          transfer.source_workspace_id,
          transfer.destination_workspace_id,
        ])
      ),
    ];
    const workspaceResult = workspaceIds.length
      ? await service.from('workspaces').select('id,name,workspace_slug').in('id', workspaceIds)
      : { data: [], error: null };
    if (workspaceResult.error) throw workspaceResult.error;
    const workspaceNames = new Map(
      (workspaceResult.data || []).map((workspace) => [workspace.id, workspace.name])
    );
    return Response.json({
      success: true,
      document: document.data,
      history: history.data || [],
      members: members.data || [],
      policies: policies.data || [],
      assignments: assignments.data || [],
      transfers: (transfers.data || []).map((transfer) => ({
        ...transfer,
        source_name: workspaceNames.get(transfer.source_workspace_id) || 'Organización origen',
        destination_name:
          workspaceNames.get(transfer.destination_workspace_id) || 'Organización destino',
      })),
      cross_tenant_enabled: await isPhaseDFeatureEnabled(service, PHASE_D_FLAGS.crossTenantCustody),
    });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    const input = crossTenantInputSchema.parse(await request.json());
    const { user, service } = await authorizeOrganizationRequest(
      request,
      input.workspace_id,
      'documents.custody.transfer'
    );
    if (!(await isPhaseDFeatureEnabled(service, PHASE_D_FLAGS.crossTenantCustody))) {
      return Response.json({ success: false, code: 'feature_disabled' }, { status: 404 });
    }
    if (!(await enforceCustodyRateLimit(request, user.id, documentId))) {
      return Response.json(
        { success: false, error: 'Demasiadas solicitudes. Intenta nuevamente más tarde.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }
    await requireOrganizationReauthentication(
      request,
      input.workspace_id,
      user.id,
      'documents.custody.transfer'
    );
    const destination = await resolveDestinationOrganization(
      service,
      input.destination_organization
    );
    if (!destination) {
      throw new OrganizationApiError(
        400,
        'destination_not_eligible',
        'La organización destino no está disponible para recibir custodia.'
      );
    }
    const correlationId = randomUUID();
    const result = await service.rpc('request_cross_tenant_custody_transfer', {
      p_document_id: documentId,
      p_source_workspace_id: input.workspace_id,
      p_destination_workspace_id: destination.id,
      p_actor_user_id: user.id,
      p_reason: input.reason,
      p_idempotency_key: input.idempotency_key || randomUUID(),
      p_correlation_id: correlationId,
      p_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (result.error) throw result.error;
    return Response.json(
      {
        success: true,
        data: result.data,
        destination: { name: destination.name, workspace_slug: destination.workspace_slug },
      },
      { status: 201 }
    );
  } catch (cause) {
    if (cause instanceof ServerRateLimitUnavailableError) {
      return Response.json(
        { success: false, error: 'La protección de solicitudes no está disponible.' },
        { status: 503 }
      );
    }
    return crossTenantCustodyApiFailure(cause);
  }
}

export async function POST(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    const input = inputSchema.parse(await request.json());
    const { user, service } = await authorizeOrganizationRequest(
      request,
      input.workspace_id,
      'documents.custody.transfer'
    );
    if (!(await isPhaseDFeatureEnabled(service, PHASE_D_FLAGS.custody))) {
      return Response.json({ success: false, code: 'feature_disabled' }, { status: 404 });
    }
    const result = await service.rpc('transfer_document_custody', {
      p_document_id: documentId,
      p_workspace_id: input.workspace_id,
      p_actor_user_id: user.id,
      p_custodian_member_id: input.custodian_member_id,
      p_reason: input.reason,
      p_idempotency_key: input.idempotency_key || randomUUID(),
    });
    if (result.error) throw result.error;
    await service.from('organization_audit_events').insert({
      workspace_id: input.workspace_id,
      actor_user_id: user.id,
      event_type: 'document.custody_transferred',
      resource_type: 'document',
      resource_id: documentId,
      summary: 'Custodia documental transferida',
      payload: { custodian_member_id: input.custodian_member_id },
      outcome: 'success',
      severity: 'high',
      module: 'documents',
      origin: 'api',
      correlation_id: randomUUID(),
    });
    return Response.json({ success: true, data: result.data });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await context.params;
    const input = z
      .object({
        workspace_id: z.string().uuid(),
        policy_id: z.string().uuid(),
        reason: z.string().trim().max(500).nullable().optional(),
      })
      .parse(await request.json());
    const { user, service } = await authorizeOrganizationRequest(
      request,
      input.workspace_id,
      'retention.manage'
    );
    if (!(await isPhaseDFeatureEnabled(service, PHASE_D_FLAGS.retention))) {
      return Response.json({ success: false, code: 'feature_disabled' }, { status: 404 });
    }
    const result = await service.rpc('apply_document_retention_policy', {
      p_document_id: documentId,
      p_workspace_id: input.workspace_id,
      p_policy_id: input.policy_id,
      p_actor_user_id: user.id,
      p_reason: input.reason || null,
    });
    if (result.error) throw result.error;
    await service.from('organization_audit_events').insert({
      workspace_id: input.workspace_id,
      actor_user_id: user.id,
      event_type: 'document.retention_applied',
      resource_type: 'document',
      resource_id: documentId,
      summary: 'Politica de retencion aplicada',
      payload: { policy_id: input.policy_id },
      outcome: 'success',
      severity: 'high',
      module: 'retention',
      origin: 'api',
      correlation_id: randomUUID(),
    });
    return Response.json({ success: true, data: result.data });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}
