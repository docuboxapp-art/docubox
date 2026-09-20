import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  authorizeOrganizationRequest,
  requireOrganizationReauthentication,
} from '@/lib/organization/server';
import { isPhaseDFeatureEnabled, PHASE_D_FLAGS } from '@/lib/organization/phase-d';
import { crossTenantCustodyApiFailure } from '@/lib/organization/cross-tenant-custody';
import {
  consumeServerRateLimit,
  ServerRateLimitUnavailableError,
} from '@/lib/security/server-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const actionSchema = z.object({
  workspace_id: z.string().uuid(),
  transfer_id: z.string().uuid(),
  action: z.enum(['accept', 'reject', 'cancel']),
  reason: z.string().trim().min(3).max(500).optional(),
  idempotency_key: z.string().min(16).max(240).optional(),
});

async function enforceRateLimit(request: Request, workspaceId: string, userId: string) {
  const ip =
    request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  return consumeServerRateLimit({
    scope: 'organization.cross-tenant-custody.respond',
    identifiers: [workspaceId, userId, ip],
    limit: 20,
    windowSeconds: 60,
  });
}

export async function GET(request: Request) {
  try {
    const workspaceId = z
      .string()
      .uuid()
      .parse(new URL(request.url).searchParams.get('workspace_id') || '');
    const { service } = await authorizeOrganizationRequest(
      request,
      workspaceId,
      'documents.custody.receive'
    );
    if (!(await isPhaseDFeatureEnabled(service, PHASE_D_FLAGS.crossTenantCustody))) {
      return Response.json({ success: true, enabled: false, data: [] });
    }

    const expiration = await service.rpc('expire_cross_tenant_custody_transfers', {
      p_workspace_id: workspaceId,
      p_now: new Date().toISOString(),
    });
    if (expiration.error) throw expiration.error;

    const result = await service
      .from('document_custody_transfers')
      .select(
        'id,document_id,source_workspace_id,destination_workspace_id,requested_at,reason,status,accepted_at,rejected_at,rejection_reason,cancelled_at,completed_at,expires_at,correlation_id'
      )
      .eq('destination_workspace_id', workspaceId)
      .order('requested_at', { ascending: false });
    if (result.error) throw result.error;

    const documentIds = [...new Set((result.data || []).map((transfer) => transfer.document_id))];
    const sourceIds = [
      ...new Set((result.data || []).map((transfer) => transfer.source_workspace_id)),
    ];
    const [documents, sources] = await Promise.all([
      documentIds.length
        ? service
            .from('documentos')
            .select(
              'id,nombre,documento_id,estado,legal_hold_status,current_custodian_workspace_id'
            )
            .in('id', documentIds)
        : Promise.resolve({ data: [], error: null }),
      sourceIds.length
        ? service.from('workspaces').select('id,name,workspace_slug').in('id', sourceIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (documents.error) throw documents.error;
    if (sources.error) throw sources.error;
    const documentMap = new Map((documents.data || []).map((document) => [document.id, document]));
    const sourceMap = new Map((sources.data || []).map((source) => [source.id, source]));

    return Response.json({
      success: true,
      enabled: true,
      data: (result.data || []).map((transfer) => ({
        ...transfer,
        document: documentMap.get(transfer.document_id) || null,
        source_organization: sourceMap.get(transfer.source_workspace_id) || null,
      })),
    });
  } catch (cause) {
    return crossTenantCustodyApiFailure(cause);
  }
}

export async function POST(request: Request) {
  try {
    const input = actionSchema.parse(await request.json());
    if (input.action === 'reject' && !input.reason) {
      return Response.json(
        { success: false, error: 'Indica el motivo del rechazo.' },
        { status: 400 }
      );
    }
    const permission =
      input.action === 'cancel' ? 'documents.custody.transfer' : 'documents.custody.receive';
    const { user, service } = await authorizeOrganizationRequest(
      request,
      input.workspace_id,
      permission
    );
    if (!(await isPhaseDFeatureEnabled(service, PHASE_D_FLAGS.crossTenantCustody))) {
      return Response.json({ success: false, code: 'feature_disabled' }, { status: 404 });
    }
    if (!(await enforceRateLimit(request, input.workspace_id, user.id))) {
      return Response.json(
        { success: false, error: 'Demasiadas solicitudes. Intenta nuevamente más tarde.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }
    await requireOrganizationReauthentication(request, input.workspace_id, user.id, permission);
    const result = await service.rpc('resolve_cross_tenant_custody_transfer', {
      p_transfer_id: input.transfer_id,
      p_workspace_id: input.workspace_id,
      p_actor_user_id: user.id,
      p_action: input.action,
      p_reason: input.reason || '',
      p_idempotency_key: input.idempotency_key || randomUUID(),
    });
    if (result.error) throw result.error;
    return Response.json({ success: true, data: result.data });
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
