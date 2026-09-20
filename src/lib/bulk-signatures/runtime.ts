import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { initializeCollaborationDocumentVersion } from '@/lib/collaboration/documents';
import {
  documentEncryptionPolicy,
  encryptAndUploadDocumentObject,
  readDocumentStorageObject,
} from '@/lib/crypto/document-encryption';
import { appendDocumentOperationalEvent } from '@/lib/documents/operational-events';
import {
  deliverDocumentInvitations,
  stampDeliveredParticipants,
  type DeliveryParticipant,
} from '@/lib/orchestration/document-delivery';
import { getParticipantPortalUrl } from '@/lib/publicAppUrl';
import { sendSignatureRequestSms } from '@/lib/smsNotifications';

const RETRYABLE_ERROR = /timeout|network|fetch|temporary|temporarily|ECONN|EAI_AGAIN|5\d\d/i;

// Supabase rows remain dynamic until generated database types cover this additive migration.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BulkRuntimeRow = Record<string, any>;

function oneRow(value: unknown) {
  return (Array.isArray(value) ? value[0] : value) as BulkRuntimeRow | null;
}

function signingTypes(method: unknown) {
  if (method === 'efirma') return ['efirma'];
  if (method === 'click_sign') return ['click_sign'];
  if (method === 'biometric') return ['biometria'];
  return ['autografa'];
}

function safeDocumentNumber(id: string) {
  return `DOC-BULK-${id.replaceAll('-', '').slice(0, 16).toUpperCase()}`;
}

function sanitizeError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : 'BULK_RUNTIME_FAILED';
  return message.replace(/[\r\n]+/g, ' ').slice(0, 1000);
}

function retryableError(cause: unknown) {
  const message = sanitizeError(cause);
  return RETRYABLE_ERROR.test(message) || cause instanceof TypeError;
}

async function appendCampaignEvent(
  service: SupabaseClient,
  input: {
    campaignId: string;
    workspaceId: string;
    actorId?: string | null;
    eventType: string;
    eventKey: string;
    metadata?: Record<string, unknown>;
  }
) {
  const result = await service.from('bulk_campaign_events').insert({
    campaign_id: input.campaignId,
    workspace_id: input.workspaceId,
    event_type: input.eventType,
    event_key: input.eventKey,
    actor_id: input.actorId || null,
    correlation_id: randomUUID(),
    metadata: input.metadata || {},
  });
  if (result.error && result.error.code !== '23505') throw result.error;
}

async function appendDocumentAuditOnce(
  service: SupabaseClient,
  input: {
    documentId: string;
    actorId: string;
    action: string;
    details: Record<string, unknown>;
  }
) {
  const existing = await service
    .from('audit_trail')
    .select('id')
    .eq('documento_id', input.documentId)
    .eq('action', input.action)
    .limit(1)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return;
  const inserted = await service.from('audit_trail').insert({
    documento_id: input.documentId,
    actor_id: input.actorId,
    action: input.action,
    category: 'firmas_masivas',
    details: input.details,
  });
  if (inserted.error) throw inserted.error;
}

async function assertCampaignExecutable(service: SupabaseClient, campaign: BulkRuntimeRow) {
  const current = await service
    .from('bulk_signature_campaigns')
    .select('status,expires_at')
    .eq('id', campaign.id)
    .eq('workspace_id', campaign.workspace_id)
    .maybeSingle();
  if (current.error) throw current.error;
  if (
    !current.data ||
    !['ready', 'scheduled', 'processing', 'active'].includes(current.data.status) ||
    (current.data.expires_at && new Date(current.data.expires_at).getTime() <= Date.now())
  ) {
    throw new Error('BULK_CAMPAIGN_NOT_EXECUTABLE');
  }
}

async function expireDueCampaigns(service: SupabaseClient, now: Date) {
  const campaigns = await service
    .from('bulk_signature_campaigns')
    .select('id,workspace_id')
    .in('status', ['draft', 'ready', 'scheduled', 'processing', 'active', 'paused'])
    .lte('expires_at', now.toISOString())
    .limit(50);
  if (campaigns.error) throw campaigns.error;
  for (const campaign of campaigns.data || []) {
    const items = await service
      .from('bulk_campaign_items')
      .select('document_id,status')
      .eq('campaign_id', campaign.id)
      .neq('status', 'signed');
    if (items.error) throw items.error;
    const documentIds = (items.data || [])
      .map((item) => item.document_id)
      .filter((id): id is string => Boolean(id));
    await service
      .from('bulk_campaign_items')
      .update({ status: 'expired', retryable: false, next_retry_at: null })
      .eq('campaign_id', campaign.id)
      .neq('status', 'signed');
    await service
      .from('bulk_campaign_jobs')
      .update({ status: 'cancelled', finished_at: now.toISOString() })
      .eq('campaign_id', campaign.id)
      .in('status', ['queued', 'running']);
    if (documentIds.length) {
      await service
        .from('documentos')
        .update({ estado: 'vencido' })
        .eq('workspace_id', campaign.workspace_id)
        .in('id', documentIds)
        .not('estado', 'in', '(completado,firmado,certificado)');
    }
    await service
      .from('bulk_signature_campaigns')
      .update({ status: 'expired' })
      .eq('id', campaign.id)
      .neq('status', 'completed');
  }
  return campaigns.data?.length || 0;
}

async function sourceBytes(
  service: SupabaseClient,
  campaign: BulkRuntimeRow,
  item: BulkRuntimeRow
) {
  const snapshot = (campaign.source_snapshot || {}) as Record<string, unknown>;
  const expectedHash = String(item.source_sha256 || snapshot.sha256 || '').toLowerCase();
  const storagePath = String(snapshot.storage_path || '');
  if (!/^[0-9a-f]{64}$/.test(expectedHash) || !storagePath) {
    throw new Error('BULK_SOURCE_SNAPSHOT_INVALID');
  }
  const object = await readDocumentStorageObject({
    service,
    storageBucket: 'documents',
    storagePath,
    expectedPlaintextSha256: expectedHash,
    userId: campaign.created_by,
    requestId: `bulk-source:${item.id}`,
  });
  const actualHash = createHash('sha256').update(object.plaintext).digest('hex');
  if (actualHash !== expectedHash) {
    object.plaintext.fill(0);
    throw new Error('BULK_SOURCE_HASH_MISMATCH');
  }
  return { bytes: object.plaintext, snapshot, expectedHash };
}

function remapRequestedFields(fields: unknown, item: BulkRuntimeRow) {
  if (!Array.isArray(fields)) return [];
  return fields.map((value) => {
    if (!value || typeof value !== 'object') return value;
    const field = value as Record<string, unknown>;
    if (!field.participantId && field.placementKind !== 'participant') return field;
    return {
      ...field,
      participantId: item.id,
      participantName: item.participant_name,
    };
  });
}

async function materializeBulkItem(
  service: SupabaseClient,
  campaign: BulkRuntimeRow,
  item: BulkRuntimeRow
) {
  const documentId = String(item.materialization_document_id || '');
  if (!documentId) throw new Error('BULK_DOCUMENT_RESERVATION_MISSING');

  const existing = await service
    .from('documentos')
    .select('id,workspace_id,owner_id,participantes,nombre')
    .eq('id', documentId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    if (
      existing.data.workspace_id !== campaign.workspace_id ||
      existing.data.owner_id !== campaign.owner_user_id
    ) {
      throw new Error('BULK_DOCUMENT_RESERVATION_CONFLICT');
    }
  }

  const source = await service
    .from('documentos')
    .select(
      'id,workspace_id,nombre,descripcion,file_name,file_size,file_type,file_hash_sha256,grupo_tipo_documento_id,tipo_documento_id,otro_tipo_documento,ruta_guardado,etiquetas_ids,campos_solicitados,impedir_impresion,evitar_copia_texto,impedir_modificacion,impedir_extraccion,evitar_montaje'
    )
    .eq('id', item.source_document_id)
    .eq('workspace_id', campaign.workspace_id)
    .is('deleted_at', null)
    .maybeSingle();
  if (source.error) throw source.error;
  if (!source.data) throw new Error('BULK_SOURCE_NOT_FOUND');
  const sourceData = ((campaign.source_snapshot || {}) as Record<string, unknown>)
    .document_configuration as BulkRuntimeRow | undefined;
  if (!sourceData?.file_name) throw new Error('BULK_SOURCE_CONFIGURATION_MISSING');

  const displayName = `${sourceData.nombre || sourceData.file_name} - ${item.participant_name}`;

  if (!existing.data) {
    const participantUser = await service
      .from('user_profiles')
      .select('id')
      .eq('email', item.participant_email)
      .maybeSingle();
    if (participantUser.error) throw participantUser.error;

    const portalToken = randomUUID();
    const participant: DeliveryParticipant = {
      id: item.id,
      user_id: participantUser.data?.id || null,
      name: item.participant_name,
      email: item.participant_email,
      phone: item.participant_phone || null,
      role: 'firmante',
      acto: 'Firmante',
      rolDocumento: 'Firmante',
      tipoFirma: signingTypes(campaign.signature_policy?.method),
      tipoNotificacion: item.delivery_channel === 'sms' ? ['sms'] : ['correo'],
      delivery_mode: 'remote',
      routing_mode: 'immediate',
      visible: true,
      notificado: false,
      portal_token: portalToken,
      portal_token_hash: createHash('sha256').update(portalToken).digest('hex'),
      portal_token_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const inserted = await service
      .from('documentos')
      .insert({
        id: documentId,
        documento_id: safeDocumentNumber(documentId),
        owner_id: campaign.owner_user_id,
        workspace_id: campaign.workspace_id,
        file_name: sourceData.file_name,
        file_size: sourceData.file_size,
        file_type: sourceData.file_type,
        file_hash_sha256: item.source_sha256,
        nombre: displayName,
        descripcion: campaign.description || sourceData.descripcion || null,
        grupo_tipo_documento_id: sourceData.grupo_tipo_documento_id,
        tipo_documento_id: sourceData.tipo_documento_id,
        otro_tipo_documento: sourceData.otro_tipo_documento,
        ruta_guardado: sourceData.ruta_guardado || 'raiz',
        etiquetas_ids: sourceData.etiquetas_ids || [],
        estado: 'en_proceso',
        tiene_vencimiento: Boolean(campaign.expires_at),
        fecha_vencimiento: campaign.expires_at || null,
        participantes: [participant],
        campos_solicitados: remapRequestedFields(sourceData.campos_solicitados, item),
        participation_order: 'paralelo',
        grupos_firma: null,
        priority: campaign.priority === 'urgent' ? 'urgent' : 'normal',
        es_urgente: campaign.priority === 'urgent',
        es_publico: false,
        sello_digital: false,
        estampa_autenticacion: false,
        blockchain_evidence_enabled: true,
        impedir_impresion: sourceData.impedir_impresion === true,
        evitar_copia_texto: sourceData.evitar_copia_texto === true,
        impedir_modificacion: sourceData.impedir_modificacion === true,
        impedir_extraccion: sourceData.impedir_extraccion === true,
        evitar_montaje: sourceData.evitar_montaje === true,
      })
      .select('id')
      .single();
    if (inserted.error) {
      if (inserted.error.code === '23505') {
        const raced = await service
          .from('documentos')
          .select('id,workspace_id,owner_id')
          .eq('id', documentId)
          .maybeSingle();
        if (
          !raced.data ||
          raced.data.workspace_id !== campaign.workspace_id ||
          raced.data.owner_id !== campaign.owner_user_id
        ) {
          throw inserted.error;
        }
      } else {
        throw inserted.error;
      }
    }
  }

  const { bytes, snapshot, expectedHash } = await sourceBytes(service, campaign, item);
  try {
    const policy = documentEncryptionPolicy();
    if (policy.enabled) {
      const version = await initializeCollaborationDocumentVersion({
        service,
        workspaceId: campaign.workspace_id,
        documentId,
        actorUserId: campaign.owner_user_id,
        sha256: expectedHash,
        mimeType: String(snapshot.mime_type || sourceData.file_type || 'application/octet-stream'),
        byteSize: Number(snapshot.byte_size || sourceData.file_size || bytes.byteLength),
        displayName,
        sourceVersionId: item.source_version_id || null,
        requireCollaborationEntitlement: false,
      });
      if (!version.versionId) throw new Error('BULK_DOCUMENT_VERSION_MISSING');
      const storagePath = `tenants/${campaign.workspace_id}/documents/${documentId}/versions/${version.versionId}/payload.enc`;
      await encryptAndUploadDocumentObject({
        service,
        plaintext: bytes,
        tenantId: campaign.workspace_id,
        documentId,
        documentVersionId: version.versionId,
        artifactKind: 'document',
        storageBucket: 'documents',
        storagePath,
        originalFileName: sourceData.file_name,
        originalMimeType: sourceData.file_type,
        userId: campaign.owner_user_id,
        requestId: `bulk-materialize:${item.id}`,
      });
      const updated = await service
        .from('documentos')
        .update({
          file_url: `/api/documentos/${documentId}/viewer-file`,
          storage_path: storagePath,
        })
        .eq('id', documentId)
        .eq('workspace_id', campaign.workspace_id);
      if (updated.error) throw updated.error;
    } else {
      const version = await initializeCollaborationDocumentVersion({
        service,
        workspaceId: campaign.workspace_id,
        documentId,
        actorUserId: campaign.owner_user_id,
        sha256: expectedHash,
        fileUrl: `/api/documentos/${documentId}/viewer-file`,
        storagePath: String(snapshot.storage_path),
        mimeType: String(snapshot.mime_type || sourceData.file_type || 'application/octet-stream'),
        byteSize: Number(snapshot.byte_size || sourceData.file_size || bytes.byteLength),
        displayName,
        sourceVersionId: item.source_version_id || null,
        requireCollaborationEntitlement: false,
      });
      if (!version.versionId) throw new Error('BULK_DOCUMENT_VERSION_MISSING');
      const updated = await service
        .from('documentos')
        .update({
          file_url: `/api/documentos/${documentId}/viewer-file`,
          storage_path: String(snapshot.storage_path),
        })
        .eq('id', documentId)
        .eq('workspace_id', campaign.workspace_id);
      if (updated.error) throw updated.error;
    }
  } finally {
    bytes.fill(0);
  }

  const relation = await service
    .from('document_relations')
    .select('id')
    .eq('source_document_id', item.source_document_id)
    .eq('target_document_id', documentId)
    .eq('relation_type', 'derived_from')
    .maybeSingle();
  if (relation.error) throw relation.error;
  if (!relation.data) {
    const created = await service.from('document_relations').insert({
      workspace_id: campaign.workspace_id,
      source_document_id: item.source_document_id,
      source_version_id: item.source_version_id || null,
      target_document_id: documentId,
      relation_type: 'derived_from',
      source_sha256: item.source_sha256,
      target_initial_sha256: item.source_sha256,
      created_by: campaign.owner_user_id,
      metadata: {
        schema_version: 1,
        bulk_campaign_id: campaign.id,
        bulk_campaign_item_id: item.id,
        source_snapshot: true,
      },
    });
    if (created.error) throw created.error;
  }

  await appendDocumentOperationalEvent(service, {
    documentId,
    workspaceId: campaign.workspace_id,
    actorUserId: campaign.owner_user_id,
    eventType: 'document.created',
    eventKey: `bulk-materialized:${item.id}`,
    source: 'worker',
    payload: { bulk_campaign_id: campaign.id, bulk_campaign_item_id: item.id },
  });
  await appendDocumentAuditOnce(service, {
    documentId,
    actorId: campaign.owner_user_id,
    action: 'firma_masiva_instancia_materializada',
    details: { campaign_id: campaign.id, campaign_item_id: item.id },
  });
  await appendCampaignEvent(service, {
    campaignId: campaign.id,
    workspaceId: campaign.workspace_id,
    actorId: campaign.owner_user_id,
    eventType: 'CAMPAIGN_ITEM_MATERIALIZED',
    eventKey: `item:${item.id}:materialized`,
    metadata: { item_id: item.id, document_id: documentId },
  });
  return documentId;
}

async function deliverBulkItem(
  service: SupabaseClient,
  campaign: BulkRuntimeRow,
  item: BulkRuntimeRow
) {
  await assertCampaignExecutable(service, campaign);
  const document = await service
    .from('documentos')
    .select('id,workspace_id,owner_id,nombre,descripcion,participantes,estado')
    .eq('id', item.document_id)
    .eq('workspace_id', campaign.workspace_id)
    .maybeSingle();
  if (document.error) throw document.error;
  if (!document.data || ['cancelado', 'vencido', 'expirado'].includes(document.data.estado)) {
    throw new Error('BULK_DOCUMENT_NOT_ELIGIBLE');
  }
  const participants = Array.isArray(document.data.participantes)
    ? (document.data.participantes as DeliveryParticipant[])
    : [];
  let providerMessageId: string | null = null;

  if (item.delivery_channel === 'sms') {
    if (!item.participant_phone) throw new Error('BULK_SMS_PHONE_REQUIRED');
    const participant = participants.find((value) => value.id === item.id) || participants[0];
    const result = await sendSignatureRequestSms({
      phone: item.participant_phone,
      recipientName: item.participant_name,
      documentName: document.data.nombre,
      documentUrl: getParticipantPortalUrl(participant?.portal_token || document.data.id),
    });
    if (result.error) throw new Error(result.codigo_error || 'BULK_SMS_REJECTED');
    providerMessageId = result.response?.identificador
      ? JSON.stringify(result.response.identificador).slice(0, 500)
      : null;
  } else {
    const delivery = await deliverDocumentInvitations(service, {
      documentId: document.data.id,
      workspaceId: document.data.workspace_id,
      ownerId: document.data.owner_id,
      documentName: document.data.nombre,
      documentDescription: document.data.descripcion,
      participants,
    });
    if (delivery.attempted === 0 || delivery.sent.length === 0) {
      throw new Error(delivery.failed[0]?.error || 'BULK_EMAIL_DELIVERY_FAILED');
    }
    providerMessageId = delivery.sent[0]?.providerMessageId || null;
    const stamped = stampDeliveredParticipants(
      participants,
      delivery.sent.map((value) => value.email),
      new Date().toISOString()
    );
    const updated = await service
      .from('documentos')
      .update({ participantes: stamped })
      .eq('id', document.data.id)
      .eq('workspace_id', campaign.workspace_id);
    if (updated.error) throw updated.error;
  }

  await appendDocumentOperationalEvent(service, {
    documentId: document.data.id,
    workspaceId: campaign.workspace_id,
    actorUserId: campaign.owner_user_id,
    eventType: 'document.sent',
    eventKey: `bulk-send:${item.id}`,
    source: 'worker',
    payload: {
      bulk_campaign_id: campaign.id,
      bulk_campaign_item_id: item.id,
      delivery_channel: item.delivery_channel,
    },
  });
  await appendDocumentAuditOnce(service, {
    documentId: document.data.id,
    actorId: campaign.owner_user_id,
    action: 'firma_masiva_invitacion_enviada',
    details: {
      campaign_id: campaign.id,
      campaign_item_id: item.id,
      channel: item.delivery_channel,
      provider_message_id: providerMessageId,
    },
  });
  await appendCampaignEvent(service, {
    campaignId: campaign.id,
    workspaceId: campaign.workspace_id,
    actorId: campaign.owner_user_id,
    eventType: 'CAMPAIGN_ITEM_SENT',
    eventKey: `item:${item.id}:sent`,
    metadata: { item_id: item.id, document_id: document.data.id, channel: item.delivery_channel },
  });
  return providerMessageId;
}

async function campaignForItem(service: SupabaseClient, item: BulkRuntimeRow) {
  const campaign = await service
    .from('bulk_signature_campaigns')
    .select('*')
    .eq('id', item.campaign_id)
    .eq('workspace_id', item.workspace_id)
    .maybeSingle();
  if (campaign.error) throw campaign.error;
  if (!campaign.data) throw new Error('BULK_CAMPAIGN_NOT_FOUND');
  return campaign.data as BulkRuntimeRow;
}

async function failItem(
  service: SupabaseClient,
  item: BulkRuntimeRow,
  workerId: string,
  stage: 'materialization' | 'delivery',
  cause: unknown
) {
  const message = sanitizeError(cause);
  const retryable =
    stage === 'delivery' && item.delivery_channel === 'sms' ? false : retryableError(cause);
  const failed = await service.rpc('fail_bulk_campaign_item_attempt', {
    p_item_id: item.id,
    p_worker_id: workerId,
    p_stage: stage,
    p_error_code: message.slice(0, 120),
    p_error_message: message,
    p_retryable: retryable,
  });
  if (failed.error) throw failed.error;
  await service.from('bulk_campaign_incidents').insert({
    workspace_id: item.workspace_id,
    campaign_id: item.campaign_id,
    campaign_item_id: item.id,
    category: stage,
    code: message.slice(0, 120),
    severity: 'medium',
    message,
    retryable,
    attempt_count:
      stage === 'delivery' ? item.delivery_attempt_count || 1 : item.attempt_count || 1,
  });
}

async function releaseClaimAfterStateChange(
  service: SupabaseClient,
  item: BulkRuntimeRow,
  workerId: string
) {
  const campaign = await service
    .from('bulk_signature_campaigns')
    .select('status,expires_at')
    .eq('id', item.campaign_id)
    .eq('workspace_id', item.workspace_id)
    .maybeSingle();
  if (campaign.error) throw campaign.error;

  const paused = campaign.data?.status === 'paused';
  const expired =
    campaign.data?.status === 'expired' ||
    Boolean(
      campaign.data?.expires_at && new Date(campaign.data.expires_at).getTime() <= Date.now()
    );

  if (paused) {
    const released = await service
      .from('bulk_campaign_items')
      .update({
        status: item.document_id ? 'queued' : 'ready',
        retryable: true,
        next_retry_at: null,
        claimed_by: null,
        claim_expires_at: null,
        error_code: null,
        error_message: null,
      })
      .eq('id', item.id)
      .eq('claimed_by', workerId);
    if (released.error) throw released.error;
    return;
  }

  const documentId = item.document_id || item.materialization_document_id;
  if (documentId) {
    await service
      .from('documentos')
      .update({ estado: 'cancelado' })
      .eq('id', documentId)
      .eq('workspace_id', item.workspace_id)
      .not('estado', 'in', '(completado,firmado,certificado)');
  }
  await service
    .from('bulk_campaign_items')
    .update({
      status: expired ? 'expired' : 'cancelled',
      retryable: false,
      next_retry_at: null,
      claimed_by: null,
      claim_expires_at: null,
      error_code: 'CAMPAIGN_STATE_CHANGED',
      error_message: 'La campana dejo de ser ejecutable antes de completar la fila.',
    })
    .eq('id', item.id)
    .eq('claimed_by', workerId);
}

export async function processBulkSignatureCampaigns(
  service: SupabaseClient,
  options: { materializationLimit?: number; deliveryLimit?: number; now?: Date } = {}
) {
  const now = options.now || new Date();
  const materializationLimit = Math.min(Math.max(options.materializationLimit || 12, 1), 25);
  const deliveryLimit = Math.min(Math.max(options.deliveryLimit || 25, 1), 50);
  const workerId = `phase-e-bulk-${randomUUID()}`;
  const summary = {
    expiredCampaigns: await expireDueCampaigns(service, now),
    materialized: 0,
    delivered: 0,
    retrying: 0,
    failed: 0,
    skipped: 0,
  };

  for (let index = 0; index < materializationLimit; index += 1) {
    const claim = await service.rpc('claim_bulk_campaign_item_materialization', {
      p_worker_id: workerId,
      p_now: now.toISOString(),
    });
    if (claim.error) throw claim.error;
    const item = oneRow(claim.data);
    if (!item) break;
    try {
      const campaign = await campaignForItem(service, item);
      await assertCampaignExecutable(service, campaign);
      const documentId = await materializeBulkItem(service, campaign, item);
      await assertCampaignExecutable(service, campaign);
      const committed = await service.rpc('commit_bulk_campaign_item_materialization', {
        p_item_id: item.id,
        p_worker_id: workerId,
        p_document_id: documentId,
      });
      if (committed.error) throw committed.error;
      summary.materialized += 1;
    } catch (cause) {
      if (sanitizeError(cause) === 'BULK_CAMPAIGN_NOT_EXECUTABLE') {
        await releaseClaimAfterStateChange(service, item, workerId);
        summary.skipped += 1;
        continue;
      }
      await failItem(service, item, workerId, 'materialization', cause);
      if (retryableError(cause)) summary.retrying += 1;
      else summary.failed += 1;
    }
  }

  for (let index = 0; index < deliveryLimit; index += 1) {
    const claim = await service.rpc('claim_bulk_campaign_item_delivery', {
      p_worker_id: workerId,
      p_now: now.toISOString(),
    });
    if (claim.error) throw claim.error;
    const item = oneRow(claim.data);
    if (!item) break;
    try {
      const campaign = await campaignForItem(service, item);
      const providerMessageId = await deliverBulkItem(service, campaign, item);
      const completed = await service.rpc('complete_bulk_campaign_item_delivery', {
        p_item_id: item.id,
        p_worker_id: workerId,
        p_provider_message_id: providerMessageId,
      });
      if (completed.error) throw completed.error;
      summary.delivered += 1;
    } catch (cause) {
      if (sanitizeError(cause) === 'BULK_CAMPAIGN_NOT_EXECUTABLE') {
        await releaseClaimAfterStateChange(service, item, workerId);
        summary.skipped += 1;
        continue;
      }
      await failItem(service, item, workerId, 'delivery', cause);
      if (item.delivery_channel !== 'sms' && retryableError(cause)) summary.retrying += 1;
      else summary.failed += 1;
    }
  }
  return summary;
}
