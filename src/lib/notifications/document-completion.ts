import 'server-only';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmailNotification } from '@/lib/emailNotifications';
import { getPublicAppUrl } from '@/lib/publicAppUrl';

type Recipient = {
  email: string;
  name?: string;
};

type DeliveryStatus = 'queued' | 'processing' | 'sent' | 'delivered' | 'failed' | 'bounced';

type DeliveryRow = {
  id: string;
  status: DeliveryStatus;
  provider_message_id: string | null;
  attempt_count: number;
};

export type DocumentCompletionDelivery = {
  id: string;
  recipientEmailSha256: string;
  status: DeliveryStatus;
  providerMessageId: string | null;
};

export class DocumentCompletionEmailError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 502
  ) {
    super(message);
    this.name = 'DocumentCompletionEmailError';
  }
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function recipientsForDocument(
  owner: { email?: string | null; full_name?: string | null } | null,
  participants: unknown
) {
  const recipients = new Map<string, Recipient>();
  const add = (emailValue: unknown, nameValue?: unknown) => {
    const email = normalizeEmail(emailValue);
    if (!email || !email.includes('@')) return;
    recipients.set(email, {
      email,
      name: String(nameValue || '').trim() || undefined,
    });
  };

  add(owner?.email, owner?.full_name);
  if (Array.isArray(participants)) {
    for (const participant of participants) {
      if (!participant || typeof participant !== 'object') continue;
      const row = participant as Record<string, unknown>;
      add(row.email, row.nombre || row.name || row.full_name);
    }
  }
  return [...recipients.values()];
}

async function auditedStage(
  service: SupabaseClient,
  input: {
    documentId: string;
    actorId: string;
    action: string;
    details: Record<string, unknown>;
  }
) {
  const logged = await service.from('document_activity_log').insert({
    documento_id: input.documentId,
    actor_id: input.actorId,
    actor_nombre: 'Docubox Certification Backend',
    actor_email: '',
    action: input.action,
    category: 'certificacion',
    details: input.details,
  });
  if (logged.error) {
    throw new DocumentCompletionEmailError(
      'DOCUMENT_COMPLETION_AUDIT_FAILED',
      'No se pudo registrar la etapa de notificación.',
      500
    );
  }
}

async function deliverOne(
  service: SupabaseClient,
  input: {
    workspaceId: string;
    documentId: string;
    certificationId: string;
    certificationUuid: string;
    documentName: string;
    completedAt: string;
    padesPath: string;
    nom151Path: string;
    recipient: Recipient;
  }
): Promise<DocumentCompletionDelivery> {
  const recipientEmailSha256 = sha256(input.recipient.email);
  const idempotencyKey = `document-completed/${input.certificationUuid}/${recipientEmailSha256}`;
  const inserted = await service
    .from('document_email_deliveries')
    .insert({
      workspace_id: input.workspaceId,
      document_id: input.documentId,
      document_certification_id: input.certificationId,
      recipient_email: input.recipient.email,
      recipient_email_sha256: recipientEmailSha256,
      idempotency_key: idempotencyKey,
      status: 'queued',
    })
    .select('id,status,provider_message_id,attempt_count')
    .maybeSingle();

  let row = inserted.data as DeliveryRow | null;
  if (inserted.error && inserted.error.code !== '23505') {
    throw new DocumentCompletionEmailError(
      'DOCUMENT_COMPLETION_EMAIL_QUEUE_FAILED',
      'No se pudo registrar la notificación de finalización.',
      500
    );
  }
  if (!row) {
    const existing = await service
      .from('document_email_deliveries')
      .select('id,status,provider_message_id,attempt_count')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (existing.error || !existing.data) {
      throw new DocumentCompletionEmailError(
        'DOCUMENT_COMPLETION_EMAIL_LOOKUP_FAILED',
        'No se pudo consultar la notificación de finalización.',
        500
      );
    }
    row = existing.data as DeliveryRow;
  }
  if (!row) {
    throw new DocumentCompletionEmailError(
      'DOCUMENT_COMPLETION_EMAIL_LOOKUP_FAILED',
      'No se pudo consultar la notificación de finalización.',
      500
    );
  }

  if (row.status === 'sent' || row.status === 'delivered' || row.status === 'bounced') {
    return {
      id: row.id,
      recipientEmailSha256,
      status: row.status,
      providerMessageId: row.provider_message_id,
    };
  }

  const claimed = await service
    .from('document_email_deliveries')
    .update({
      status: 'processing',
      processing_at: new Date().toISOString(),
      attempt_count: row.attempt_count + 1,
      failed_at: null,
      error_code: null,
      error_detail: {},
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .in('status', ['queued', 'failed'])
    .select('id')
    .maybeSingle();
  if (claimed.error) {
    throw new DocumentCompletionEmailError(
      'DOCUMENT_COMPLETION_EMAIL_CLAIM_FAILED',
      'No se pudo reservar la notificación de finalización.',
      500
    );
  }
  if (!claimed.data) {
    return {
      id: row.id,
      recipientEmailSha256,
      status: 'processing',
      providerMessageId: row.provider_message_id,
    };
  }

  try {
    const sent = await sendEmailNotification({
      type: 'document_completed',
      to: input.recipient.email,
      recipientName: input.recipient.name,
      documentName: input.documentName,
      completedAt: input.completedAt,
      documentUrl: `${getPublicAppUrl()}/visor-documento/${input.documentId}`,
      documentId: input.documentId,
      nom151ConstanciaPath: input.nom151Path,
      padesPath: input.padesPath,
      idempotencyKey,
    });
    const sentAt = new Date().toISOString();
    const updated = await service
      .from('document_email_deliveries')
      .update({
        status: 'sent',
        provider_message_id: sent.id || null,
        sent_at: sentAt,
        updated_at: sentAt,
      })
      .eq('id', row.id)
      .eq('status', 'processing');
    if (updated.error) {
      throw new DocumentCompletionEmailError(
        'DOCUMENT_COMPLETION_EMAIL_STATUS_FAILED',
        'El proveedor aceptó el correo, pero no se pudo persistir su estado.',
        500
      );
    }
    return {
      id: row.id,
      recipientEmailSha256,
      status: 'sent',
      providerMessageId: sent.id || null,
    };
  } catch (error) {
    const code =
      error instanceof DocumentCompletionEmailError
        ? error.code
        : 'DOCUMENT_COMPLETION_EMAIL_PROVIDER_FAILED';
    await service
      .from('document_email_deliveries')
      .update({
        status: 'failed',
        failed_at: new Date().toISOString(),
        error_code: code,
        error_detail: { message: 'El proveedor no confirmó el envío.' },
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('status', 'processing');
    if (error instanceof DocumentCompletionEmailError) throw error;
    throw new DocumentCompletionEmailError(code, 'No se pudo enviar el correo de finalización.');
  }
}

export async function queueVerifiedDocumentCompletionEmails(
  service: SupabaseClient,
  input: { documentId: string; certificationUuid: string; requestedBy: string }
) {
  const certificationResult = await service
    .from('document_certifications')
    .select(
      'id,workspace_id,certification_uuid,certified_pdf_path,pades_profile,status,execution_status,pdf_signature_status,certificate_status,timestamp_status,verification_status'
    )
    .eq('document_id', input.documentId)
    .eq('certification_uuid', input.certificationUuid)
    .maybeSingle();
  const certification = certificationResult.data;
  if (
    certificationResult.error ||
    !certification ||
    certification.status !== 'COMPLETED' ||
    certification.execution_status !== 'completed' ||
    certification.pades_profile !== 'PAdES-B-T' ||
    certification.pdf_signature_status !== 'valid' ||
    certification.certificate_status !== 'valid' ||
    certification.timestamp_status !== 'valid' ||
    certification.verification_status !== 'valid' ||
    !certification.certified_pdf_path
  ) {
    throw new DocumentCompletionEmailError(
      'DOCUMENT_COMPLETION_PADES_BT_REQUIRED',
      'El correo de finalización requiere una certificación PAdES-B-T verificada.',
      409
    );
  }

  const nom151Result = await service
    .from('nom151_constancias_doc')
    .select('id,constancia_path,status,verification_status')
    .eq('documento_id', input.documentId)
    .eq('document_certification_id', certification.id)
    .eq('status', 'issued')
    .eq('verification_status', 'verified')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (nom151Result.error || !nom151Result.data?.constancia_path) {
    throw new DocumentCompletionEmailError(
      'DOCUMENT_COMPLETION_NOM151_REQUIRED',
      'El correo de finalización requiere una constancia NOM-151 verificada.',
      409
    );
  }

  const documentResult = await service
    .from('documentos')
    .select('id,workspace_id,owner_id,nombre,file_name,fecha_completado,participantes')
    .eq('id', input.documentId)
    .maybeSingle();
  const document = documentResult.data;
  if (documentResult.error || !document?.workspace_id) {
    throw new DocumentCompletionEmailError(
      'DOCUMENT_COMPLETION_CONTEXT_MISSING',
      'No se encontró el contexto del documento para notificar.',
      500
    );
  }
  const ownerResult = await service
    .from('user_profiles')
    .select('email,full_name')
    .eq('id', document.owner_id)
    .maybeSingle();
  if (ownerResult.error) {
    throw new DocumentCompletionEmailError(
      'DOCUMENT_COMPLETION_OWNER_LOOKUP_FAILED',
      'No se pudo resolver al propietario del documento.',
      500
    );
  }

  const recipients = recipientsForDocument(ownerResult.data, document.participantes);
  if (recipients.length === 0) {
    throw new DocumentCompletionEmailError(
      'DOCUMENT_COMPLETION_RECIPIENTS_MISSING',
      'El documento no tiene destinatarios de correo válidos.',
      422
    );
  }

  await auditedStage(service, {
    documentId: input.documentId,
    actorId: input.requestedBy,
    action: 'document_completed_email_queued',
    details: {
      certification_uuid: certification.certification_uuid,
      recipients: recipients.length,
    },
  });

  const deliveries = await Promise.all(
    recipients.map((recipient) =>
      deliverOne(service, {
        workspaceId: document.workspace_id,
        documentId: input.documentId,
        certificationId: certification.id,
        certificationUuid: certification.certification_uuid,
        documentName: document.nombre || document.file_name || 'Documento',
        completedAt: document.fecha_completado || new Date().toISOString(),
        padesPath: certification.certified_pdf_path,
        nom151Path: nom151Result.data!.constancia_path!,
        recipient,
      })
    )
  );
  const complete = deliveries.every((delivery) =>
    ['sent', 'delivered', 'bounced'].includes(delivery.status)
  );
  await auditedStage(service, {
    documentId: input.documentId,
    actorId: input.requestedBy,
    action: complete ? 'document_completed_email_sent' : 'document_completed_email_processing',
    details: {
      certification_uuid: certification.certification_uuid,
      statuses: deliveries.map((delivery) => delivery.status),
    },
  });
  return { complete, deliveries };
}
