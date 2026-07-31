import { NextRequest, NextResponse } from 'next/server';
import { sendEmailNotification } from '@/lib/emailNotifications';

// One-shot endpoint: sends a participant_invitation to luishb.mzt@gmail.com
export async function GET(_req: NextRequest) {
  try {
    await sendEmailNotification({
      type: 'participant_invitation',
      to: 'luishb.mzt@gmail.com',
      recipientName: 'Luis',
      documentName: 'Documento para firma',
      senderName: 'Docubox',
      documentUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/portal-participante/test-token-demo`,
      participantRole: 'Firmante',
      signatureMethod: 'Firma Electrónica',
    });

    return NextResponse.json({ success: true, message: 'Invitación enviada a luishb.mzt@gmail.com' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    console.error('[trigger-invite] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
