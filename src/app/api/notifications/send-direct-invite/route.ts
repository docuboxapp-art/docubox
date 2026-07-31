import { NextRequest, NextResponse } from 'next/server';
import { sendEmailNotification } from '@/lib/emailNotifications';

export async function POST(req: NextRequest) {
  try {
    const { to, recipientName, documentName, senderName, documentUrl } = await req.json();

    if (!to) {
      return NextResponse.json({ error: 'Destinatario requerido' }, { status: 400 });
    }

    await sendEmailNotification({
      type: 'participant_invitation',
      to,
      recipientName: recipientName || undefined,
      documentName: documentName || 'Documento',
      senderName: senderName || 'Docubox',
      documentUrl: documentUrl || `${process.env.NEXT_PUBLIC_SITE_URL}/portal-participante/invite`,
      participantRole: 'Firmante',
      signatureMethod: 'Firma Electrónica',
    });

    return NextResponse.json({ success: true, to });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    console.error('[send-direct-invite] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
