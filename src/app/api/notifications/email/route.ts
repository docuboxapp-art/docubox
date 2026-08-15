import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  sendSignatureRequestEmails,
  sendDocumentCompletedEmail,
  sendCertificateExpiryEmail,
  sendDocumentExpiredEmail,
  sendActionRequiredEmail,
} from '@/lib/emailNotifications';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await req.json();
    const {
      type,
      documentId,
      documentName,
      participants,
      expiryDate,
      completedAt,
      expiredAt,
      actionDescription,
      recipientEmail,
      recipientName,
    } = body;

    if (!type) {
      return NextResponse.json({ error: 'Tipo de notificación requerido' }, { status: 400 });
    }

    // Get sender profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('full_name, email')
      .eq('id', user.id)
      .maybeSingle();

    const senderName = profile?.full_name || user.email || 'Un usuario';
    const ownerEmail = profile?.email || user.email || '';

    if (type === 'signature_request') {
      if (!participants || !Array.isArray(participants) || participants.length === 0) {
        return NextResponse.json({ error: 'Participantes requeridos' }, { status: 400 });
      }
      await sendSignatureRequestEmails({
        participants,
        documentName: documentName || 'Documento',
        senderName,
        documentUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/mis-solicitudes`,
      });
      return NextResponse.json({ success: true, sent: participants.filter((p: any) => p.email).length });
    }

    if (type === 'document_completed') {
      if (!ownerEmail) {
        return NextResponse.json({ error: 'Email del propietario no disponible' }, { status: 400 });
      }
      await sendDocumentCompletedEmail({
        ownerEmail,
        ownerName: senderName,
        documentName: documentName || 'Documento',
        completedAt: completedAt || new Date().toISOString(),
      });
      // Also notify participants if provided
      if (participants && Array.isArray(participants)) {
        const emailParticipants = participants.filter((p: any) => p.email && p.email !== ownerEmail);
        await Promise.allSettled(
          emailParticipants.map((p: any) =>
            sendDocumentCompletedEmail({
              ownerEmail: p.email,
              ownerName: p.nombre || p.name || undefined,
              documentName: documentName || 'Documento',
              completedAt: completedAt || new Date().toISOString(),
            })
          )
        );
      }
      return NextResponse.json({ success: true });
    }

    if (type === 'certificate_expiry') {
      if (!ownerEmail || !expiryDate) {
        return NextResponse.json({ error: 'Email y fecha de vencimiento requeridos' }, { status: 400 });
      }
      await sendCertificateExpiryEmail({
        ownerEmail,
        ownerName: senderName,
        documentName: documentName || 'Documento',
        expiryDate,
      });
      return NextResponse.json({ success: true });
    }

    if (type === 'document_expired') {
      const targetEmail = recipientEmail || ownerEmail;
      if (!targetEmail) {
        return NextResponse.json({ error: 'Email del destinatario no disponible' }, { status: 400 });
      }
      await sendDocumentExpiredEmail({
        recipientEmail: targetEmail,
        recipientName: recipientName || senderName,
        documentName: documentName || 'Documento',
        expiredAt: expiredAt || new Date().toISOString(),
      });
      return NextResponse.json({ success: true });
    }

    if (type === 'action_required') {
      const targetEmail = recipientEmail || ownerEmail;
      if (!targetEmail) {
        return NextResponse.json({ error: 'Email del destinatario no disponible' }, { status: 400 });
      }
      await sendActionRequiredEmail({
        recipientEmail: targetEmail,
        recipientName: recipientName || undefined,
        documentName: documentName || 'Documento',
        senderName,
        documentUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/mis-solicitudes`,
        actionDescription,
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Tipo de notificación no válido' }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    console.error('[email-notifications] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
