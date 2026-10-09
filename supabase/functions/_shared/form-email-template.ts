type FormEmailVariant = 'invitation' | 'reminder';

export interface FormEmailOptions {
  variant: FormEmailVariant;
  recipientName: string;
  formName: string;
  workspaceName: string;
  requesterName: string;
  sentToSelf?: boolean;
  formUrl: string;
  expiresAt: string | null;
  requireLiveness?: boolean;
}

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ||
      character
  );

export function buildFormEmail(options: FormEmailOptions): string {
  const invitation = options.variant === 'invitation';
  const appUrl = new URL(options.formUrl).origin;
  const logoUrl = escapeHtml(`${appUrl}/assets/images/docubox-logo-2026.png`);
  const formUrl = escapeHtml(options.formUrl);
  const recipientName = escapeHtml(options.recipientName || 'Participante');
  const formName = escapeHtml(options.formName);
  const requesterName = escapeHtml(options.requesterName || 'Usuario de Docubox');
  const sentToSelf = options.sentToSelf === true;
  const expiry = options.expiresAt && !Number.isNaN(new Date(options.expiresAt).getTime()) ? escapeHtml(
    `${new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(options.expiresAt))} UTC`
  ) : null;
  const title = invitation
    ? 'Tienes un formulario por completar'
    : 'Tienes un formulario pendiente';
  const preheader = invitation
    ? sentToSelf ? `Enviaste a tu cuenta el formulario ${options.formName}` : `${options.requesterName} te invita a completar ${options.formName}`
    : `Recordatorio para completar ${options.formName}`;
  const message = invitation
    ? sentToSelf
      ? 'Enviaste este formulario a tu propia cuenta para completarlo y firmarlo.'
      : `<strong>${requesterName}</strong> te ha enviado un formulario para que lo completes y firmes.`
    : sentToSelf
      ? 'Este es un recordatorio del formulario que solicitaste para ti. Aún está pendiente de completar y firmar.'
      : `<strong>${requesterName}</strong> te recuerda que tienes un formulario por completar y firmar.`;
  const note = invitation
    ? `Este enlace es personal y solo puede utilizarse una vez. No lo compartas.${options.requireLiveness ? ' Al firmar se solicitará una prueba de vida.' : ''} Si no esperabas esta invitación, puedes ignorar este correo.`
    : 'Este es un recordatorio automático. Si ya completaste el formulario, no necesitas realizar otra acción. No compartas este enlace personal.';
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>${escapeHtml(title)} — Docubox</title>
  <style>
    @media only screen and (max-width:600px) {
      .email-container { width:100%!important;border-radius:0!important; }
      .email-header,.email-body,.email-footer { padding-left:20px!important;padding-right:20px!important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#F6F8FB;font-family:'Google Sans','Google Sans Text',Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F6F8FB;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08),0 0 1px rgba(0,0,0,0.06);">
        <tr><td class="email-header" style="background-color:#ffffff;padding:24px 40px;border-bottom:1px solid #EBEBF0;">
          <img src="${logoUrl}" alt="Docubox" width="142" style="display:block;border:0;max-width:142px;height:auto;">
        </td></tr>
        <tr><td class="email-body" style="padding:32px 40px 36px;background-color:#ffffff;">
          <p style="font-size:12px;font-weight:700;color:#1E6BFF;text-transform:uppercase;letter-spacing:.6px;margin:0 0 10px;">${invitation ? 'Invitación a formulario' : 'Recordatorio de formulario'}</p>
          <h1 style="color:#18181B;font-size:24px;margin:0 0 12px;font-weight:700;line-height:1.3;">${title}</h1>
          <p style="color:#52525B;font-size:15px;line-height:1.7;margin:0 0 8px;">Hola <strong>${recipientName}</strong>,</p>
          <p style="color:#52525B;font-size:15px;line-height:1.7;margin:0 0 20px;">${message}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border-top:1px solid #f3f4f6;">
            <tr><td style="padding:14px 0;border-bottom:1px solid #f3f4f6;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:13px;color:#6b7280;width:40%;vertical-align:top;">Formulario</td><td style="font-size:13px;font-weight:500;color:#111827;vertical-align:top;">${formName}</td></tr></table></td></tr>
            <tr><td style="padding:14px 0;border-bottom:1px solid #f3f4f6;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:13px;color:#6b7280;width:40%;vertical-align:top;">Solicitado por</td><td style="font-size:13px;font-weight:500;color:#111827;vertical-align:top;">${requesterName}${sentToSelf ? ' (tú)' : ''}</td></tr></table></td></tr>
            <tr><td style="padding:14px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:13px;color:#6b7280;width:40%;vertical-align:top;">Fecha límite</td><td style="font-size:13px;font-weight:500;color:#111827;vertical-align:top;">${expiry || 'Sin fecha límite'}</td></tr></table></td></tr>
          </table>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 0;"><tr><td style="border-radius:8px;background-color:#1E6BFF;"><a href="${formUrl}" target="_blank" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${invitation ? 'Completar formulario' : 'Continuar formulario'}</a></td></tr></table>
          <p style="font-size:12px;color:#64748B;margin:14px 0 0;line-height:1.6;word-break:break-all;">Si el botón no funciona, abre este enlace:<br><a href="${formUrl}" style="color:#1E6BFF;">${formUrl}</a></p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;"><tr><td style="background-color:#EFF6FF;border-radius:8px;padding:14px 16px;"><p style="font-size:13px;color:#1E40AF;margin:0;line-height:1.6;">${note}</p></td></tr></table>
        </td></tr>
        <tr><td class="email-footer" style="background-color:#ffffff;padding:26px 40px;border-top:1px solid #EBEBF0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:middle;"><img src="${logoUrl}" alt="Docubox" width="104" style="display:block;border:0;max-width:104px;height:auto;"></td><td style="vertical-align:middle;text-align:right;"><a href="${appUrl}/politica-privacidad" style="font-size:12px;color:#9ca3af;text-decoration:none;">Política de privacidad</a>&nbsp;&nbsp;<a href="${appUrl}/terminos-condiciones" style="font-size:12px;color:#9ca3af;text-decoration:none;">Términos y condiciones</a></td></tr></table>
          <p style="border-top:1px solid #f1f5f9;padding-top:20px;margin:20px 0 4px;font-size:11px;color:#6b7280;">© ${year} Docubox. Todos los derechos reservados.</p>
          <p style="margin:0;font-size:11px;color:#4b5563;line-height:1.6;">${sentToSelf ? 'Recibiste este correo porque te enviaste un formulario a tu propia cuenta mediante Docubox.' : `Recibiste este correo porque ${requesterName} te envió un enlace personal mediante Docubox.`}</p>
        </td></tr>
      </table>
      <p style="font-size:11px;color:#9ca3af;margin:16px 0 0;text-align:center;">Este correo fue enviado de forma segura por Docubox.</p>
    </td></tr>
  </table>
</body>
</html>`;
}
