const APP_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'https://app.docubox.mx'
).replace(/\/$/, '');

const LOGO_URL = `${APP_URL}/assets/images/docubox-logo-2026.png`;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

export function docuboxEmailFooter(context: string): string {
  return `<tr><td style="background:#ffffff;padding:26px 40px;border-top:1px solid #EBEBF0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="vertical-align:middle;"><img src="${LOGO_URL}" alt="Docubox" width="104" style="display:block;border:0;max-width:104px;height:auto;"></td>
        <td style="vertical-align:middle;text-align:right;">
          <a href="${APP_URL}/politica-privacidad" style="font-size:12px;color:#9ca3af;text-decoration:none;display:inline-block;margin-left:12px;">Política de privacidad</a>
          <a href="${APP_URL}/terminos-condiciones" style="font-size:12px;color:#9ca3af;text-decoration:none;display:inline-block;margin-left:12px;">Términos y condiciones</a>
        </td>
      </tr>
    </table>
    <p style="border-top:1px solid #f1f5f9;padding-top:20px;margin:20px 0 4px;font-size:11px;color:#6b7280;">© ${new Date().getFullYear()} Docubox. Todos los derechos reservados.</p>
    <p style="margin:0;font-size:11px;color:#4b5563;line-height:1.6;">${escapeHtml(context)}</p>
  </td></tr>`;
}

export const docuboxEmailSafetyLine =
  '<p style="font-size:11px;color:#9ca3af;margin:16px 0 0;text-align:center;">Este correo fue enviado de forma segura por Docubox.</p>';

export function wrapDocuboxEmail(contentHtml: string, context: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
  <body style="margin:0;padding:0;background:#F6F8FB;font-family:'Google Sans','Google Sans Text','Segoe UI',Arial,sans-serif;color:#18181B;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F8FB;padding:40px 16px;"><tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #EBEBF0;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:24px 40px;border-bottom:1px solid #EBEBF0;"><img src="${LOGO_URL}" alt="Docubox" width="142" style="display:block;border:0;max-width:142px;height:auto;"></td></tr>
        <tr><td style="padding:32px 40px 36px;">${contentHtml}</td></tr>
        ${docuboxEmailFooter(context)}
      </table>
      ${docuboxEmailSafetyLine}
    </td></tr></table>
  </body></html>`;
}
