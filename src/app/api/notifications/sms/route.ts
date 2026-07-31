import { NextRequest, NextResponse } from 'next/server';
import { sendSms, sendSignatureRequestSmsToParticipants } from '@/lib/smsNotifications';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === 'send_single') {
      // Send to a single recipient
      const { phone, recipientName, documentName, message, templateId, scheduledAt } = body;

      if (!phone) {
        return NextResponse.json(
          { error: true, mensaje_error: 'El campo "phone" es requerido.' },
          { status: 400 }
        );
      }

      const result = await sendSms({ phone, recipientName, documentName, message, templateId, scheduledAt });
      return NextResponse.json(result);
    }

    if (action === 'send_to_participants') {
      // Send to all SMS participants of a document
      const { participants, documentName, documentUrl } = body;

      if (!participants || !Array.isArray(participants)) {
        return NextResponse.json(
          { error: true, mensaje_error: 'El campo "participants" debe ser un arreglo.' },
          { status: 400 }
        );
      }

      await sendSignatureRequestSmsToParticipants({ participants, documentName, documentUrl });
      return NextResponse.json({ success: true, mensaje: 'SMS enviados a los participantes.' });
    }

    return NextResponse.json(
      { error: true, mensaje_error: 'Acción no reconocida. Use "send_single" o "send_to_participants".' },
      { status: 400 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error interno del servidor';
    console.error('[SMS API] Error:', message);
    return NextResponse.json({ error: true, mensaje_error: message }, { status: 500 });
  }
}
