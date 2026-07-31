import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendParticipantInvitationEmails } from '@/lib/emailNotifications';
import { createNotificationServer } from '@/lib/notificationsInApp';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const TERMINAL_SUB_ESTADOS = [
  'firmo', 'firmado', 'aprobo', 'aprobado',
  'rechazo', 'rechazado', 'cancelo', 'cancelado',
];

function isTerminal(sub: string): boolean {
  return TERMINAL_SUB_ESTADOS.includes((sub ?? '').toLowerCase());
}

/**
 * POST /api/documentos/advance-participation
 *
 * Called after a participant completes their action (firma, aprobación, rechazo, cancelación).
 * Determines the next participant(s) to notify based on participation_order:
 *   - paralelo: all notified at once (no advancement needed)
 *   - secuencial: notify next in line
 *   - mixto: notify next group or next in group
 *
 * Body: { documentoId: string (UUID) }
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    }

    const body = await req.json();
    const { documentoId } = body;

    if (!documentoId) {
      return NextResponse.json({ error: 'documentoId requerido' }, { status: 400 });
    }

    // Fetch document
    const { data: doc, error: docError } = await supabaseAdmin
      .from('documentos')
      .select('id, nombre, estado, owner_id, participantes, participation_order, grupos_firma, workspace_id')
      .eq('id', documentoId)
      .single();

    if (docError || !doc) {
      return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    }

    // Only advance if document is still active
    if (doc.estado === 'completado' || doc.estado === 'cancelado' || doc.estado === 'rechazado') {
      return NextResponse.json({ success: true, advanced: false, reason: 'document_terminal' });
    }

    const participantes: any[] = doc.participantes ?? [];
    const participationOrder: string = doc.participation_order ?? 'paralelo';
    const gruposFirma: any[] = doc.grupos_firma ?? [];
    const docNombre = doc.nombre || 'Documento';

    // Fetch sender (owner) profile
    const { data: ownerProfile } = await supabaseAdmin
      .from('profiles')
      .select('full_name, email')
      .eq('id', doc.owner_id)
      .maybeSingle();
    const senderName = ownerProfile?.full_name || ownerProfile?.email || 'Docubox';

    // Determine which participants to notify next
    const nextParticipants = getNextParticipantsToNotify(
      participantes,
      participationOrder,
      gruposFirma
    );

    if (nextParticipants.length === 0) {
      return NextResponse.json({ success: true, advanced: false, reason: 'no_next_participants' });
    }

    // Mark them as visible + notificado in the JSONB
    const nextIds = nextParticipants.map((p: any) => p.id).filter(Boolean);
    const nextEmails = nextParticipants.map((p: any) => p.email).filter(Boolean);

    const updatedParticipantes = participantes.map((p: any) => {
      const isNext = nextIds.includes(p.id) || nextEmails.includes(p.email);
      if (isNext) {
        return { ...p, visible: true, notificado: true, fecha_notificacion: new Date().toISOString() };
      }
      return p;
    });

    await supabaseAdmin
      .from('documentos')
      .update({ participantes: updatedParticipantes })
      .eq('id', documentoId);

    // Send in-app notifications to next participants who have a user_id
    for (const p of nextParticipants) {
      if (p.isCurrentUser) continue;
      const participantUserId = p.user_id;
      if (participantUserId) {
        const signingUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/portal-participante/${documentoId}`;
        createNotificationServer({
          userId: participantUserId,
          type: 'document',
          title: 'Es tu turno de participar en un documento',
          description: `${senderName} requiere tu participación en "${docNombre}".`,
          priority: 'alta',
          metadata: {
            documentoId: documentoId,
            documentName: docNombre,
            senderName,
            role: p.acto || p.rolDocumento || 'Participante',
            documentUrl: signingUrl,
          },
        }).catch(() => {});
      }
    }

    // Send email notifications to next participants with email method
    // Also send to participants with no tipoNotificacion set (fallback)
    const emailParticipants = nextParticipants.filter((p: any) => {
      if (!p.email || p.isCurrentUser) return false;
      if (!p.email.includes('@')) return false;
      const notifMethods = (p.tipoNotificacion || []).map((n: string) => n.toLowerCase());
      // Send if explicitly chose email, OR if no notification method was configured (fallback)
      if (notifMethods.length === 0) return true;
      return notifMethods.some((n: string) => n === 'correo' || n === 'email');
    });

    if (emailParticipants.length > 0) {
      const participantsWithPortalUrl = emailParticipants.map((p: any) => ({
        ...p,
        documentUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/portal-participante/${documentoId}`,
      }));

      await sendParticipantInvitationEmails({
        participants: participantsWithPortalUrl,
        documentName: docNombre,
        senderName,
        documentUrl: `${process.env.NEXT_PUBLIC_SITE_URL}/portal-participante/${documentoId}`,
      }).catch((err) => {
        console.error('[advance-participation] Error sending emails:', err?.message || err);
      });
    }

    // Log audit trail
    try {
      await supabaseAdmin.from('audit_trail').insert(
        nextParticipants.map((p: any) => ({
          documento_id: documentoId,
          actor_id: user.id,
          action: 'invitacion_enviada',
          category: 'notificacion',
          details: {
            participant_email: p.email,
            participant_name: p.name,
            participation_order: participationOrder,
            channel: 'advance_chain',
          },
        }))
      );
    } catch { /* non-critical */ }

    return NextResponse.json({
      success: true,
      advanced: true,
      notifiedCount: nextParticipants.length,
      notifiedEmails: nextEmails,
    });
  } catch (err: any) {
    console.error('[advance-participation] Error:', err);
    return NextResponse.json({ error: err.message ?? 'Error interno' }, { status: 500 });
  }
}

// ─── Helper: determine next participants based on participation order ──────────

function getNextParticipantsToNotify(
  participantes: any[],
  participationOrder: string,
  gruposFirma: any[]
): any[] {
  const nonOwner = participantes.filter((p: any) => !p.isCurrentUser);

  // PARALELO: all non-terminal, non-owner participants
  if (participationOrder === 'paralelo' || !participationOrder) {
    return nonOwner.filter((p: any) => !isTerminal(p.sub_estado ?? ''));
  }

  // SECUENCIAL: first non-terminal participant in order
  if (participationOrder === 'secuencial') {
    const next = nonOwner.find((p: any) => !isTerminal(p.sub_estado ?? ''));
    return next ? [next] : [];
  }

  // MIXTO: process groups in order
  if (participationOrder === 'mixto' && gruposFirma.length > 0) {
    for (const grupo of gruposFirma) {
      const grupoTipo: string = grupo.tipo ?? 'paralelo';
      const grupoParticipantIds: string[] = grupo.participantIds ?? [];

      // Get participants in this group
      const grupoParticipantes = participantes.filter((p: any) =>
        grupoParticipantIds.includes(p.id) && !p.isCurrentUser
      );

      // Check if this group is fully completed
      const allTerminal = grupoParticipantes.every((p: any) => isTerminal(p.sub_estado ?? ''));
      if (allTerminal && grupoParticipantes.length > 0) {
        continue; // This group is done, move to next
      }

      // This is the active group
      if (grupoTipo === 'paralelo') {
        // All non-terminal participants in this group
        return grupoParticipantes.filter((p: any) => !isTerminal(p.sub_estado ?? ''));
      } else if (grupoTipo === 'secuencial') {
        // First non-terminal participant in this group (in order)
        const orderedGroup = grupoParticipantIds
          .map((id: string) => participantes.find((p: any) => p.id === id))
          .filter(Boolean);
        const next = orderedGroup.find((p: any) => !isTerminal(p.sub_estado ?? '') && !p.isCurrentUser);
        return next ? [next] : [];
      }

      break;
    }
    return [];
  }

  // Fallback
  return nonOwner.filter((p: any) => !isTerminal(p.sub_estado ?? ''));
}
