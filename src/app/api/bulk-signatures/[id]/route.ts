import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  appendBulkCampaignEvent,
  assertBulkWorkspaceAccess,
  assertBulkWorkspacePermission,
  BulkSignatureError,
  bulkSignatureErrorResponse,
  requireBulkSignatureUser,
} from '@/lib/bulk-signatures/server';
import { isPhaseEFeatureEnabled, PHASE_E_FEATURES } from '@/lib/phase-e/feature-flags';
import {
  consumeServerRateLimit,
  ServerRateLimitUnavailableError,
} from '@/lib/security/server-rate-limit';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireBulkSignatureUser(request);
    const { id } = await params;
    const { data: campaign, error } = await createServiceClient()
      .from('bulk_signature_campaigns')
      .select('*, bulk_campaign_items(*), bulk_campaign_incidents(*)')
      .eq('id', id)
      .single();
    if (error || !campaign) throw new BulkSignatureError('La campana no existe.', 404);
    await assertBulkWorkspaceAccess(campaign.workspace_id, user.id);
    await assertBulkWorkspacePermission(request, campaign.workspace_id, 'bulk_signatures.read');
    return NextResponse.json({ data: campaign });
  } catch (error) {
    const value = bulkSignatureErrorResponse(error);
    return NextResponse.json({ error: value.message }, { status: value.status });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireBulkSignatureUser(request);
    const { id } = await params;
    const body = await request.json();
    const supabase = createServiceClient();
    const { data: current } = await supabase
      .from('bulk_signature_campaigns')
      .select('id,workspace_id,status,scheduled_at,expires_at')
      .eq('id', id)
      .single();
    if (!current) throw new BulkSignatureError('La campana no existe.', 404);
    await assertBulkWorkspaceAccess(current.workspace_id, user.id);
    const action = String(body.action || 'update');
    const permission = action === 'cancel' ? 'bulk_signatures.cancel' : 'bulk_signatures.execute';
    await assertBulkWorkspacePermission(request, current.workspace_id, permission);
    const allowed = await consumeServerRateLimit({
      scope: 'bulk-signatures.mutate',
      identifiers: [user.id, current.workspace_id, id],
      limit: 20,
      windowSeconds: 60,
    });
    if (!allowed) throw new BulkSignatureError('Demasiadas solicitudes. Intenta nuevamente.', 429);

    if (
      ['launch', 'resume', 'reschedule', 'retry_item'].includes(action) &&
      !(await isPhaseEFeatureEnabled(supabase, PHASE_E_FEATURES.bulkRuntime))
    ) {
      throw new BulkSignatureError('La ejecucion de Firmas Masivas no esta habilitada.', 409);
    }
    if (
      ['completed', 'closed', 'expired'].includes(current.status) ||
      (current.status === 'completed_with_exceptions' && action !== 'retry_item')
    ) {
      throw new BulkSignatureError('La campana ya no admite cambios operativos.', 409);
    }

    const update: Record<string, unknown> = { updated_by: user.id };
    if (body.name?.trim()) update.name = body.name.trim();
    if (action === 'pause') {
      if (!['ready', 'scheduled', 'processing', 'active'].includes(current.status)) {
        throw new BulkSignatureError('La campana no puede pausarse en su estado actual.', 409);
      }
      update.status = 'paused';
    } else if (action === 'cancel') {
      update.status = 'cancelled';
      const stopped = await supabase
        .from('bulk_signature_campaigns')
        .update(update)
        .eq('id', id)
        .eq('workspace_id', current.workspace_id)
        .select('*')
        .single();
      if (stopped.error) throw stopped.error;
      const itemDocuments = await supabase
        .from('bulk_campaign_items')
        .select('document_id,status')
        .eq('campaign_id', id)
        .eq('workspace_id', current.workspace_id);
      if (itemDocuments.error) throw itemDocuments.error;
      const cancellableDocumentIds = (itemDocuments.data || [])
        .filter((item) => item.document_id && item.status !== 'signed')
        .map((item) => item.document_id);
      const cancelledItems = await supabase
        .from('bulk_campaign_items')
        .update({
          status: 'cancelled',
          retryable: false,
          next_retry_at: null,
          claimed_by: null,
          claim_expires_at: null,
        })
        .eq('campaign_id', id)
        .neq('status', 'signed');
      if (cancelledItems.error) throw cancelledItems.error;
      const cancelledJobs = await supabase
        .from('bulk_campaign_jobs')
        .update({ status: 'cancelled', finished_at: new Date().toISOString() })
        .eq('campaign_id', id)
        .in('status', ['queued', 'running']);
      if (cancelledJobs.error) throw cancelledJobs.error;
      if (cancellableDocumentIds.length) {
        const cancelledDocuments = await supabase
          .from('documentos')
          .update({ estado: 'cancelado' })
          .eq('workspace_id', current.workspace_id)
          .in('id', cancellableDocumentIds)
          .not('estado', 'in', '(completado,firmado,certificado)');
        if (cancelledDocuments.error) throw cancelledDocuments.error;
      }
      await appendBulkCampaignEvent({
        campaignId: id,
        workspaceId: current.workspace_id,
        eventType: 'CAMPAIGN_CANCEL',
        actorId: user.id,
        request,
        metadata: { previousStatus: current.status, status: 'cancelled', action },
      });
      return NextResponse.json({ data: stopped.data });
    } else if (action === 'reschedule') {
      const scheduledAt = new Date(String(body.scheduledAt || ''));
      if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now() + 60_000) {
        throw new BulkSignatureError('La fecha programada debe ser futura.', 400);
      }
      update.status = 'scheduled';
      update.scheduled_at = scheduledAt.toISOString();
      await ensureRuntimeJob(supabase, current.workspace_id, id, scheduledAt.toISOString());
    } else if (action === 'launch' || action === 'resume') {
      update.status =
        current.scheduled_at && new Date(current.scheduled_at).getTime() > Date.now()
          ? 'scheduled'
          : 'ready';
      if (current.status !== 'paused') update.started_at = new Date().toISOString();
      await ensureRuntimeJob(
        supabase,
        current.workspace_id,
        id,
        update.status === 'scheduled' ? current.scheduled_at : new Date().toISOString()
      );
    } else if (action === 'retry_item') {
      const itemId = String(body.itemId || '');
      if (!/^[0-9a-f-]{36}$/i.test(itemId)) {
        throw new BulkSignatureError('La fila no es valida.', 400);
      }
      const item = await supabase
        .from('bulk_campaign_items')
        .select('id,document_id,status,retryable')
        .eq('id', itemId)
        .eq('campaign_id', id)
        .eq('workspace_id', current.workspace_id)
        .maybeSingle();
      if (item.error || !item.data) throw new BulkSignatureError('La fila no existe.', 404);
      if (item.data.status !== 'failed') {
        throw new BulkSignatureError('Solo pueden reintentarse filas con error.', 409);
      }
      if (item.data.retryable !== true) {
        throw new BulkSignatureError(
          'Esta fila requiere corregir sus datos antes de reintentar.',
          409
        );
      }
      const retried = await supabase
        .from('bulk_campaign_items')
        .update({
          status: item.data.document_id ? 'queued' : 'ready',
          retryable: true,
          failure_stage: null,
          next_retry_at: new Date().toISOString(),
          error_code: null,
          error_message: null,
        })
        .eq('id', itemId)
        .eq('status', 'failed');
      if (retried.error) throw retried.error;
      update.status = 'ready';
      await ensureRuntimeJob(supabase, current.workspace_id, id, new Date().toISOString());
    } else if (action !== 'update') {
      throw new BulkSignatureError('La operacion solicitada no esta permitida.', 400);
    }
    const { data, error } = await supabase
      .from('bulk_signature_campaigns')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new BulkSignatureError(error.message, 500);
    await appendBulkCampaignEvent({
      campaignId: id,
      workspaceId: current.workspace_id,
      eventType: `CAMPAIGN_${action.toUpperCase()}`,
      eventKey:
        action === 'retry_item'
          ? `item:${String(body.itemId)}:manual-retry:${new Date().toISOString()}`
          : undefined,
      actorId: user.id,
      request,
      metadata: {
        previousStatus: current.status,
        status: data.status,
        action,
        itemId: body.itemId || null,
      },
    });
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof ServerRateLimitUnavailableError) {
      return NextResponse.json(
        { error: 'La proteccion de solicitudes no esta disponible temporalmente.' },
        { status: 503 }
      );
    }
    const value = bulkSignatureErrorResponse(error);
    return NextResponse.json({ error: value.message }, { status: value.status });
  }
}

async function ensureRuntimeJob(
  supabase: ReturnType<typeof createServiceClient>,
  workspaceId: string,
  campaignId: string,
  availableAt: string
) {
  const result = await supabase.from('bulk_campaign_jobs').upsert(
    {
      workspace_id: workspaceId,
      campaign_id: campaignId,
      job_type: 'materialize_and_deliver',
      status: 'queued',
      batch_number: 1,
      batch_size: 25,
      idempotency_key: `bulk-materialize:${campaignId}`,
      available_at: availableAt,
      started_at: null,
      finished_at: null,
      error_message: null,
      metadata: { schema_version: 1 },
    },
    { onConflict: 'workspace_id,idempotency_key' }
  );
  if (result.error) throw result.error;
}
