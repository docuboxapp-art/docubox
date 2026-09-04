import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  sendCertificateExpiryEmail,
  sendDocumentExpiredToAll,
  sendParticipationCompletionEmailToAll,
} from '@/lib/emailNotifications';
import {
  createNotificationServer,
  createNotificationsForUsersServer,
} from '@/lib/notificationsInApp.server';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// This route can be called by a cron job or Supabase scheduled function.
// It handles two scenarios:
//   1. Documents expiring within 72 hours → sends expiry warning to owner + participants
//   2. Documents already past their expiry date → marks as 'vencido' and notifies all parties
export async function POST(req: NextRequest) {
  try {
    // Simple secret check to prevent unauthorized calls
    const authHeader = req.headers.get('Authorization');
    const secret = authHeader?.replace('Bearer ', '');
    if (secret !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const now = new Date();
    const in72h = new Date(now.getTime() + 72 * 60 * 60 * 1000);

    // ── 1. Find documents expiring within 72 hours (not yet expired) ──────────
    const { data: expiringDocs, error: expiringError } = await supabaseAdmin
      .from('documentos')
      .select('id, nombre, fecha_vencimiento, owner_id, workspace_id, participantes')
      .is('deleted_at', null)
      .not('fecha_vencimiento', 'is', null)
      .lte('fecha_vencimiento', in72h.toISOString())
      .gte('fecha_vencimiento', now.toISOString())
      .not('estado', 'in', '("completado","vencido","cancelado")');

    if (expiringError) {
      console.error('[expiry-check] Error querying expiring documents:', expiringError.message);
      return NextResponse.json({ error: expiringError.message }, { status: 500 });
    }

    // ── 2. Find documents that have already expired ───────────────────────────
    const { data: expiredDocs, error: expiredError } = await supabaseAdmin
      .from('documentos')
      .select('id, nombre, fecha_vencimiento, owner_id, workspace_id, participantes')
      .is('deleted_at', null)
      .not('fecha_vencimiento', 'is', null)
      .lt('fecha_vencimiento', now.toISOString())
      .not('estado', 'in', '("completado","vencido","cancelado")');

    if (expiredError) {
      console.error('[expiry-check] Error querying expired documents:', expiredError.message);
      return NextResponse.json({ error: expiredError.message }, { status: 500 });
    }

    let expiryWarningsSent = 0;
    let expiredNotificationsSent = 0;

    // ── Process expiry warnings ───────────────────────────────────────────────
    for (const doc of expiringDocs || []) {
      try {
        const { data: ownerProfile } = await supabaseAdmin
          .from('profiles')
          .select('full_name, email')
          .eq('id', doc.owner_id)
          .maybeSingle();

        const participants: Array<{ email?: string; nombre?: string; user_id?: string }> =
          Array.isArray(doc.participantes) ? doc.participantes : [];

        // ── In-app notification: owner ────────────────────────────────────────
        if (doc.owner_id) {
          await createNotificationServer({
            userId: doc.owner_id,
            type: 'alert',
            eventType: 'document.expiring',
            category: 'DOCUMENT',
            severity: 'warning',
            title: 'Documento próximo a vencer',
            description: `El documento "${doc.nombre || 'Documento'}" vencerá en menos de 72 horas. Completa el proceso de firma.`,
            priority: 'alta',
            workspaceId: typeof doc.workspace_id === 'string' ? doc.workspace_id : null,
            entityType: 'document',
            entityId: doc.id,
            actionUrl: `/visor-documento/${doc.id}`,
            actionLabel: 'Ver documento',
            deduplicationKey: `document.expiring:${doc.id}:${doc.fecha_vencimiento}`,
            metadata: {
              documentoId: doc.id,
              documentName: doc.nombre,
              expiryDate: doc.fecha_vencimiento,
            },
          });
        }

        // ── In-app notification: participants with user_id ────────────────────
        const participantUserIds = participants
          .map((p: any) => p.user_id)
          .filter((id: any): id is string => !!id && id !== doc.owner_id);
        if (participantUserIds.length > 0) {
          await createNotificationsForUsersServer(participantUserIds, {
            type: 'alert',
            eventType: 'document.expiring',
            category: 'DOCUMENT',
            severity: 'warning',
            title: 'Documento próximo a vencer',
            description: `El documento "${doc.nombre || 'Documento'}" vencerá en menos de 72 horas. Completa tu participación.`,
            priority: 'alta',
            workspaceId: typeof doc.workspace_id === 'string' ? doc.workspace_id : null,
            entityType: 'document',
            entityId: doc.id,
            actionUrl: `/visor-documento/${doc.id}`,
            actionLabel: 'Ver documento',
            deduplicationKey: `document.expiring:${doc.id}:${doc.fecha_vencimiento}`,
            metadata: {
              documentoId: doc.id,
              documentName: doc.nombre,
              expiryDate: doc.fecha_vencimiento,
            },
          });
        }

        // ── Email: owner ──────────────────────────────────────────────────────
        if (ownerProfile?.email) {
          await sendCertificateExpiryEmail({
            ownerEmail: ownerProfile.email,
            ownerName: ownerProfile.full_name || undefined,
            documentName: doc.nombre || 'Documento',
            expiryDate: doc.fecha_vencimiento,
          });
          expiryWarningsSent++;
        }

        // ── Email: participants ───────────────────────────────────────────────
        for (const p of participants) {
          if (p.email && p.email.includes('@') && p.email !== ownerProfile?.email) {
            await sendCertificateExpiryEmail({
              ownerEmail: p.email,
              ownerName: p.nombre || undefined,
              documentName: doc.nombre || 'Documento',
              expiryDate: doc.fecha_vencimiento,
            });
            expiryWarningsSent++;
          }
        }
      } catch (docErr) {
        console.error(`[expiry-check] Error sending expiry warning for doc ${doc.id}:`, docErr);
      }
    }

    // ── Process expired documents ─────────────────────────────────────────────
    for (const doc of expiredDocs || []) {
      try {
        // Mark document as expired
        await supabaseAdmin.from('documentos').update({ estado: 'vencido' }).eq('id', doc.id);

        const { data: ownerProfile } = await supabaseAdmin
          .from('profiles')
          .select('full_name, email')
          .eq('id', doc.owner_id)
          .maybeSingle();

        const participants: Array<{
          email?: string;
          nombre?: string;
          user_id?: string;
          sub_estado?: string;
        }> = Array.isArray(doc.participantes) ? doc.participantes : [];

        // ── In-app notification: owner ────────────────────────────────────────
        if (doc.owner_id) {
          await createNotificationServer({
            userId: doc.owner_id,
            type: 'alert',
            eventType: 'document.expired',
            category: 'DOCUMENT',
            severity: 'warning',
            title: 'Documento vencido',
            description: `El documento "${doc.nombre || 'Documento'}" ha vencido sin completar el proceso de firma.`,
            priority: 'alta',
            workspaceId: typeof doc.workspace_id === 'string' ? doc.workspace_id : null,
            entityType: 'document',
            entityId: doc.id,
            actionUrl: `/visor-documento/${doc.id}`,
            actionLabel: 'Ver documento',
            deduplicationKey: `document.expired:${doc.id}:${doc.fecha_vencimiento}`,
            metadata: {
              documentoId: doc.id,
              documentName: doc.nombre,
              expiredAt: doc.fecha_vencimiento,
            },
          });
        }

        // ── In-app notification: participants with user_id ────────────────────
        const participantUserIds = participants
          .map((p: any) => p.user_id)
          .filter((id: any): id is string => !!id && id !== doc.owner_id);
        if (participantUserIds.length > 0) {
          await createNotificationsForUsersServer(participantUserIds, {
            type: 'alert',
            eventType: 'document.expired',
            category: 'DOCUMENT',
            severity: 'warning',
            title: 'Documento vencido',
            description: `El documento "${doc.nombre || 'Documento'}" ha vencido. Ya no es posible completar la firma.`,
            priority: 'alta',
            workspaceId: typeof doc.workspace_id === 'string' ? doc.workspace_id : null,
            entityType: 'document',
            entityId: doc.id,
            actionUrl: `/visor-documento/${doc.id}`,
            actionLabel: 'Ver documento',
            deduplicationKey: `document.expired:${doc.id}:${doc.fecha_vencimiento}`,
            metadata: {
              documentoId: doc.id,
              documentName: doc.nombre,
              expiredAt: doc.fecha_vencimiento,
            },
          });
        }

        // ── Emails ────────────────────────────────────────────────────────────
        await sendDocumentExpiredToAll({
          participants,
          ownerEmail: ownerProfile?.email || undefined,
          ownerName: ownerProfile?.full_name || undefined,
          documentName: doc.nombre || 'Documento',
          expiredAt: doc.fecha_vencimiento,
        });

        // Send participation_completed (vencido) email to each pending participant
        const pendingParticipants = participants.filter((p: any) => {
          const terminalStates = [
            'firmo',
            'firmado',
            'rechazo',
            'rechazado',
            'aprobo',
            'aprobado',
            'cancelo',
            'cancelado',
          ];
          return !terminalStates.includes((p.sub_estado ?? '').toLowerCase());
        });
        if (pendingParticipants.length > 0) {
          await sendParticipationCompletionEmailToAll({
            participants: pendingParticipants,
            documentName: doc.nombre || 'Documento',
            participationStatus: 'vencido',
            completedAt: doc.fecha_vencimiento,
          });
        }

        expiredNotificationsSent++;
      } catch (docErr) {
        console.error(`[expiry-check] Error processing expired doc ${doc.id}:`, docErr);
      }
    }

    return NextResponse.json({
      success: true,
      expiryWarningsSent,
      expiredNotificationsSent,
      expiredDocsMarked: expiredDocs?.length || 0,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    console.error('[expiry-check] Unexpected error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
