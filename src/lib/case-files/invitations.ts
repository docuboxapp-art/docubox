import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { wrapDocuboxEmail } from '../emailFooter.ts';

export type InvitationState =
  | 'pending'
  | 'sending'
  | 'retrying'
  | 'failed'
  | 'sent'
  | 'attention'
  | 'expired'
  | 'revoked'
  | 'scheduled';
export type InvitationSummary = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: InvitationState;
  sentAt: string | null;
  expiresAt: string;
  codeRequired?: boolean;
  codeSentAt?: string | null;
  scheduledAt?: string | null;
};
export type DeliverySummary = {
  total: number;
  sent: number;
  pending: number;
  failed: number;
  invitations: InvitationSummary[];
};
export type InvitationClaim = {
  kind?: 'code';
  id: string;
  case_file_id: string;
  claim_id: string;
  token_ciphertext: string;
  payload_ciphertext: string | null;
  recipient: string;
  recipient_name: string;
  participant_role: string;
  sender_name: string;
  case_title: string;
  folio: string;
  app_origin: string;
  expires_at: string;
};
export type InvitationEmail = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
};

const key = (secret: string) => {
  if (secret.length < 32) throw new Error('CASE_INVITATION_CONFIG');
  return createHash('sha256').update(`docubox-case-invitations-v1:${secret}`).digest();
};
export const hashInvitationToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');
export function encryptInvitationSecret(value: string, secret: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  cipher.setAAD(Buffer.from('case-invitation:v1'));
  const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), bytes].map((part) => part.toString('base64url')).join('.');
}
export function decryptInvitationSecret(value: string, secret: string) {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('CASE_INVITATION_CIPHER');
  const [iv, tag, bytes] = parts.map((part) => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', key(secret), iv);
  decipher.setAAD(Buffer.from('case-invitation:v1'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(bytes), decipher.final()]).toString('utf8');
}
export function createInvitationCredential(secret: string) {
  const token = randomBytes(32).toString('hex');
  return { hash: hashInvitationToken(token), ciphertext: encryptInvitationSecret(token, secret) };
}
export function summarizeInvitations(invitations: InvitationSummary[]): DeliverySummary {
  return {
    total: invitations.length,
    sent: invitations.filter(
      (i) =>
        (i.status === 'sent' || Boolean(i.sentAt)) && (!i.codeRequired || Boolean(i.codeSentAt))
    ).length,
    pending: invitations.filter((i) =>
      ['pending', 'sending', 'retrying', 'scheduled'].includes(i.status)
    ).length,
    failed: invitations.filter((i) =>
      ['failed', 'attention', 'expired', 'revoked'].includes(i.status)
    ).length,
    invitations,
  };
}
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!
  );
export function buildCaseInvitationEmail(
  invitation: InvitationClaim,
  token: string,
  from: string
): InvitationEmail {
  const codeMail = invitation.kind === 'code';
  let url = '';
  if (codeMail) {
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(token)) throw new Error('CASE_INVITATION_CODE');
  } else {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('CASE_INVITATION_TOKEN');
    const origin = new URL(invitation.app_origin);
    if (
      origin.origin !== invitation.app_origin ||
      !['https:', 'http:'].includes(origin.protocol) ||
      (origin.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(origin.hostname))
    )
      throw new Error('CASE_INVITATION_ORIGIN');
    url = `${origin.origin}/expediente/${token}`;
  }
  const title = invitation.case_title.replace(/[\r\n]+/g, ' ').trim();
  const sender = invitation.sender_name.replace(/[\r\n]+/g, ' ').trim();
  const role =
    (
      {
        subject: 'Titular',
        representative: 'Representante',
        contact: 'Contacto de seguimiento',
      } as Record<string, string>
    )[invitation.participant_role] || 'Participante';
  const expires =
    new Date(invitation.expires_at).toLocaleString('es-MX', {
      timeZone: 'UTC',
      dateStyle: 'medium',
      timeStyle: 'short',
    }) + ' UTC';
  const instructions =
    'Abre el portal del expediente para consultar su avance y los requisitos asignados a tu participación. Desde ahí podrás realizar las entregas que te correspondan.';
  const codeInstructions =
    'Escríbelo en el portal del expediente junto con el correo al que recibiste la invitación. El enlace de acceso se envió por separado. Después, el portal te guiará para verificar tu identidad y continuar con tu participación. No compartas este código.';
  const note = codeMail
    ? codeInstructions
    : 'Este enlace es personal. El portal te indicará cómo comprobar tu acceso. No lo compartas. Abrirlo no firma documentos ni autoriza el cierre.';
  const heading = codeMail
    ? 'Tu código de acceso al expediente'
    : 'Te han invitado a un expediente';
  const details = [
    ['Expediente', title],
    ['Folio', invitation.folio],
    ['Invitado por', sender],
    ['Tu rol', role],
    ['Vigencia de la invitación', expires],
  ]
    .map(
      ([label, value]) =>
        `<tr><td style="padding:14px 0;border-bottom:1px solid #f3f4f6;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:13px;color:#6b7280;width:40%;vertical-align:top;">${escape(label)}</td><td style="font-size:13px;font-weight:500;color:#111827;vertical-align:top;">${escape(value)}</td></tr></table></td></tr>`
    )
    .join('');
  const content = `
    <p style="font-size:12px;font-weight:700;color:#1E6BFF;text-transform:uppercase;letter-spacing:.6px;margin:0 0 10px;">${codeMail ? 'Código de acceso · Expediente' : 'Invitación a expediente'}</p>
    <h1 style="color:#18181B;font-size:24px;margin:0 0 12px;font-weight:700;line-height:1.3;">${heading}</h1>
    <p style="color:#52525B;font-size:15px;line-height:1.7;margin:0 0 8px;">Hola <strong>${escape(invitation.recipient_name)}</strong>,</p>
    <p style="color:#52525B;font-size:15px;line-height:1.7;margin:0 0 20px;">${
      codeMail
        ? `Este es el código de acceso al expediente <strong>${escape(title)}</strong>. Lo enviamos separado de la invitación por seguridad.`
        : `<strong>${escape(sender)}</strong> te invita a participar en el expediente. ${instructions}`
    }</p>
    ${codeMail ? `<p style="font-family:monospace;font-size:20px;font-weight:700;letter-spacing:2px;color:#1E6BFF;background:#EFF6FF;padding:16px;border-radius:8px;text-align:center;margin:0 0 20px;">${escape(token)}</p>` : ''}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border-top:1px solid #f3f4f6;">${details}</table>
    ${
      codeMail
        ? ''
        : `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 0;"><tr><td style="border-radius:8px;background-color:#1E6BFF;"><a href="${escape(url)}" target="_blank" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Abrir expediente</a></td></tr></table>
    <p style="font-size:12px;color:#64748B;margin:14px 0 0;line-height:1.6;word-break:break-all;">Si el botón no funciona, abre este enlace:<br><a href="${escape(url)}" style="color:#1E6BFF;">${escape(url)}</a></p>`
    }
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;"><tr><td style="background-color:#EFF6FF;border-radius:8px;padding:14px 16px;"><p style="font-size:13px;color:#1E40AF;margin:0;line-height:1.6;">${note}</p></td></tr></table>`;
  return {
    from,
    to: [invitation.recipient],
    subject: codeMail
      ? `Código de acceso al expediente: ${title}`
      : `${sender} te ha invitado a un expediente: ${title}`,
    html: wrapDocuboxEmail(
      content,
      `Recibiste este correo porque ${sender} te invitó a participar en un expediente mediante Docubox.`
    ),
    text: codeMail
      ? `Tu código de acceso al expediente «${title}» es ${token}.\nFolio: ${invitation.folio}\nVigencia de la invitación: ${expires}\n${codeInstructions}`
      : `${invitation.recipient_name}, ${sender} te ha invitado al expediente «${title}».\nFolio: ${invitation.folio}\nTu rol en el expediente: ${role}\n${instructions}\nAbrir expediente:\n${url}\nVigencia de la invitación: ${expires}\n${note}`,
  };
}

export interface InvitationTransportStore {
  claim(): Promise<InvitationClaim[]>;
  savePayload(id: string, claim: string, encrypted: string): Promise<string>;
  finish(
    id: string,
    claim: string,
    status: 'sent' | 'failed' | 'retrying' | 'pending',
    provider: string | null,
    code: string
  ): Promise<boolean>;
}
/** Frozen payload and provider key survive crashes between acceptance and DB acknowledgement. */
export async function deliverCaseInvitations(
  store: InvitationTransportStore,
  config: {
    secret: string;
    apiKey: string;
    from: string;
    fetch?: typeof fetch;
    wait?: (ms: number) => Promise<void>;
    now?: () => number;
    budgetMs?: number;
  }
) {
  const request = config.fetch || fetch;
  const wait =
    config.wait || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = config.now || Date.now,
    started = now();
  const claims = await store.claim();
  let accepted = 0;
  for (const [index, invitation] of claims.entries()) {
    let status: 'sent' | 'failed' | 'retrying' | 'pending' = 'retrying',
      provider: string | null = null,
      code = 'TRANSPORT_UNCERTAIN';
    try {
      if (now() - started > (config.budgetMs ?? 70_000)) {
        status = 'pending';
        code = 'DEFERRED';
      } else {
        let encrypted = invitation.payload_ciphertext;
        if (!encrypted)
          encrypted = await store.savePayload(
            invitation.id,
            invitation.claim_id,
            encryptInvitationSecret(
              JSON.stringify(
                buildCaseInvitationEmail(
                  invitation,
                  decryptInvitationSecret(invitation.token_ciphertext, config.secret),
                  config.from
                )
              ),
              config.secret
            )
          );
        const email = JSON.parse(
          decryptInvitationSecret(encrypted, config.secret)
        ) as InvitationEmail;
        if (index) await wait(600);
        const response = await request('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `${invitation.kind === 'code' ? 'case-invitation-code' : 'case-invitation'}/${invitation.id}`,
          },
          body: JSON.stringify(email),
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) {
          const body = await response.json();
          if (typeof body.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(body.id)) {
            status = 'sent';
            provider = body.id;
            code = 'PROVIDER_ACCEPTED';
          } else code = 'PROVIDER_ACK_INVALID';
        } else {
          status =
            response.status >= 500 || response.status === 429 || response.status === 409
              ? 'retrying'
              : 'failed';
          code = `HTTP_${response.status}`;
        }
      }
    } catch {
      /* Never log payloads, recipient addresses, capability URLs or provider error bodies. */
    }
    try {
      if (
        (await store.finish(invitation.id, invitation.claim_id, status, provider, code)) &&
        status === 'sent'
      )
        accepted++;
    } catch {
      /* Lease recovery repeats the exact provider key and frozen payload. */
    }
  }
  return { accepted };
}
