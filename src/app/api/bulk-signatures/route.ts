import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
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
import { validateBulkRecipients, type BulkRecipientInput } from '@/lib/bulk-signatures/recipients';
import { resolveInternalDocumentSource } from '@/lib/documents/internal-source';
import { isPhaseEFeatureEnabled, PHASE_E_FEATURES } from '@/lib/phase-e/feature-flags';
import {
  consumeServerRateLimit,
  ServerRateLimitUnavailableError,
} from '@/lib/security/server-rate-limit';

export async function GET(request: NextRequest) {
  try {
    const user = await requireBulkSignatureUser(request);
    const workspaceId = new URL(request.url).searchParams.get('workspaceId');
    if (!workspaceId) throw new BulkSignatureError('Falta el espacio de trabajo.', 400);
    await assertBulkWorkspaceAccess(workspaceId, user.id);
    await assertBulkWorkspacePermission(request, workspaceId, 'bulk_signatures.read');
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
    const service = createServiceClient();
    validateCampaign(body);
    await assertBulkWorkspaceAccess(body.workspaceId, user.id);
    await assertBulkWorkspacePermission(request, body.workspaceId, 'bulk_signatures.create');
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateLimitAllowed = await consumeServerRateLimit({
      scope: 'bulk-signatures.create',
      identifiers: [user.id, body.workspaceId, ip],
      limit: 8,
      windowSeconds: 60,
    });
    if (!rateLimitAllowed) {
      throw new BulkSignatureError('Demasiadas solicitudes. Intenta de nuevo en un minuto.', 429);
    }
    const launchRequested = body.launch === true || Boolean(body.scheduledAt);
    if (launchRequested && !(await isPhaseEFeatureEnabled(service, PHASE_E_FEATURES.bulkRuntime))) {
      throw new BulkSignatureError('La ejecucion de Firmas Masivas no esta habilitada.', 409);
    }
    const validation = validateBulkRecipients(
      Array.isArray(body.recipients) ? body.recipients : []
    );
    if (body.scheduledAt && new Date(body.scheduledAt).getTime() <= Date.now()) {
      throw new BulkSignatureError('La fecha programada debe ser futura.', 400);
    }
    if (body.expiresAt && new Date(body.expiresAt).getTime() <= Date.now()) {
      throw new BulkSignatureError('La fecha limite debe ser futura.', 400);
    }
    if (
      !validation.total ||
      validation.errors.length ||
      validation.valid.length !== validation.total
    ) {
      return NextResponse.json(
        {
          error: 'Corrige los destinatarios antes de guardar la campana.',
          validation: {
            total: validation.total,
            valid: validation.valid.length,
            invalid: validation.errors.length,
            duplicateEmails: validation.duplicateEmails,
            errors: validation.errors.slice(0, 100),
          },
        },
        { status: 422 }
      );
    }
    const idempotencyKey = request.headers.get('idempotency-key') || randomUUID();
    if (idempotencyKey.length < 16 || idempotencyKey.length > 200) {
      throw new BulkSignatureError('La clave de idempotencia no es valida.', 400);
    }
    const source = await resolveInternalDocumentSource(service, user, {
      workspaceId: body.workspaceId,
      documentId: body.sourceDocumentId,
      versionId: body.sourceVersionId || null,
      variant: body.sourceVariant || 'original',
    });
    if (body.sourceSha256 && source.sha256 !== String(body.sourceSha256).toLowerCase()) {
      throw new BulkSignatureError(
        'La fuente cambio desde que fue seleccionada. Vuelve a elegirla.',
        409
      );
    }
    const sourceDocument = await service
      .from('documentos')
      .select(
        'nombre,descripcion,file_name,file_size,file_type,grupo_tipo_documento_id,tipo_documento_id,otro_tipo_documento,ruta_guardado,etiquetas_ids,campos_solicitados,impedir_impresion,evitar_copia_texto,impedir_modificacion,impedir_extraccion,evitar_montaje'
      )
      .eq('id', source.documentId)
      .eq('workspace_id', body.workspaceId)
      .is('deleted_at', null)
      .maybeSingle();
    if (sourceDocument.error || !sourceDocument.data) {
      throw new BulkSignatureError('El documento base ya no esta disponible.', 409);
    }
    const recipients = validation.valid.map((recipient: BulkRecipientInput) => ({
      source_row_id: recipient.sourceRowId,
      source_row_hash: createHash('sha256')
        .update(`${recipient.sourceRowId}:${recipient.email}`)
        .digest('hex'),
      name: recipient.name,
      email: recipient.email,
      phone: recipient.phone || '',
      payload: recipient.payload,
    }));
    const { data: campaignData, error } = await service.rpc(
      'create_bulk_campaign_with_recipients',
      {
        p_workspace_id: body.workspaceId,
        p_creator_id: user.id,
        p_idempotency_key: idempotencyKey,
        p_campaign: {
          name: body.name.trim(),
          description: body.description?.trim() || '',
          campaign_type: body.campaignType,
          source_type: body.sourceType || body.campaignType,
          priority: body.priority || 'normal',
          internal_reference: body.internalReference?.trim() || '',
          timezone: body.timezone || 'America/Mexico_City',
          expires_at: body.expiresAt || '',
          scheduled_at: body.scheduledAt || '',
          launch: body.launch === true,
          template_id: body.templateId || '',
          source_document_id: source.documentId,
          source_version_id: source.versionId || '',
          signature_policy: {
            method: body.signatureMethod || 'autograph_otp',
            workflow: body.workflowType || 'parallel',
          },
          identity_policy: { required: body.requireIdentity === true },
          notification_policy: { reminders: body.sendReminders !== false },
          source_configuration: {
            sourceName: body.sourceName || null,
            source_document_name: body.sourceDocumentName || source.fileName,
            schema_version: 1,
          },
          source_snapshot: {
            document_id: source.documentId,
            version_id: source.versionId,
            variant: source.variant,
            documento_id: source.documentoId,
            version_number: source.versionNumber,
            version_status: source.versionStatus,
            sha256: source.sha256,
            storage_path: source.storagePath,
            file_name: source.fileName,
            mime_type: source.fileType,
            byte_size: source.fileSize,
            captured_at: new Date().toISOString(),
            document_configuration: sourceDocument.data,
          },
          source_name: body.sourceName || 'lista',
        },
        p_recipients: recipients,
      }
    );
    const campaign = Array.isArray(campaignData) ? campaignData[0] : campaignData;
    if (error || !campaign) {
      throw new BulkSignatureError(error?.message || 'No se pudo crear la campana.', 500);
    }
    await appendBulkCampaignEvent({
      campaignId: campaign.id,
      workspaceId: body.workspaceId,
      eventType: 'CAMPAIGN_CREATED',
      actorId: user.id,
      request,
      metadata: { campaignType: body.campaignType, totalItems: validation.total },
      eventKey: 'campaign:created',
    });
    return NextResponse.json({ data: campaign }, { status: 201 });
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

function validateCampaign(body: Record<string, unknown>) {
  if (!body.workspaceId) throw new BulkSignatureError('Falta el espacio de trabajo.', 400);
  if (typeof body.name !== 'string' || !body.name.trim()) {
    throw new BulkSignatureError('Escribe el nombre de la campana.', 400);
  }
  if (!/^[0-9a-f-]{36}$/i.test(String(body.sourceDocumentId || ''))) {
    throw new BulkSignatureError('Selecciona un documento base desde Docubox.', 400);
  }
  if (
    typeof body.campaignType !== 'string' ||
    !['multiple_documents', 'template', 'shared_document', 'document_package'].includes(
      body.campaignType
    )
  ) {
    throw new BulkSignatureError('Selecciona un origen valido.', 400);
  }
  const recipients = Number(body.recipientCount || 0);
  if (!Number.isFinite(recipients) || recipients < 0 || recipients > 10000) {
    throw new BulkSignatureError('La cantidad de destinatarios no es valida.', 400);
  }
}
