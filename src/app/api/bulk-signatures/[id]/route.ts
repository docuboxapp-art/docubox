import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  appendBulkCampaignEvent,
  assertBulkWorkspaceAccess,
  BulkSignatureError,
  bulkSignatureErrorResponse,
  requireBulkSignatureUser,
} from '@/lib/bulk-signatures/server';

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
      .select('workspace_id,status')
      .eq('id', id)
      .single();
    if (!current) throw new BulkSignatureError('La campana no existe.', 404);
    await assertBulkWorkspaceAccess(current.workspace_id, user.id);
    const allowedStatuses = ['ready', 'active', 'paused', 'cancelled', 'closed'];
    if (body.status && !allowedStatuses.includes(body.status)) {
      throw new BulkSignatureError('La transicion solicitada no esta permitida.', 400);
    }
    const update: Record<string, unknown> = { updated_by: user.id };
    if (body.name?.trim()) update.name = body.name.trim();
    if (body.status) {
      update.status = body.status;
      if (body.status === 'active') update.started_at = new Date().toISOString();
      if (body.status === 'closed') update.closed_at = new Date().toISOString();
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
      eventType: body.status ? `CAMPAIGN_${String(body.status).toUpperCase()}` : 'CAMPAIGN_UPDATED',
      actorId: user.id,
      request,
      metadata: { previousStatus: current.status, status: body.status || current.status },
    });
    return NextResponse.json({ data });
  } catch (error) {
    const value = bulkSignatureErrorResponse(error);
    return NextResponse.json({ error: value.message }, { status: value.status });
  }
}
