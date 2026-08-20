import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isInternalAdminRequest } from '@/lib/security/internal-admin';

const TEST_EMAIL = 'luishb.mzt@gmail.com';
const TEST_PHONE = '+526691074369';

const ENVIA_SMS_TOKEN = process.env.ENVIA_SMS_TOKEN || '';
const ENVIA_SMS_PROJECT = process.env.ENVIA_SMS_PROJECT || '822486';
const ENVIA_SMS_TEMPLATE_ID = process.env.ENVIA_SMS_TEMPLATE_ID || '02';
const ENVIA_SMS_BASE_URL = 'https://envia-sms.com/api/sms/send';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const APP_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://firmamax4272.builtwithrocket.new';

// Build edge function payload based on template type
function buildEdgePayload(templateType: string, recipient: string, recipientName: string) {
  const base = {
    to: recipient,
    recipientName: recipientName || 'Usuario de Prueba',
    documentName: 'Contrato de Servicios Profesionales — Prueba DocuBox',
  };

  switch (templateType) {
    case 'participant_invitation':
      return {
        ...base,
        type: 'participant_invitation',
        documentDescription: 'Contrato de prestación de servicios profesionales de consultoría tecnológica para el período enero–diciembre 2026.',
        senderName: 'Carlos Mendoza (DocuBox)',
        documentUrl: `${APP_URL}/portal-participante/test-token-prueba`,
        participantRole: 'Firmante',
        signatureMethod: 'Firma Autógrafa Digital',
        personalMessage: 'Por favor revisa el contrato y fírmalo antes del viernes. Cualquier duda, contáctame.',
      };

    case 'participation_reminder':
      return {
        ...base,
        type: 'participation_reminder',
        senderName: 'Carlos Mendoza (Docubox)',
        documentUrl: `${APP_URL}/portal-participante/test-token-prueba`,
        participantRole: 'Firmante',
        signatureMethod: 'Firma aut\u00f3grafa digital',
        expiryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      };

    case 'signature_request':
      return {
        ...base,
        type: 'signature_request',
        senderName: 'María García (DocuBox)',
        documentUrl: `${APP_URL}/portal-participante/test-token-prueba`,
      };

    case 'document_completed':
      return {
        ...base,
        type: 'document_completed',
        completedAt: new Date().toISOString(),
      };

    case 'certificate_expiry':
      return {
        ...base,
        type: 'certificate_expiry',
        expiryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days from now
      };

    case 'document_expired':
      return {
        ...base,
        type: 'document_expired',
        expiredAt: new Date().toISOString(),
      };

    case 'action_required':
      return {
        ...base,
        type: 'action_required',
        senderName: 'Ana López (DocuBox)',
        documentUrl: `${APP_URL}/portal-participante/test-token-prueba`,
        actionDescription: 'Revisar y aprobar el contrato antes del cierre del mes',
      };

    case 'participation_completed_firmado':
      return {
        ...base,
        type: 'participation_completed',
        participationStatus: 'firmado',
        completedAt: new Date().toISOString(),
      };

    case 'participation_completed_rechazado':
      return {
        ...base,
        type: 'participation_completed',
        participationStatus: 'rechazado',
        completedAt: new Date().toISOString(),
        participationMotivo: 'No estoy de acuerdo con las cláusulas 3 y 5 del contrato.',
      };

    case 'participation_completed_cancelado':
      return {
        ...base,
        type: 'participation_completed',
        participationStatus: 'cancelado',
        completedAt: new Date().toISOString(),
      };

    case 'participation_completed_vencido':
      return {
        ...base,
        type: 'participation_completed',
        participationStatus: 'vencido',
        completedAt: new Date().toISOString(),
      };

    case 'owner_participant_signed':
      return {
        ...base,
        type: 'owner_participant_signed',
        participantName: 'Roberto Sánchez',
        participantEmail: 'roberto.sanchez@empresa.com',
        completedAt: new Date().toISOString(),
      };

    case 'owner_participant_approved':
      return {
        ...base,
        type: 'owner_participant_approved',
        participantName: 'Laura Jiménez',
        participantEmail: 'laura.jimenez@empresa.com',
        completedAt: new Date().toISOString(),
      };

    case 'owner_participant_cancelled':
      return {
        ...base,
        type: 'owner_participant_cancelled',
        participantName: 'Pedro Torres',
        participantEmail: 'pedro.torres@empresa.com',
        completedAt: new Date().toISOString(),
        participationMotivo: 'El participante canceló por cambio de representante legal.',
      };

    case 'owner_participant_rejected':
      return {
        ...base,
        type: 'owner_participant_rejected',
        participantName: 'Sofía Ramírez',
        participantEmail: 'sofia.ramirez@empresa.com',
        completedAt: new Date().toISOString(),
        participationMotivo: 'Requiere revisión legal adicional antes de firmar.',
      };

    case 'new_device_login':
      return {
        ...base,
        type: 'new_device_login',
        deviceName: 'Chrome en Windows',
        ipAddress: '192.0.2.10',
        city: 'Mazatl\u00e1n',
        country: 'M\u00e9xico',
        loginTime: new Date().toISOString(),
      };

    case 'login_otp':
      return {
        ...base,
        type: 'login_otp',
        otpCode: '482916',
      };

    case 'test_email':
    default:
      return {
        type: 'participant_invitation',
        to: recipient,
        recipientName: recipientName || 'Usuario de Prueba',
        documentName: '📧 Correo de Prueba — DocuBox',
        documentDescription: 'Este es un correo de prueba para verificar que el sistema de notificaciones funciona correctamente.',
        senderName: 'Sistema DocuBox (Prueba)',
        documentUrl: `${APP_URL}/portal-participante/test-token-prueba`,
        participantRole: 'Prueba',
        signatureMethod: 'Prueba de Sistema',
        personalMessage: 'Este correo fue generado automáticamente desde la página de pruebas de notificaciones.',
      };
  }
}

export async function POST(request: Request) {
  if (!isInternalAdminRequest(request)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const testMode: boolean = body.testMode === true;
  const testTarget: string = body.testTarget || 'all';
  const testRecipient: string = body.testRecipient || TEST_EMAIL;
  const recipientName: string = body.recipientName || 'Usuario de Prueba';
  const emailTemplate: string = body.emailTemplate || 'participant_invitation';
  const varNames: Record<string, string> = body.varNames || {
    var_nombre: 'Luis',
    var_documento: 'Prueba DocuBox',
    var_mensaje: 'Este es un mensaje de prueba desde DocuBox.',
  };

  const results: {
    email_direct: { success: boolean; message: string; details?: unknown };
    edge_function: { success: boolean; message: string; details?: unknown };
    sms: { success: boolean; message: string; details?: unknown; debugUrl?: string };
  } = {
    email_direct: { success: false, message: 'No ejecutado' },
    edge_function: { success: false, message: 'No ejecutado' },
    sms: { success: false, message: 'No ejecutado' },
  };

  // ── EMAIL DIRECTO (Resend API) ──────────────────────────────────────────────
  if (testTarget === 'all' || testTarget === 'email_direct') {
    try {
      const resendApiKey = process.env.RESEND_API_KEY;
      if (!resendApiKey || resendApiKey.includes('your-')) {
        results.email_direct = { success: false, message: 'RESEND_API_KEY no configurada o es un placeholder.' };
      } else {
        const fromEmail = 'Docubox <noreply@docubox.com.mx>';
        const emailPayload = {
          from: fromEmail,
          to: [testRecipient],
          subject: '✅ Prueba directa Resend — DocuBox',
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f9fafb;border-radius:8px;">
              <h2 style="color:#1e40af;">Prueba de envío directo (Resend API)</h2>
              <p style="color:#374151;">Este correo fue enviado directamente desde la API de Resend usando <strong>from: ${fromEmail}</strong>.</p>
              <p style="color:#374151;">Destinatario: <strong>${testRecipient}</strong></p>
              <p style="color:#374151;">Fecha y hora: <strong>${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}</strong></p>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
              <p style="color:#6b7280;font-size:12px;">Si recibes este correo, el dominio noreply@docubox.com.mx está verificado en Resend.</p>
            </div>
          `,
        };

        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(emailPayload),
        });

        let data = await res.json();

        if (res.ok && data.id) {
          results.email_direct = {
            success: true,
            message: `✅ Correo directo enviado a ${testRecipient}. ID: ${data.id}`,
            details: data,
          };
        } else {
          results.email_direct = {
            success: false,
            message: `❌ Error Resend (HTTP ${res.status}): ${data.message || data.name || JSON.stringify(data)}`,
            details: data,
          };
        }
      }
    } catch (err) {
      results.email_direct = {
        success: false,
        message: err instanceof Error ? err.message : 'Error inesperado en email directo.',
      };
    }
  }

  // ── EDGE FUNCTION (send-email-notifications) ──────────────────────────────
  if (testTarget === 'all' || testTarget === 'edge_function') {
    try {
      const edgePayload = buildEdgePayload(emailTemplate, testRecipient, recipientName);

      console.log('[test-notifications] Calling edge function send-email-notifications with type:', edgePayload.type, 'to:', testRecipient);

      const { data: edgeData, error: edgeError } = await supabaseAdmin.functions.invoke(
        'send-email-notifications',
        { body: edgePayload }
      );

      if (edgeError) {
        console.error('[test-notifications] Edge function error:', edgeError);
        results.edge_function = {
          success: false,
          message: `❌ Error del edge function: ${edgeError.message || JSON.stringify(edgeError)}`,
          details: edgeError,
        };
      } else if (edgeData && !edgeData.success) {
        console.error('[test-notifications] Edge function returned failure:', edgeData);
        results.edge_function = {
          success: false,
          message: `❌ Edge function falló: ${edgeData.error || JSON.stringify(edgeData)}`,
          details: edgeData,
        };
      } else {
        results.edge_function = {
          success: true,
          message: `✅ Correo enviado exitosamente. Resend ID: ${edgeData?.id || 'N/A'}`,
          details: edgeData,
        };
      }
    } catch (err) {
      console.error('[test-notifications] Unexpected error calling edge function:', err);
      results.edge_function = {
        success: false,
        message: err instanceof Error ? err.message : 'Error inesperado al llamar al edge function.',
      };
    }
  }

  // ── SMS TEST ────────────────────────────────────────────────────────────────
  if (testTarget === 'all' || testTarget === 'sms') {
    try {
      const digits = TEST_PHONE.replace(/[^\d]/g, '');
      const prefix = '52';
      const number = digits.startsWith('52') ? digits.slice(2) : digits;
      const numeroParam = `${prefix},${number}`;

      const tokenParam = testMode ? `pruebas_${ENVIA_SMS_TOKEN}` : ENVIA_SMS_TOKEN;

      const url = new URL(ENVIA_SMS_BASE_URL);
      url.searchParams.set('plantilla', ENVIA_SMS_TEMPLATE_ID);
      url.searchParams.set('token', tokenParam);
      url.searchParams.set('numero', numeroParam);
      url.searchParams.set('proyecto', ENVIA_SMS_PROJECT);
      url.searchParams.set('duplicado', '1');

      for (const [key, value] of Object.entries(varNames)) {
        if (key.startsWith('var_') && value) {
          url.searchParams.set(key, String(value));
        }
      }

      const debugUrl = url.toString().replace(ENVIA_SMS_TOKEN, '***TOKEN***');

      const response = await fetch(url.toString());

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        results.sms = {
          success: false,
          message: `HTTP ${response.status}: ${response.statusText}`,
          debugUrl,
        };
        return NextResponse.json({ timestamp: new Date().toISOString(), testMode, testTarget, emailTemplate, results });
      }

      const smsData = data as { error?: boolean; codigo_error?: string; mensaje_error?: string };

      if (!smsData.error) {
        results.sms = {
          success: true,
          message: testMode
            ? `SMS enviado en MODO PRUEBA (sin costo) a ${TEST_PHONE}.`
            : `SMS enviado a ${TEST_PHONE}.`,
          details: data,
          debugUrl,
        };
      } else {
        results.sms = {
          success: false,
          message: smsData.mensaje_error || smsData.codigo_error || 'Error al enviar SMS.',
          details: data,
          debugUrl,
        };
      }
    } catch (err) {
      results.sms = { success: false, message: err instanceof Error ? err.message : 'Error inesperado en SMS.' };
    }
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    testMode,
    testTarget,
    emailTemplate,
    results,
  });
}
