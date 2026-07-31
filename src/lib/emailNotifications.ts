import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Lazy-initialize so this module is safe to import in client components.
// The actual Supabase client is only created when sendEmailNotification() is
// first called — which only happens server-side / in API routes where
// SUPABASE_SERVICE_ROLE_KEY is available.
let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('[emailNotifications] Missing Supabase credentials. This function must be called server-side.');
    }
    _supabase = createClient(url, key);
  }
  return _supabase;
}

type EmailType =
  | 'signature_request' |'document_completed' |'certificate_expiry' |'document_expired' |'action_required' |'participant_invitation' |'participation_completed' |'owner_participant_signed' |'owner_participant_approved' |'owner_participant_cancelled' |'owner_participant_rejected' |'new_device_login';

interface SendEmailParams {
  type: EmailType;
  to: string;
  recipientName?: string;
  documentName?: string;
  senderName?: string;
  expiryDate?: string;
  documentUrl?: string;
  completedAt?: string;
  expiredAt?: string;
  actionDescription?: string;
  // participant_invitation extras
  participantRole?: string;
  signatureMethod?: string;
  personalMessage?: string;
  documentDescription?: string;
  // participation_completed extras
  participationStatus?: 'firmado' | 'rechazado' | 'cancelado' | 'vencido';
  participationMotivo?: string;
  // owner_participant_* extras
  participantName?: string;
  participantEmail?: string;
  // new_device_login extras
  deviceName?: string;
  ipAddress?: string;
  city?: string;
  country?: string;
  loginTime?: string;
  // document_completed evidence extras
  documentId?: string;
  xmlEvidenciaPath?: string;
  nom151ConstanciaPath?: string;
  padesPath?: string;
}

export async function sendEmailNotification(params: SendEmailParams): Promise<void> {
  try {
    console.log(`[emailNotifications] Sending ${params.type} email to ${params.to}`);
    const { data, error } = await getSupabase().functions.invoke('send-email-notifications', {
      body: params,
    });
    if (error) {
      console.error(`[emailNotifications] Edge function invocation error for ${params.type} to ${params.to}:`, error.message, JSON.stringify(error));
      throw new Error(`Edge function error: ${error.message}`);
    }
    if (data && !data.success) {
      console.error(`[emailNotifications] Resend rejected ${params.type} to ${params.to}:`, JSON.stringify(data));
      throw new Error(`Resend error: ${data.error || JSON.stringify(data)}`);
    }
    console.log(`[emailNotifications] Successfully sent ${params.type} to ${params.to}`, data?.id ? `(id: ${data.id})` : '');
  } catch (err) {
    console.error(`[emailNotifications] FAILED sending ${params.type} to ${params.to}:`, err instanceof Error ? err.message : err);
    // Re-throw so callers can handle/log the failure
    throw err;
  }
}

export async function sendSignatureRequestEmails(params: {
  participants: Array<{ email?: string; name?: string }>;
  documentName: string;
  senderName: string;
  documentUrl?: string;
}): Promise<void> {
  const { participants, documentName, senderName, documentUrl } = params;
  const emailParticipants = participants.filter((p) => p.email && p.email.includes('@'));
  const results = await Promise.allSettled(
    emailParticipants.map((p) =>
      sendEmailNotification({
        type: 'signature_request',
        to: p.email!,
        recipientName: p.name,
        documentName,
        senderName,
        documentUrl,
      })
    )
  );
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[emailNotifications] signature_request failed for ${emailParticipants[i]?.email}:`, r.reason);
    }
  });
}

export async function sendDocumentCompletedEmail(params: {
  ownerEmail: string;
  ownerName?: string;
  documentName: string;
  completedAt?: string;
  documentUrl?: string;
  documentId?: string;
  xmlEvidenciaPath?: string;
  nom151ConstanciaPath?: string;
  padesPath?: string;
}): Promise<void> {
  await sendEmailNotification({
    type: 'document_completed',
    to: params.ownerEmail,
    recipientName: params.ownerName,
    documentName: params.documentName,
    completedAt: params.completedAt || new Date().toISOString(),
    documentUrl: params.documentUrl,
    documentId: params.documentId,
    xmlEvidenciaPath: params.xmlEvidenciaPath,
    nom151ConstanciaPath: params.nom151ConstanciaPath,
    padesPath: params.padesPath,
  });
}

/**
 * Sends document_completed emails to ALL signers (owner + participants)
 * including references to the auto-generated XML evidence, NOM-151 constancia, and PAdES document.
 */
export async function sendDocumentCompletedToAllSigners(params: {
  ownerEmail?: string;
  ownerName?: string;
  participants: Array<{ email?: string; nombre?: string; name?: string }>;
  documentName: string;
  documentId: string;
  completedAt?: string;
  xmlEvidenciaPath?: string;
  nom151ConstanciaPath?: string;
  padesPath?: string;
}): Promise<void> {
  const {
    ownerEmail,
    ownerName,
    participants,
    documentName,
    documentId,
    completedAt,
    xmlEvidenciaPath,
    nom151ConstanciaPath,
    padesPath,
  } = params;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://firmamax4272.builtwithrocket.new';
  const documentUrl = `${siteUrl}/visor-documento/${documentId}`;
  const completedAtTs = completedAt || new Date().toISOString();

  const recipients: Array<{ email: string; name?: string }> = [];

  if (ownerEmail && ownerEmail.includes('@')) {
    recipients.push({ email: ownerEmail, name: ownerName });
  }

  for (const p of participants) {
    const email = p.email;
    if (email && email.includes('@') && email !== ownerEmail) {
      recipients.push({ email, name: p.nombre || p.name });
    }
  }

  if (recipients.length === 0) {
    console.warn('[emailNotifications] sendDocumentCompletedToAllSigners: no valid recipients found.');
    return;
  }

  console.log(`[emailNotifications] Sending document_completed to ${recipients.length} recipients for document ${documentId}`);

  const results = await Promise.allSettled(
    recipients.map((r) =>
      sendEmailNotification({
        type: 'document_completed',
        to: r.email,
        recipientName: r.name,
        documentName,
        completedAt: completedAtTs,
        documentUrl,
        documentId,
        xmlEvidenciaPath,
        nom151ConstanciaPath,
        padesPath,
      })
    )
  );

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[emailNotifications] document_completed failed for ${recipients[i]?.email}:`, r.reason);
    }
  });
}

export async function sendCertificateExpiryEmail(params: {
  ownerEmail: string;
  ownerName?: string;
  documentName: string;
  expiryDate: string;
}): Promise<void> {
  await sendEmailNotification({
    type: 'certificate_expiry',
    to: params.ownerEmail,
    recipientName: params.ownerName,
    documentName: params.documentName,
    expiryDate: params.expiryDate,
  });
}

export async function sendDocumentExpiredEmail(params: {
  recipientEmail: string;
  recipientName?: string;
  documentName: string;
  expiredAt?: string;
}): Promise<void> {
  await sendEmailNotification({
    type: 'document_expired',
    to: params.recipientEmail,
    recipientName: params.recipientName,
    documentName: params.documentName,
    expiredAt: params.expiredAt || new Date().toISOString(),
  });
}

export async function sendActionRequiredEmail(params: {
  recipientEmail: string;
  recipientName?: string;
  documentName: string;
  senderName?: string;
  documentUrl?: string;
  actionDescription?: string;
}): Promise<void> {
  await sendEmailNotification({
    type: 'action_required',
    to: params.recipientEmail,
    recipientName: params.recipientName,
    documentName: params.documentName,
    senderName: params.senderName,
    documentUrl: params.documentUrl,
    actionDescription: params.actionDescription,
  });
}

export async function sendDocumentExpiredToAll(params: {
  participants: Array<{ email?: string; nombre?: string; name?: string }>;
  ownerEmail?: string;
  ownerName?: string;
  documentName: string;
  expiredAt?: string;
}): Promise<void> {
  const { participants, ownerEmail, ownerName, documentName, expiredAt } = params;
  const recipients: Array<{ email: string; name?: string }> = [];

  if (ownerEmail && ownerEmail.includes('@')) {
    recipients.push({ email: ownerEmail, name: ownerName });
  }

  for (const p of participants) {
    const email = p.email;
    if (email && email.includes('@') && email !== ownerEmail) {
      recipients.push({ email, name: p.nombre || p.name });
    }
  }

  const results = await Promise.allSettled(
    recipients.map((r) =>
      sendDocumentExpiredEmail({
        recipientEmail: r.email,
        recipientName: r.name,
        documentName,
        expiredAt,
      })
    )
  );
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[emailNotifications] document_expired failed for ${recipients[i]?.email}:`, r.reason);
    }
  });
}

export async function sendParticipantInvitationEmails(params: {
  participants: Array<{
    email?: string;
    name?: string;
    acto?: string;
    tipoFirma?: string[];
    tipoNotificacion?: string[];
    mensajePersonalizado?: string;
    documentUrl?: string;
  }>;
  documentName: string;
  documentDescription?: string;
  senderName: string;
  documentUrl?: string;
}): Promise<void> {
  const { participants, documentName, documentDescription, senderName, documentUrl } = params;

  // Send only to participants who selected 'correo' or 'email' as notification method
  const emailParticipants = participants.filter((p) => {
    if (!p.email || !p.email.includes('@')) return false;
    // If tipoNotificacion is provided, require 'correo' or 'email' to be included
    if (p.tipoNotificacion && p.tipoNotificacion.length > 0) {
      const methods = p.tipoNotificacion.map((n) => n.toLowerCase());
      return methods.some((n) => n === 'correo' || n === 'email');
    }
    // If tipoNotificacion is not set, fall back to sending (backward compatibility)
    return true;
  });

  console.log(`[emailNotifications] sendParticipantInvitationEmails: ${emailParticipants.length} recipients (of ${participants.length} total participants)`);

  if (emailParticipants.length === 0) {
    console.warn('[emailNotifications] No participants with valid email found.');
    return;
  }

  const results = await Promise.allSettled(
    emailParticipants.map((p) => {
      const firmaLabel = (p.tipoFirma || [])
        .map((f) => {
          const map: Record<string, string> = { autografa: 'Firma Autógrafa Digital', efirma: 'e.Firma SAT', biometria: 'Biometría' };
          return map[f] || f;
        })
        .join(', ') || 'Firma Electrónica';

      // Use per-participant documentUrl if available, fall back to shared documentUrl
      const participantDocumentUrl = p.documentUrl || documentUrl;

      return sendEmailNotification({
        type: 'participant_invitation',
        to: p.email!,
        recipientName: p.name,
        documentName,
        documentDescription,
        senderName,
        documentUrl: participantDocumentUrl,
        participantRole: p.acto || 'Participante',
        signatureMethod: firmaLabel,
        personalMessage: p.mensajePersonalizado,
      });
    })
  );
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[emailNotifications] participant_invitation failed for ${emailParticipants[i]?.email}:`, r.reason);
    }
  });
}

export async function sendParticipationCompletionEmail(params: {
  participantEmail: string;
  participantName?: string;
  documentName: string;
  participationStatus: 'firmado' | 'rechazado' | 'cancelado' | 'vencido';
  completedAt?: string;
  participationMotivo?: string;
}): Promise<void> {
  if (!params.participantEmail || !params.participantEmail.includes('@')) {
    console.warn(`[emailNotifications] sendParticipationCompletionEmail: invalid email "${params.participantEmail}", skipping`);
    return;
  }
  await sendEmailNotification({
    type: 'participation_completed',
    to: params.participantEmail,
    recipientName: params.participantName,
    documentName: params.documentName,
    participationStatus: params.participationStatus,
    completedAt: params.completedAt || new Date().toISOString(),
    participationMotivo: params.participationMotivo,
  });
}

export async function sendParticipationCompletionEmailToAll(params: {
  participants: Array<{ email?: string; nombre?: string; name?: string; sub_estado?: string; motivo_rechazo?: string }>;
  documentName: string;
  participationStatus: 'firmado' | 'rechazado' | 'cancelado' | 'vencido';
  completedAt?: string;
  participationMotivo?: string;
}): Promise<void> {
  const { participants, documentName, participationStatus, completedAt, participationMotivo } = params;
  const emailParticipants = participants.filter((p) => p.email && p.email.includes('@'));

  console.log(`[emailNotifications] sendParticipationCompletionEmailToAll: ${emailParticipants.length} recipients, status=${participationStatus}`);

  const results = await Promise.allSettled(
    emailParticipants.map((p) =>
      sendParticipationCompletionEmail({
        participantEmail: p.email!,
        participantName: p.nombre || p.name,
        documentName,
        participationStatus,
        completedAt,
        participationMotivo: p.motivo_rechazo || participationMotivo,
      })
    )
  );
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[emailNotifications] participation_completed (${participationStatus}) failed for ${emailParticipants[i]?.email}:`, r.reason);
    }
  });
}

// ─── Owner notification emails ────────────────────────────────────────────────
// Sent to the document OWNER when a participant takes action

export async function sendOwnerParticipantActionEmail(params: {
  ownerEmail: string;
  ownerName?: string;
  documentName: string;
  participantName?: string;
  participantEmail?: string;
  action: 'firmado' | 'aprobado' | 'cancelado' | 'rechazado';
  motivo?: string;
  completedAt?: string;
}): Promise<void> {
  if (!params.ownerEmail || !params.ownerEmail.includes('@')) return;
  const typeMap: Record<string, EmailType> = {
    firmado: 'owner_participant_signed',
    aprobado: 'owner_participant_approved',
    cancelado: 'owner_participant_cancelled',
    rechazado: 'owner_participant_rejected',
  };
  await sendEmailNotification({
    type: typeMap[params.action] as EmailType,
    to: params.ownerEmail,
    recipientName: params.ownerName,
    documentName: params.documentName,
    participantName: params.participantName,
    participantEmail: params.participantEmail,
    participationMotivo: params.motivo,
    completedAt: params.completedAt || new Date().toISOString(),
  });
}

export async function sendNewDeviceLoginEmail(params: {
  userEmail: string;
  userName?: string;
  deviceName: string;
  ipAddress?: string;
  city?: string;
  country?: string;
  loginTime?: string;
}): Promise<void> {
  if (!params.userEmail || !params.userEmail.includes('@')) return;
  await sendEmailNotification({
    type: 'new_device_login',
    to: params.userEmail,
    recipientName: params.userName,
    deviceName: params.deviceName,
    ipAddress: params.ipAddress,
    city: params.city,
    country: params.country,
    loginTime: params.loginTime || new Date().toISOString(),
  });
}
