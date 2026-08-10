import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  appendBulkCampaignEvent,
  assertBulkWorkspaceAccess,
  BulkSignatureError,
  bulkSignatureErrorResponse,
  requireBulkSignatureUser,
} from '@/lib/bulk-signatures/server';

export async function GET(request: NextRequest) {
  try {
    const user = await requireBulkSignatureUser(request);
    const workspaceId = new URL(request.url).searchParams.get('workspaceId');
    if (!workspaceId) throw new BulkSignatureError('Falta el espacio de trabajo.', 400);
    await assertBulkWorkspaceAccess(workspaceId, user.id);
    const { data, error } = await createServiceClient()
      .from('bulk_signature_campaigns')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false })
      .limit(100);
    if (error) throw new BulkSignatureError(error.message, 500);
    return NextResponse.json({ data: data || [] });
  } catch (error) {
    const value = bulkSignatureErrorResponse(error);
    return NextResponse.json({ error: value.message }, { status: value.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireBulkSignatureUser(request);
    const body = await request.json();
    validateCampaign(body);
    await assertBulkWorkspaceAccess(body.workspaceId, user.id);
    const idempotencyKey = request.headers.get('idempotency-key') || randomUUID();
    const { data: campaign, error } = await createServiceClient()
      .from('bulk_signature_campaigns')
      .insert({
        workspace_id: body.workspaceId,
        name: body.name.trim(),
        description: body.description?.trim() || null,
        campaign_type: body.campaignType,
        source_type: body.sourceType || body.campaignType,
        status: body.launch ? 'ready' : 'draft',
        owner_user_id: user.id,
        priority: body.priority || 'normal',
        internal_reference: body.internalReference?.trim() || null,
        timezone: body.timezone || 'America/Mexico_City',
        expires_at: body.expiresAt || null,
        signature_policy: {
          method: body.signatureMethod || 'autograph_otp',
          workflow: body.workflowType || 'parallel',
        },
        identity_policy: { required: body.requireIdentity === true },
        notification_policy: { reminders: body.sendReminders !== false },
        source_configuration: {
          sourceName: body.sourceName || null,
          recipientCount: Number(body.recipientCount || 0),
        },
        total_items: Number(body.recipientCount || 0),
        pending_items: Number(body.recipientCount || 0),
        participant_count: Number(body.recipientCount || 0),
        idempotency_key: idempotencyKey,
        created_by: user.id,
        updated_by: user.id,
      })
      .select('*')
      .single();
    if (error || !campaign) {
      if (error?.code === '23505') {
        const { data: existing } = await createServiceClient()
          .from('bulk_signature_campaigns')
          .select('*')
          .eq('workspace_id', body.workspaceId)
          .eq('idempotency_key', idempotencyKey)
          .single();
        if (existing) return NextResponse.json({ data: existing, reused: true });
      }
      throw new BulkSignatureError(error?.message || 'No se pudo crear la campana.', 500);
    }
    await appendBulkCampaignEvent({
      campaignId: campaign.id,
      workspaceId: body.workspaceId,
      eventType: 'CAMPAIGN_CREATED',
      actorId: user.id,
      request,
      metadata: { campaignType: body.campaignType, totalItems: body.recipientCount || 0 },
    });
    return NextResponse.json({ data: campaign }, { status: 201 });
  } catch (error) {
    const value = bulkSignatureErrorResponse(error);
    return NextResponse.json({ error: value.message }, { status: value.status });
  }
}

function validateCampaign(body: any) {
  if (!body.workspaceId) throw new BulkSignatureError('Falta el espacio de trabajo.', 400);
  if (!body.name?.trim()) throw new BulkSignatureError('Escribe el nombre de la campana.', 400);
  if (
    !['multiple_documents', 'template', 'shared_document', 'document_package'].includes(
      body.campaignType
    )
  ) {
    throw new BulkSignatureError('Selecciona un origen valido.', 400);
  }
  const recipients = Number(body.recipientCount || 0);
  if (!Number.isFinite(recipients) || recipients < 0 || recipients > 100000) {
    throw new BulkSignatureError('La cantidad de destinatarios no es valida.', 400);
  }
}
