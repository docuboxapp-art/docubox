import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  sendDocumentCompletedEmail,
  sendDocumentExpiredToAll,
  sendActionRequiredEmail,
} from '@/lib/emailNotifications';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/notifications/document-status
 *
 * Triggers Resend email notifications based on document status events:
 *   - "signed"   → notifies owner + all participants that the document is complete
 *   - "expired"  → notifies owner + all participants that the document has expired
 *   - "action_required" → notifies a specific participant that their action is needed
 *
 * Body:
 *   { event: "signed" | "expired" | "action_required", documentId: string, recipientEmail?: string, recipientName?: string, actionDescription?: string }
 */
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
    const { event, documentId, recipientEmail, recipientName, actionDescription } = body;

    if (!event || !documentId) {
      return NextResponse.json({ error: 'event y documentId son requeridos' }, { status: 400 });
    }

    // Fetch document details
    const { data: doc, error: docError } = await supabaseAdmin
      .from('documentos')
      .select('id, nombre, owner_id, participantes, fecha_vencimiento')
      .eq('id', documentId)
      .maybeSingle();

    if (docError || !doc) {
      return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    }

    // Fetch owner profile
    const { data: ownerProfile } = await supabaseAdmin
      .from('profiles')
      .select('full_name, email')
      .eq('id', doc.owner_id)
      .maybeSingle();

    const ownerEmail = ownerProfile?.email || '';
    const ownerName = ownerProfile?.full_name || undefined;
    const documentName = doc.nombre || 'Documento';
    const participants: Array<{ email?: string; nombre?: string }> = Array.isArray(doc.participantes)
      ? doc.participantes
      : [];

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || '';

    if (event === 'signed') {
      // Notify owner
      if (ownerEmail) {
        await sendDocumentCompletedEmail({
          ownerEmail,
          ownerName,
          documentName,
          completedAt: new Date().toISOString(),
        });
      }
      // Notify all participants with email
      const emailParticipants = participants.filter(
        (p) => p.email && p.email.includes('@') && p.email !== ownerEmail
      );
      await Promise.allSettled(
        emailParticipants.map((p) =>
          sendDocumentCompletedEmail({
            ownerEmail: p.email!,
            ownerName: p.nombre || undefined,
            documentName,
            completedAt: new Date().toISOString(),
          })
        )
      );
      return NextResponse.json({ success: true, event: 'signed', notified: 1 + emailParticipants.length });
    }

    if (event === 'expired') {
      // Mark document as expired
      await supabaseAdmin
        .from('documentos')
        .update({ estado: 'vencido' })
        .eq('id', documentId);

      await sendDocumentExpiredToAll({
        participants,
        ownerEmail: ownerEmail || undefined,
        ownerName,
        documentName,
        expiredAt: doc.fecha_vencimiento || new Date().toISOString(),
      });
      return NextResponse.json({ success: true, event: 'expired' });
    }

    if (event === 'action_required') {
      if (!recipientEmail) {
        return NextResponse.json({ error: 'recipientEmail es requerido para action_required' }, { status: 400 });
      }

      // Get sender name from the calling user's profile
      const { data: senderProfile } = await supabaseAdmin
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle();

      await sendActionRequiredEmail({
        recipientEmail,
        recipientName: recipientName || undefined,
        documentName,
        senderName: senderProfile?.full_name || user.email || 'Un usuario',
        documentUrl: `${siteUrl}/mis-solicitudes`,
        actionDescription: actionDescription || 'Revisar y firmar el documento',
      });
      return NextResponse.json({ success: true, event: 'action_required' });
    }

    return NextResponse.json({ error: 'Evento no válido. Use: signed, expired, action_required' }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    console.error('[document-status-notify] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
