declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FROM_EMAIL = "Docubox <noreply@docubox.com.mx>";
const APP_URL = "https://firmamax4272.builtwithrocket.new";

// Logo URLs — served from the public assets of the deployed app
const LOGO_LIGHT = "https://docubox-myi2411.public.builtwithrocket.new/assets/images/Docubox-tipo1-1778728543285.png";
// LOGO_LIGHT → Logo oscuro sobre fondo BLANCO (para encabezado blanco de correos y fondos claros)
// LOGO_WHITE → Logo blanco sobre fondo OSCURO (para el footer oscuro #111827)
const LOGO_WHITE = "https://docubox-myi2411.public.builtwithrocket.new/assets/images/ChatGPT_Image_13_may_2026_20_28_22-1778729319274.png";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

type EmailType =
  | "signature_request" |"document_completed" |"certificate_expiry" |"document_expired" |"action_required" |"participant_invitation" |"participation_completed" |"owner_participant_signed" |"owner_participant_approved" |"owner_participant_cancelled" |"owner_participant_rejected" |"new_device_login" |"login_otp";

interface EmailPayload {
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
  participantRole?: string;
  signatureMethod?: string;
  personalMessage?: string;
  documentDescription?: string;
  participationStatus?: "firmado" | "rechazado" | "cancelado" | "vencido";
  participationMotivo?: string;
  // owner notification extras
  participantName?: string;
  participantEmail?: string;
  // new device login extras
  deviceName?: string;
  ipAddress?: string;
  city?: string;
  country?: string;
  loginTime?: string;
  // login OTP extras
  otpCode?: string;
  // document_completed extras — references to generated evidence files
  documentId?: string;
  xmlEvidenciaPath?: string;
  nom151ConstanciaPath?: string;
  padesPath?: string;
}

// ─── Shared layout helpers ────────────────────────────────────────────────────

function buildHeader(): string {
  return `
    <!-- HEADER -->
    <tr>
      <td style="background-color:#ffffff;padding:24px 40px;border-bottom:1px solid #e5e7eb;">
        <img src="${LOGO_LIGHT}" alt="Docubox" width="130" height="auto" style="display:block;border:0;max-width:130px;" />
      </td>
    </tr>`;
}

function buildCTA(label: string, url: string, bgColor: string): string {
  return `
    <table cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
      <tr>
        <td style="border-radius:8px;background-color:${bgColor};">
          <a href="${url}" target="_blank"
             style="display:inline-block;padding:14px 36px;font-family:'Inter',Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.1px;border-radius:8px;">
            ${label}
          </a>
        </td>
      </tr>
    </table>`;
}

function buildInfoRow(label: string, value: string, isLast: boolean = false): string {
  return `
    <tr>
      <td style="padding:14px 0;${isLast ? "" : "border-bottom:1px solid #f3f4f6;"}">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#6b7280;width:40%;vertical-align:top;">${label}</td>
            <td style="font-family:'Inter',Arial,sans-serif;font-size:13px;font-weight:500;color:#111827;vertical-align:top;">${value}</td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function buildInfoTable(rows: string): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border-top:1px solid #f3f4f6;">
      ${rows}
    </table>`;
}

function buildNoteBanner(text: string, bgColor: string, textColor: string): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;">
      <tr>
        <td style="background-color:${bgColor};border-radius:8px;padding:14px 16px;">
          <p style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:${textColor};margin:0;line-height:1.6;">${text}</p>
        </td>
      </tr>
    </table>`;
}

function buildFooter(year: number): string {
  return `
    <!-- FOOTER -->
    <tr>
      <td style="background-color:#111827;padding:32px 40px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align:middle;">
              <img src="${LOGO_WHITE}" alt="Docubox" width="110" height="auto" style="display:block;border:0;max-width:110px;" />
            </td>
            <td style="vertical-align:middle;text-align:right;">
              <a href="${APP_URL}/sign-up-login-screen" style="font-family:'Inter',Arial,sans-serif;font-size:12px;color:#9ca3af;text-decoration:none;display:inline-block;margin-left:20px;">Mi cuenta</a>
              <a href="${APP_URL}/politica-privacidad" style="font-family:'Inter',Arial,sans-serif;font-size:12px;color:#9ca3af;text-decoration:none;display:inline-block;margin-left:20px;">Política de privacidad</a>
              <a href="${APP_URL}/terminos-condiciones" style="font-family:'Inter',Arial,sans-serif;font-size:12px;color:#9ca3af;text-decoration:none;display:inline-block;margin-left:20px;">Términos y condiciones</a>
            </td>
          </tr>
          <tr>
            <td colspan="2" style="border-top:1px solid #1f2937;padding-top:20px;margin-top:20px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="padding-top:16px;">
                  <p style="font-family:'Inter',Arial,sans-serif;font-size:11px;color:#6b7280;margin:0 0 4px;">
                    © ${year} Docubox. Todos los derechos reservados.
                  </p>
                  <p style="font-family:'Inter',Arial,sans-serif;font-size:11px;color:#4b5563;margin:0;line-height:1.6;">
                    Recibiste este correo porque tienes una cuenta activa en Docubox.
                    Si no reconoces esta actividad, <a href="${APP_URL}/sign-up-login-screen" style="color:#6b7280;text-decoration:underline;">gestiona tu cuenta aquí</a>.
                  </p>
                </td></tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function wrapEmail(title: string, bodyRows: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>${title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    * { box-sizing: border-box; }
    body { margin:0;padding:0;background-color:#f3f4f6;font-family:'Inter',Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%; }
    @media only screen and (max-width:600px){
      .email-container{width:100%!important;border-radius:0!important;}
      .email-body{padding:24px 20px!important;}
      .email-header{padding:20px 20px!important;}
      .email-footer{padding:28px 20px!important;}
      h2.email-title{font-size:20px!important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:'Inter',Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${title} — Docubox Firma Electrónica</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;padding:40px 16px;">
    <tr>
      <td align="center">
        <table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0"
               style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08),0 0 1px rgba(0,0,0,0.06);max-width:600px;width:100%;">
          ${bodyRows}
        </table>
        <p style="font-family:'Inter',Arial,sans-serif;font-size:11px;color:#9ca3af;margin:16px 0 0;text-align:center;">
          Este correo fue enviado de forma segura por Docubox.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Template builders ────────────────────────────────────────────────────────

function buildSignatureRequestHtml(payload: EmailPayload): string {
  const { recipientName, documentName, senderName, documentUrl } = payload;
  const ctaUrl = documentUrl || `${APP_URL}/portal-participante`;
  const year = new Date().getFullYear();

  const infoRows =
    buildInfoRow("Documento", documentName || "Sin nombre") +
    buildInfoRow("Enviado por", senderName || "Un usuario", true);

  const bodyRows = `
    ${buildHeader()}
    <tr>
      <td class="email-body" style="padding:32px 40px 36px;background-color:#ffffff;">
        <h2 class="email-title" style="font-family:'Inter',Arial,sans-serif;color:#111827;font-size:24px;margin:0 0 12px;font-weight:700;line-height:1.3;">
          Tienes un documento pendiente de firma
        </h2>
        <p style="font-family:'Inter',Arial,sans-serif;color:#374151;font-size:15px;line-height:1.7;margin:0 0 4px;">
          Hola <strong>${recipientName || "Usuario"}</strong>,
        </p>
        <p style="font-family:'Inter',Arial,sans-serif;color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 8px;">
          <strong>${senderName || "Un usuario"}</strong> te ha enviado el documento
          <a href="${ctaUrl}" style="color:#1a56db;text-decoration:none;font-weight:500;">"${documentName || "Sin nombre"}"</a>
          para que lo revises y firmes electrónicamente.
        </p>
        ${buildInfoTable(infoRows)}
        ${buildCTA("Revisar y Firmar Documento", ctaUrl, "#1a56db")}
        <!-- Enlace de respaldo visible -->
        <p style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#6b7280;margin:12px 0 0;line-height:1.6;">
          O copia y pega este enlace en tu navegador:<br/>
          <a href="${ctaUrl}" style="color:#1a56db;word-break:break-all;">${ctaUrl}</a>
        </p>
        ${buildNoteBanner("Tu firma es legalmente válida y segura. Si no esperabas esta solicitud, puedes ignorar este correo.", "#eff6ff", "#1e40af")}
      </td>
    </tr>
    ${buildFooter(year)}`;

  return wrapEmail("Solicitud de Firma — Docubox", bodyRows);
}

function buildDocumentCompletedHtml(payload: EmailPayload): string {
  const { recipientName, documentName, completedAt, documentUrl, documentId, xmlEvidenciaPath, nom151ConstanciaPath, padesPath } = payload;
  const dateLabel = completedAt
    ? new Date(completedAt).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });
  const year = new Date().getFullYear();

  const visorUrl = documentUrl || (documentId ? `${APP_URL}/visor-documento/${documentId}` : `${APP_URL}/mis-documentos`);

  const infoRows =
    buildInfoRow("Documento", documentName || "Sin nombre") +
    buildInfoRow("Completado el", dateLabel, true);

  // Build evidence section only when at least one artifact is available
  const hasEvidence = xmlEvidenciaPath || nom151ConstanciaPath || padesPath;

  const evidenceSection = hasEvidence ? `
    <!-- Evidence files section -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;border-top:1px solid #f3f4f6;">
      <tr>
        <td style="padding:16px 0 8px;">
          <p style="font-family:'Inter',Arial,sans-serif;font-size:13px;font-weight:600;color:#374151;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.5px;">Documentos de Evidencia Generados</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
            <tr>
              <td style="padding:14px 16px;">
                <p style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#6b7280;margin:0 0 10px;line-height:1.6;">
                  Los siguientes documentos de evidencia han sido generados automáticamente y están disponibles en tu cuenta de Docubox:
                </p>
                <table width="100%" cellpadding="0" cellspacing="0">
                  ${xmlEvidenciaPath ? `
                  <tr>
                    <td style="padding:6px 0;border-bottom:1px solid #f3f4f6;">
                      <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="width:28px;vertical-align:middle;">
                            <span style="font-size:16px;">📄</span>
                          </td>
                          <td style="vertical-align:middle;">
                            <p style="font-family:'Inter',Arial,sans-serif;font-size:13px;font-weight:600;color:#111827;margin:0 0 2px;">XML de Evidencia</p>
                            <p style="font-family:'Inter',Arial,sans-serif;font-size:12px;color:#6b7280;margin:0;">Registro de evidencia criptográfica del proceso de firma</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>` : ""}
                  ${nom151ConstanciaPath ? `
                  <tr>
                    <td style="padding:6px 0;border-bottom:1px solid #f3f4f6;">
                      <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="width:28px;vertical-align:middle;">
                            <span style="font-size:16px;">🏛️</span>
                          </td>
                          <td style="vertical-align:middle;">
                            <p style="font-family:'Inter',Arial,sans-serif;font-size:13px;font-weight:600;color:#111827;margin:0 0 2px;">Constancia NOM-151</p>
                            <p style="font-family:'Inter',Arial,sans-serif;font-size:12px;color:#6b7280;margin:0;">Constancia de conservación de mensajes de datos (NOM-151-SCFI-2016)</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>` : ""}
                  ${padesPath ? `
                  <tr>
                    <td style="padding:6px 0;">
                      <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="width:28px;vertical-align:middle;">
                            <span style="font-size:16px;">🔏</span>
                          </td>
                          <td style="vertical-align:middle;">
                            <p style="font-family:'Inter',Arial,sans-serif;font-size:13px;font-weight:600;color:#111827;margin:0 0 2px;">Documento PAdES Firmado</p>
                            <p style="font-family:'Inter',Arial,sans-serif;font-size:12px;color:#6b7280;margin:0;">PDF con firmas electrónicas incrustadas en formato PAdES</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>` : ""}
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>` : "";

  const bodyRows = `
    ${buildHeader()}
    <tr>
      <td class="email-body" style="padding:32px 40px 36px;background-color:#ffffff;">
        <!-- Status badge -->
        <div style="display:inline-block;background-color:#d1fae5;border:1px solid #6ee7b7;border-radius:20px;padding:4px 14px;margin-bottom:16px;">
          <span style="font-family:'Inter',Arial,sans-serif;font-size:12px;font-weight:600;color:#065f46;letter-spacing:0.5px;text-transform:uppercase;">✓ Documento Completado</span>
        </div>
        <h2 class="email-title" style="font-family:'Inter',Arial,sans-serif;color:#111827;font-size:24px;margin:0 0 12px;font-weight:700;line-height:1.3;">
          ¡Tu documento ha sido firmado por todos!
        </h2>
        <p style="font-family:'Inter',Arial,sans-serif;color:#374151;font-size:15px;line-height:1.7;margin:0 0 4px;">
          Hola <strong>${recipientName || "Usuario"}</strong>,
        </p>
        <p style="font-family:'Inter',Arial,sans-serif;color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 8px;">
          El documento <strong style="color:#111827;">"${documentName || "Sin nombre"}"</strong>
          ha sido firmado por todos los participantes y está ahora <strong>completado y válido legalmente</strong>.
        </p>
        ${buildInfoTable(infoRows)}
        ${evidenceSection}
        ${buildCTA("Ver y Descargar Documentos", visorUrl, "#059669")}
        <p style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#6b7280;margin:12px 0 0;line-height:1.6;">
          O copia y pega este enlace en tu navegador:<br/>
          <a href="${visorUrl}" style="color:#059669;word-break:break-all;">${visorUrl}</a>
        </p>
        ${buildNoteBanner(
          hasEvidence
            ? "Accede a la pestaña <strong>Descargas</strong> en el visor del documento para obtener el XML de evidencia, la constancia NOM-151 y el documento PAdES firmado."
            : "Descarga el documento firmado desde tu cuenta o comparte el enlace de verificación con terceros.",
          "#f0fdf4",
          "#065f46"
        )}
      </td>
    </tr>
    ${buildFooter(year)}`;

  return wrapEmail("Documento Completado — Docubox", bodyRows);
}

function buildCertificateExpiryHtml(payload: EmailPayload): string {
  const { recipientName, documentName, expiryDate } = payload;
  const dateLabel = expiryDate
    ? new Date(expiryDate).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" })
    : "próximamente";
  const year = new Date().getFullYear();

  const infoRows =
    buildInfoRow("Documento", documentName || "Sin nombre") +
    buildInfoRow("Vence el", dateLabel, true);

  const bodyRows = `
    ${buildHeader()}
    <tr>
      <td class="email-body" style="padding:32px 40px 36px;background-color:#ffffff;">
        <h2 class="email-title" style="font-family:'Inter',Arial,sans-serif;color:#111827;font-size:24px;margin:0 0 12px;font-weight:700;line-height:1.3;">
          Documento próximo a vencer
        </h2>
        <p style="font-family:'Inter',Arial,sans-serif;color:#374151;font-size:15px;line-height:1.7;margin:0 0 4px;">
          Hola <strong>${recipientName || "Usuario"}</strong>,
        </p>
        <p style="font-family:'Inter',Arial,sans-serif;color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 8px;">
          Te informamos que el documento <strong style="color:#111827;">"${documentName || "Sin nombre"}"</strong>
          está próximo a vencer. <strong>Completa el proceso de firma antes de la fecha límite</strong>.
        </p>
        ${buildInfoTable(infoRows)}
        ${buildCTA("Firmar Antes del Vencimiento", APP_URL + "/mis-documentos", "#d97706")}
        ${buildNoteBanner("<strong>Importante:</strong> Una vez vencido el certificado, el documento no podrá ser firmado. Actúa antes de la fecha límite.", "#fffbeb", "#92400e")}
      </td>
    </tr>
    ${buildFooter(year)}`;

  return wrapEmail("Aviso de Vencimiento — Docubox", bodyRows);
}

function buildDocumentExpiredHtml(payload: EmailPayload): string {
  const { recipientName, documentName, expiredAt } = payload;
  const dateLabel = expiredAt
    ? new Date(expiredAt).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" })
    : new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });
  const year = new Date().getFullYear();

  const infoRows =
    buildInfoRow("Documento", documentName || "Sin nombre") +
    buildInfoRow("Venció el", dateLabel, true);

  const bodyRows = `
    ${buildHeader()}
    <tr>
      <td class="email-body" style="padding:32px 40px 36px;background-color:#ffffff;">
        <h2 class="email-title" style="font-family:'Inter',Arial,sans-serif;color:#111827;font-size:24px;margin:0 0 12px;font-weight:700;line-height:1.3;">
          El plazo de firma ha vencido
        </h2>
        <p style="font-family:'Inter',Arial,sans-serif;color:#374151;font-size:15px;line-height:1.7;margin:0 0 4px;">
          Hola <strong>${recipientName || "Usuario"}</strong>,
        </p>
        <p style="font-family:'Inter',Arial,sans-serif;color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 8px;">
          El documento <strong style="color:#111827;">"${documentName || "Sin nombre"}"</strong>
          ha <strong>vencido</strong> sin que se completara el proceso de firma.
        </p>
        ${buildInfoTable(infoRows)}
        ${buildCTA("Ver Mis Documentos", APP_URL + "/mis-documentos", "#dc2626")}
        ${buildNoteBanner("<strong>¿Qué puedes hacer?</strong> Si necesitas continuar, deberás crear un nuevo documento y enviarlo nuevamente a los participantes.", "#fef2f2", "#7f1d1d")}
      </td>
    </tr>
    ${buildFooter(year)}`;

  return wrapEmail("Documento Vencido — Docubox", bodyRows);
}

function buildActionRequiredHtml(payload: EmailPayload): string {
  const { recipientName, documentName, senderName, documentUrl, actionDescription } = payload;
  const ctaUrl = documentUrl || APP_URL + "/participation-requests";
  const year = new Date().getFullYear();
  const action = actionDescription || "Revisar y firmar el documento";

  const infoRows =
    buildInfoRow("Documento", documentName || "Sin nombre") +
    buildInfoRow("Acción requerida", action, true);

  const bodyRows = `
    ${buildHeader()}
    <tr>
      <td class="email-body" style="padding:32px 40px 36px;background-color:#ffffff;">
        <h2 class="email-title" style="font-family:'Inter',Arial,sans-serif;color:#111827;font-size:24px;margin:0 0 12px;font-weight:700;line-height:1.3;">
          Se requiere tu participación en un documento
        </h2>
        <p style="font-family:'Inter',Arial,sans-serif;color:#374151;font-size:15px;line-height:1.7;margin:0 0 4px;">
          Hola <strong>${recipientName || "Usuario"}</strong>,
        </p>
        <p style="font-family:'Inter',Arial,sans-serif;color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 8px;">
          ${senderName ? `<strong>${senderName}</strong> requiere tu acción en el documento` : "Se requiere tu acción en el documento"}
          <strong style="color:#111827;">"${documentName || "Sin nombre"}"</strong>.
        </p>
        ${buildInfoTable(infoRows)}
        ${buildCTA("Ir al Documento", ctaUrl, "#7c3aed")}
        ${buildNoteBanner("Tu participación es importante para completar este proceso.", "#f5f3ff", "#4c1d95")}
      </td>
    </tr>
    ${buildFooter(year)}`;

  return wrapEmail("Acción Requerida — Docubox", bodyRows);
}

function buildParticipantInvitationHtml(payload: EmailPayload): string {
  const { recipientName, documentName, senderName, documentUrl, participantRole, signatureMethod, personalMessage, documentDescription } = payload;
  // Always use the provided documentUrl (should be /portal-participante/:token)
  // Never fall back to /portal-participante/invite — if no token, show /mis-participaciones
  const ctaUrl = documentUrl || `${APP_URL}/mis-participaciones`;
  const year = new Date().getFullYear();
  const roleLabel = participantRole || "Participante";
  const methodLabel = signatureMethod || "Firma Electrónica";

  const bodyRows = `
    <!-- LOGO HEADER: fondo blanco, logo oscuro (LOGO_LIGHT) -->
    ${buildHeader()}

    <!-- ACCENT HEADER: fondo gris con icono de documento y título -->
    <tr>
      <td style="background-color:#f3f4f6;padding:28px 40px 24px;border-bottom:1px solid #e5e7eb;">
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="vertical-align:middle;padding-right:16px;width:56px;">
              <!-- Icono distintivo de documento pendiente -->
              <div style="width:52px;height:52px;background-color:#1a56db;border-radius:12px;display:inline-block;text-align:center;line-height:52px;">
                <img src="https://img.icons8.com/ios-filled/50/ff/contract.png" alt="Documento" width="28" height="28" style="display:inline-block;vertical-align:middle;margin-top:12px;" />
              </div>
            </td>
            <td style="vertical-align:middle;">
              <h2 style="font-family:'Inter',Arial,sans-serif;color:#111827;font-size:20px;margin:0 0 4px;font-weight:700;line-height:1.3;">
                Tienes un documento pendiente de firma
              </h2>
              <p style="font-family:'Inter',Arial,sans-serif;color:#6b7280;font-size:13px;margin:0;line-height:1.5;">
                Hola <strong>${recipientName || "Usuario"}</strong>, se requiere tu participación
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- BODY CONTENT -->
    <tr>
      <td class="email-body" style="padding:32px 40px 36px;background-color:#ffffff;">

        <!-- Quién envía -->
        <p style="font-family:'Inter',Arial,sans-serif;color:#374151;font-size:15px;line-height:1.7;margin:0 0 6px;">
          <strong>${senderName || "Un usuario"}</strong> te ha enviado el siguiente documento para que lo revises y firmes electrónicamente a través de <strong>Docubox</strong>.
        </p>

        <!-- Nombre del documento -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;border-radius:8px;margin:16px 0;border-left:4px solid #1a56db;">
          <tr>
            <td style="padding:14px 16px;">
              <p style="font-family:'Inter',Arial,sans-serif;font-size:12px;font-weight:600;color:#6b7280;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.5px;">Documento</p>
              <p style="font-family:'Inter',Arial,sans-serif;font-size:15px;font-weight:600;color:#111827;margin:0;line-height:1.5;">${documentName || "Sin nombre"}</p>
            </td>
          </tr>
        </table>

        ${documentDescription ? `
        <!-- Descripción del documento -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;border-radius:8px;margin:0 0 16px;">
          <tr>
            <td style="padding:14px 16px;">
              <p style="font-family:'Inter',Arial,sans-serif;font-size:12px;font-weight:600;color:#6b7280;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.5px;">Descripción</p>
              <p style="font-family:'Inter',Arial,sans-serif;font-size:14px;color:#374151;margin:0;line-height:1.6;">${documentDescription}</p>
            </td>
          </tr>
        </table>` : ""}

        <!-- Detalles de participación -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-top:1px solid #f3f4f6;">
          <tr>
            <td style="padding:12px 0;border-bottom:1px solid #f3f4f6;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#6b7280;width:45%;vertical-align:top;">Invitado por</td>
                  <td style="font-family:'Inter',Arial,sans-serif;font-size:13px;font-weight:500;color:#111827;vertical-align:top;">${senderName || "Un usuario"}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 0;border-bottom:1px solid #f3f4f6;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#6b7280;width:45%;vertical-align:top;">Tu rol</td>
                  <td style="font-family:'Inter',Arial,sans-serif;font-size:13px;font-weight:500;color:#111827;vertical-align:top;">${roleLabel}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 0;border-bottom:1px solid #f3f4f6;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#6b7280;width:45%;vertical-align:top;">Método de firma</td>
                  <td style="font-family:'Inter',Arial,sans-serif;font-size:13px;font-weight:500;color:#111827;vertical-align:top;">${methodLabel}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 0;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#6b7280;width:45%;vertical-align:top;">Plataforma</td>
                  <td style="font-family:'Inter',Arial,sans-serif;font-size:13px;font-weight:500;color:#111827;vertical-align:top;">Docubox Firma Electrónica</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        ${personalMessage ? `
        <!-- Mensaje personal del remitente -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#fffbeb;border-radius:8px;margin:0 0 20px;">
          <tr>
            <td style="padding:14px 16px;">
              <p style="font-family:'Inter',Arial,sans-serif;font-size:12px;font-weight:600;color:#92400e;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.5px;">Mensaje de ${senderName || "el remitente"}</p>
              <p style="font-family:'Inter',Arial,sans-serif;font-size:14px;color:#374151;margin:0;line-height:1.6;font-style:italic;">"${personalMessage}"</p>
            </td>
          </tr>
        </table>` : ""}

        <!-- CTA Button — redirige a /portal-participante/:token -->
        ${buildCTA("Revisar y Firmar Documento", ctaUrl, "#1a56db")}

        <!-- Enlace de respaldo visible (por si el botón no renderiza) -->
        <p style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#6b7280;margin:12px 0 0;line-height:1.6;">
          O copia y pega este enlace en tu navegador:<br/>
          <a href="${ctaUrl}" style="color:#1a56db;word-break:break-all;">${ctaUrl}</a>
        </p>

        <!-- Nota de seguridad -->
        ${buildNoteBanner("Tu firma es legalmente válida y segura. Si no esperabas esta invitación, puedes ignorar este correo sin ningún problema.", "#eff6ff", "#1e40af")}

      </td>
    </tr>
    ${buildFooter(year)}`;

  return wrapEmail("Tienes un documento pendiente de firma — Docubox", bodyRows);
}

function buildParticipationCompletedHtml(payload: EmailPayload): string {
  const { recipientName, documentName, participationStatus, participationMotivo, completedAt } = payload;
  const year = new Date().getFullYear();

  const dateLabel = completedAt
    ? new Date(completedAt).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });

  type StatusConfig = { accentColor: string; headline: string; bodyText: string; noteBg: string; noteText: string };

  const statusConfig: Record<string, StatusConfig> = {
    firmado: {
      accentColor: "#059669",
      headline: "Has firmado el documento exitosamente",
      bodyText: "Tu participación ha sido registrada y el documento ha sido firmado con éxito. Tu firma electrónica es legalmente válida.",
      noteBg: "#f0fdf4", noteText: "#065f46",
    },
    rechazado: {
      accentColor: "#dc2626",
      headline: "Has rechazado el documento",
      bodyText: "Tu participación ha concluido. Has rechazado el documento y el proceso de firma ha sido detenido.",
      noteBg: "#fef2f2", noteText: "#991b1b",
    },
    cancelado: {
      accentColor: "#6b7280",
      headline: "Tu participación ha sido cancelada",
      bodyText: "El proceso de firma ha sido cancelado. Tu participación en este documento ha concluido.",
      noteBg: "#f9fafb", noteText: "#374151",
    },
    vencido: {
      accentColor: "#d97706",
      headline: "Tu participación ha vencido",
      bodyText: "El plazo para completar tu participación en este documento ha expirado.",
      noteBg: "#fffbeb", noteText: "#92400e",
    },
  };

  const cfg = statusConfig[participationStatus ?? "firmado"] ?? statusConfig["firmado"];

  const infoRows =
    buildInfoRow("Documento", documentName || "Sin nombre") +
    buildInfoRow("Fecha y hora", dateLabel) +
    (participationMotivo ? buildInfoRow("Motivo", participationMotivo, true) : buildInfoRow("Estado", participationStatus || "firmado", true));

  const bodyRows = `
    ${buildHeader()}
    <tr>
      <td class="email-body" style="padding:32px 40px 36px;background-color:#ffffff;">
        <h2 class="email-title" style="font-family:'Inter',Arial,sans-serif;color:#111827;font-size:24px;margin:0 0 12px;font-weight:700;line-height:1.3;">
          ${cfg.headline}
        </h2>
        <p style="font-family:'Inter',Arial,sans-serif;color:#374151;font-size:15px;line-height:1.7;margin:0 0 4px;">
          Hola <strong>${recipientName || "Usuario"}</strong>,
        </p>
        <p style="font-family:'Inter',Arial,sans-serif;color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 8px;">
          ${cfg.bodyText}
        </p>
        ${buildInfoTable(infoRows)}
        ${buildCTA("Ver Mis Participaciones", APP_URL + "/mis-participaciones", cfg.accentColor)}
        ${buildNoteBanner("Este correo es un comprobante de tu participación en Docubox.", cfg.noteBg, cfg.noteText)}
      </td>
    </tr>
    ${buildFooter(year)}`;

  const titles: Record<string, string> = {
    firmado: "Participación Completada",
    rechazado: "Participación Rechazada",
    cancelado: "Participación Cancelada",
    vencido: "Participación Vencida",
  };
  return wrapEmail(`${titles[participationStatus ?? "firmado"] ?? "Participación"} — Docubox`, bodyRows);
}

// ─── Owner notification templates ────────────────────────────────────────────

function buildOwnerParticipantActionHtml(payload: EmailPayload, action: "firmado" | "aprobado" | "cancelado" | "rechazado"): string {
  const { recipientName, documentName, participantName, participantEmail, participationMotivo, completedAt } = payload;
  const year = new Date().getFullYear();

  const dateLabel = completedAt
    ? new Date(completedAt).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });

  type ActionCfg = { accentColor: string; headline: string; bodyText: string; noteBg: string; noteText: string };

  const actionConfig: Record<string, ActionCfg> = {
    firmado: {
      accentColor: "#059669",
      headline: "Un participante ha firmado tu documento",
      bodyText: `<strong>${participantName || participantEmail || "Un participante"}</strong> ha firmado el documento <strong>"${documentName || "Sin nombre"}"</strong>.`,
      noteBg: "#f0fdf4", noteText: "#065f46",
    },
    aprobado: {
      accentColor: "#0f766e",
      headline: "Un participante ha aprobado tu documento",
      bodyText: `<strong>${participantName || participantEmail || "Un participante"}</strong> ha aprobado el documento <strong>"${documentName || "Sin nombre"}"</strong>.`,
      noteBg: "#f0fdfa", noteText: "#134e4a",
    },
    cancelado: {
      accentColor: "#6b7280",
      headline: "Un participante ha cancelado el documento",
      bodyText: `<strong>${participantName || participantEmail || "Un participante"}</strong> ha cancelado el documento <strong>"${documentName || "Sin nombre"}"</strong>. El proceso de firma ha sido detenido.`,
      noteBg: "#f9fafb", noteText: "#374151",
    },
    rechazado: {
      accentColor: "#dc2626",
      headline: "Un participante ha rechazado el documento",
      bodyText: `<strong>${participantName || participantEmail || "Un participante"}</strong> ha rechazado el documento <strong>"${documentName || "Sin nombre"}"</strong>. El proceso de firma ha sido detenido.`,
      noteBg: "#fef2f2", noteText: "#991b1b",
    },
  };

  const cfg = actionConfig[action];

  const infoRows =
    buildInfoRow("Documento", documentName || "Sin nombre") +
    buildInfoRow("Participante", participantName || participantEmail || "Desconocido") +
    buildInfoRow("Fecha y hora", dateLabel) +
    (participationMotivo ? buildInfoRow("Motivo", participationMotivo, true) : buildInfoRow("Acción", action, true));

  const bodyRows = `
    ${buildHeader()}
    <tr>
      <td class="email-body" style="padding:32px 40px 36px;background-color:#ffffff;">
        <h2 class="email-title" style="font-family:'Inter',Arial,sans-serif;color:#111827;font-size:24px;margin:0 0 12px;font-weight:700;line-height:1.3;">
          ${cfg.headline}
        </h2>
        <p style="font-family:'Inter',Arial,sans-serif;color:#374151;font-size:15px;line-height:1.7;margin:0 0 4px;">
          Hola <strong>${recipientName || "Usuario"}</strong>,
        </p>
        <p style="font-family:'Inter',Arial,sans-serif;color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 8px;">
          ${cfg.bodyText}
        </p>
        ${buildInfoTable(infoRows)}
        ${buildCTA("Ver Mis Documentos", APP_URL + "/mis-documentos", cfg.accentColor)}
        ${buildNoteBanner("Este es un aviso automático de actividad en tu documento en Docubox.", cfg.noteBg, cfg.noteText)}
      </td>
    </tr>
    ${buildFooter(year)}`;

  const titles: Record<string, string> = {
    firmado: "Participante Firmó",
    aprobado: "Participante Aprobó",
    cancelado: "Participante Canceló",
    rechazado: "Participante Rechazó",
  };
  return wrapEmail(`${titles[action]} — Docubox`, bodyRows);
}

// ─── New Device Login Template ───────────────────────────────────────────────

function buildNewDeviceLoginHtml(payload: EmailPayload): string {
  const { recipientName, deviceName, ipAddress, city, country, loginTime } = payload;
  const year = new Date().getFullYear();

  let formattedTime = "Ahora";
  if (loginTime) {
    try {
      const d = new Date(loginTime);
      formattedTime = d.toLocaleString("es-MX", {
        day: "2-digit", month: "long", year: "numeric",
        hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City"
      });
    } catch { /* keep default */ }
  }

  const location = [city, country].filter(Boolean).join(", ") || "Desconocida";

  const infoRows =
    buildInfoRow("Dispositivo", deviceName || "Desconocido") +
    buildInfoRow("Ubicación", location) +
    buildInfoRow("Dirección IP", ipAddress || "Desconocida") +
    buildInfoRow("Fecha y hora", formattedTime, true);

  const bodyRows = `
    ${buildHeader()}
    <tr>
      <td class="email-body" style="padding:32px 40px 36px;background-color:#ffffff;">
        <div style="display:inline-block;background-color:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:8px 14px;margin-bottom:20px;">
          <span style="font-family:'Inter',Arial,sans-serif;font-size:12px;font-weight:600;color:#92400e;letter-spacing:0.5px;text-transform:uppercase;">⚠️ Alerta de Seguridad</span>
        </div>
        <h2 class="email-title" style="font-family:'Inter',Arial,sans-serif;color:#111827;font-size:24px;margin:0 0 12px;font-weight:700;line-height:1.3;">
          Nuevo dispositivo detectado
        </h2>
        <p style="font-family:'Inter',Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 8px;line-height:1.6;">
          Hola${recipientName ? `, <strong>${recipientName}</strong>` : ""},
        </p>
        <p style="font-family:'Inter',Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 24px;line-height:1.6;">
          Detectamos un inicio de sesión en tu cuenta de Docubox desde un <strong>dispositivo que no habíamos visto antes</strong>. Si fuiste tú, no necesitas hacer nada.
        </p>
        ${buildInfoTable(infoRows)}
        ${buildNoteBanner(
          "Si <strong>no reconoces este acceso</strong>, te recomendamos cambiar tu contraseña de inmediato y revisar los dispositivos activos en tu cuenta.",
          "#fef3c7",
          "#92400e"
        )}
        ${buildCTA("Revisar mi cuenta", `${APP_URL}/configuracion`, "#dc2626")}
        <p style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#6b7280;margin:24px 0 0;line-height:1.6;">
          Si reconoces este acceso, puedes ignorar este mensaje con seguridad.
        </p>
      </td>
    </tr>
    ${buildFooter(year)}`;

  return wrapEmail("Alerta de seguridad — Nuevo dispositivo detectado", bodyRows);
}

// ─── Login OTP Template ───────────────────────────────────────────────────────

function buildLoginOtpHtml(payload: EmailPayload): string {
  const { recipientName, to, otpCode } = payload;
  const year = new Date().getFullYear();
  const code = otpCode || "------";
  // Split code into individual digits for visual display
  const digits = code.split("");

  const bodyRows = `
    ${buildHeader()}
    <!-- ACCENT HEADER: fondo azul con icono de seguridad -->
    <tr>
      <td style="background-color:#eff6ff;padding:24px 40px 20px;border-bottom:1px solid #dbeafe;">
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="vertical-align:middle;padding-right:16px;width:52px;">
              <div style="width:48px;height:48px;background-color:#1a56db;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;">
                <span style="font-size:22px;line-height:1;">🔐</span>
              </div>
            </td>
            <td style="vertical-align:middle;">
              <h2 style="font-family:'Inter',Arial,sans-serif;color:#1e3a8a;font-size:20px;margin:0 0 2px;font-weight:700;line-height:1.3;">
                Tu código de acceso a Docubox
              </h2>
              <p style="font-family:'Inter',Arial,sans-serif;color:#3b82f6;font-size:13px;margin:0;line-height:1.5;">
                Código de verificación de un solo uso
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- BODY CONTENT -->
    <tr>
      <td class="email-body" style="padding:32px 40px 36px;background-color:#ffffff;">

        <p style="font-family:'Inter',Arial,sans-serif;color:#374151;font-size:15px;line-height:1.7;margin:0 0 6px;">
          Hola <strong>${recipientName || to || "Usuario"}</strong>,
        </p>
        <p style="font-family:'Inter',Arial,sans-serif;color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 24px;">
          Recibiste este correo porque solicitaste iniciar sesión en <strong>Docubox</strong> con un código de verificación. Ingresa el siguiente código en la pantalla de inicio de sesión:
        </p>

        <!-- OTP Code Display -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
          <tr>
            <td align="center">
              <table cellpadding="0" cellspacing="0" style="background-color:#f8faff;border:2px solid #dbeafe;border-radius:12px;padding:20px 32px;display:inline-block;">
                <tr>
                  <td align="center">
                    <p style="font-family:'Courier New',Courier,monospace;font-size:40px;font-weight:700;letter-spacing:12px;color:#1a56db;margin:0;line-height:1.2;">
                      ${code}
                    </p>
                    <p style="font-family:'Inter',Arial,sans-serif;font-size:12px;color:#6b7280;margin:8px 0 0;letter-spacing:0.3px;">
                      Válido por <strong>10 minutos</strong>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- Steps -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;border-radius:8px;margin:0 0 20px;">
          <tr>
            <td style="padding:16px 20px;">
              <p style="font-family:'Inter',Arial,sans-serif;font-size:13px;font-weight:600;color:#374151;margin:0 0 10px;">Cómo usar tu código:</p>
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="padding:4px 0;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:22px;vertical-align:top;padding-top:1px;">
                          <span style="font-family:'Inter',Arial,sans-serif;font-size:12px;font-weight:700;color:#1a56db;">1.</span>
                        </td>
                        <td style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#6b7280;line-height:1.5;">Regresa a la pantalla de inicio de sesión de Docubox</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:4px 0;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:22px;vertical-align:top;padding-top:1px;">
                          <span style="font-family:'Inter',Arial,sans-serif;font-size:12px;font-weight:700;color:#1a56db;">2.</span>
                        </td>
                        <td style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#6b7280;line-height:1.5;">Ingresa el código de 6 dígitos en los campos correspondientes</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:4px 0;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:22px;vertical-align:top;padding-top:1px;">
                          <span style="font-family:'Inter',Arial,sans-serif;font-size:12px;font-weight:700;color:#1a56db;">3.</span>
                        </td>
                        <td style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#6b7280;line-height:1.5;">Haz clic en <strong>"Verificar código"</strong> para acceder a tu cuenta</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        ${buildNoteBanner(
          "<strong>¿No solicitaste este código?</strong> Si no intentaste iniciar sesión, ignora este correo. Tu cuenta permanece segura. El código expirará automáticamente.",
          "#fef3c7",
          "#92400e"
        )}

        <p style="font-family:'Inter',Arial,sans-serif;font-size:12px;color:#9ca3af;margin:20px 0 0;line-height:1.6;">
          Por seguridad, nunca compartas este código con nadie. Docubox jamás te pedirá tu código por teléfono o chat.
        </p>
      </td>
    </tr>
    ${buildFooter(year)}`;

  return wrapEmail("Tu código de acceso — Docubox", bodyRows);
}

// ─── Subject lines ────────────────────────────────────────────────────────────

function getSubject(type: EmailType, documentName?: string, participationStatus?: string, participantName?: string): string {
  const name = documentName || "Sin nombre";
  const actor = participantName || "Un participante";
  switch (type) {
    case "signature_request":
      return `Solicitud de firma: ${name}`;
    case "document_completed":
      return `Documento completado: ${name}`;
    case "certificate_expiry":
      return `Documento próximo a vencer: ${name}`;
    case "document_expired":
      return `Documento vencido: ${name}`;
    case "action_required":
      return `Acción requerida: ${name}`;
    case "participant_invitation":
      return `Invitación a participar: ${name}`;
    case "participation_completed": {
      const labels: Record<string, string> = { firmado: "Participación completada", rechazado: "Participación rechazada", cancelado: "Participación cancelada", vencido: "Participación vencida" };
      return `${labels[participationStatus ?? "firmado"] ?? "Participación"}: ${name}`;
    }
    case "owner_participant_signed":
      return `${actor} firmó tu documento: ${name}`;
    case "owner_participant_approved":
      return `${actor} aprobó tu documento: ${name}`;
    case "owner_participant_cancelled":
      return `${actor} canceló el documento: ${name}`;
    case "owner_participant_rejected":
      return `${actor} rechazó el documento: ${name}`;
    case "new_device_login":
      return `Alerta de seguridad: inicio de sesión desde un nuevo dispositivo`;
    case "login_otp":
      return `Tu código de acceso a Docubox`;
  }
}

function buildHtml(payload: EmailPayload): string {
  switch (payload.type) {
    case "signature_request":
      return buildSignatureRequestHtml(payload);
    case "document_completed":
      return buildDocumentCompletedHtml(payload);
    case "certificate_expiry":
      return buildCertificateExpiryHtml(payload);
    case "document_expired":
      return buildDocumentExpiredHtml(payload);
    case "action_required":
      return buildActionRequiredHtml(payload);
    case "participant_invitation":
      return buildParticipantInvitationHtml(payload);
    case "participation_completed":
      return buildParticipationCompletedHtml(payload);
    case "owner_participant_signed":
      return buildOwnerParticipantActionHtml(payload, "firmado");
    case "owner_participant_approved":
      return buildOwnerParticipantActionHtml(payload, "aprobado");
    case "owner_participant_cancelled":
      return buildOwnerParticipantActionHtml(payload, "cancelado");
    case "owner_participant_rejected":
      return buildOwnerParticipantActionHtml(payload, "rechazado");
    case "new_device_login":
      return buildNewDeviceLoginHtml(payload);
    case "login_otp":
      return buildLoginOtpHtml(payload);
  }
}

// ─── Edge Function handler ────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    if (!SUPABASE_SERVICE_ROLE_KEY || authorization !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const payload: EmailPayload = await req.json();

    if (!payload.to || !payload.type) {
      return new Response(JSON.stringify({ error: "Missing required fields: to, type" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (!RESEND_API_KEY) {
      console.error("[send-email-notifications] RESEND_API_KEY is not set as a Supabase Edge Function secret.");
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured. Set it in Supabase Edge Function secrets." }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const subject = getSubject(payload.type, payload.documentName, payload.participationStatus, payload.participantName);
    const html = buildHtml(payload);

    console.log(`[send-email-notifications] Sending type=${payload.type} to=${payload.to} from=${FROM_EMAIL}`);

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        reply_to: "noreply@docubox.com.mx",
        to: [payload.to],
        subject,
        html,
      }),
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error(`[send-email-notifications] Resend API error (HTTP ${resendResponse.status}):`, JSON.stringify(resendData));
      console.error(`[send-email-notifications] FROM used: ${FROM_EMAIL} | type: ${payload.type} | to: ${payload.to}`);
      return new Response(JSON.stringify({ error: resendData.message || resendData.name || "Error sending email", details: resendData }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    console.log(`[send-email-notifications] Email sent successfully. Resend id=${resendData.id} | type=${payload.type} | to=${payload.to}`);
    return new Response(JSON.stringify({ success: true, id: resendData.id }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    console.error("[send-email-notifications] Unexpected error:", (error as Error).message);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
