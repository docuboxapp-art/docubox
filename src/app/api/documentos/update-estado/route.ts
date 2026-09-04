import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/server';
import {
  sendParticipationCompletionEmail,
  sendParticipationCompletionEmailToAll,
  sendOwnerParticipantActionEmail,
} from '@/lib/emailNotifications';
import {
  createNotificationServer,
  createNotificationsForUsersServer,
} from '@/lib/notificationsInApp.server';

/**
 * POST /api/documentos/update-estado
 *
 * Updates document estado and participant sub_estados using the service role,
 * so that both owners AND participants can trigger state changes (reject, cancel, en_espera).
 *
 * Body:
 *   action: 'rechazar' | 'cancelar' | 'en_espera'
 *   documentoId: string (UUID)
 *   motivo?: string
 *   descripcion?: string
 *   userEmail?: string  — email of the acting participant (for rechazo)
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Validate session
    const cookieStore = await cookies();
    const anonClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Server components can reject cookie writes after response streaming.
            }
          },
        },
      }
    );

    const {
      data: { user },
      error: authError,
    } = await anonClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const body = await req.json();
    const { action, documentoId, motivo, descripcion } = body;

    if (!action || !documentoId) {
      return NextResponse.json({ error: 'Faltan parámetros requeridos' }, { status: 400 });
    }

    // 2. Use service client to bypass RLS
    const supabase = createServiceClient();

    // 3. Verify the user is the owner OR a participant of this document
    const { data: doc, error: docError } = await supabase
      .from('documentos')
      .select('id, owner_id, workspace_id, estado, participantes, nombre')
      .eq('id', documentoId)
      .single();

    if (docError || !doc) {
      return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    }

    const userEmail = (user.email ?? '').toLowerCase();
    const isOwner = doc.owner_id === user.id;
    const participantes: any[] = doc.participantes ?? [];
    const isParticipant = participantes.some(
      (p: any) => (p.email ?? '').toLowerCase() === userEmail
    );

    let isWorkspaceManager = false;
    if (!isOwner && doc.workspace_id) {
      const { data: membership } = await supabase
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', doc.workspace_id)
        .eq('user_id', user.id)
        .in('role', ['owner', 'admin'])
        .maybeSingle();
      isWorkspaceManager = Boolean(membership);
    }

    if (!isOwner && !isParticipant) {
      return NextResponse.json(
        { error: 'Sin permisos para modificar este documento' },
        { status: 403 }
      );
    }

    const now = new Date().toISOString();
    const docNombre = doc.nombre || 'Documento';

    // Fetch owner profile for email notifications
    const { data: ownerProfile } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', doc.owner_id)
      .maybeSingle();

    // Fetch acting user profile
    const { data: actorProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();
    const actorName = actorProfile?.full_name || user.email || 'Un participante';

    if (action === 'rechazar') {
      const updatePayload: Record<string, any> = { estado: 'rechazado' };

      const { error: updateError } = await supabase
        .from('documentos')
        .update(updatePayload)
        .eq('id', documentoId);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      // Update rejector's sub_estado to 'rechazo'
      const updatedParticipantes = participantes.map((p: any) => {
        const pEmail = (p.email ?? '').toLowerCase();
        if (pEmail === userEmail) {
          return {
            ...p,
            sub_estado: 'rechazo',
            fecha_rechazo: now,
            motivo_rechazo: motivo ?? undefined,
          };
        }
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
        const currentSub = (p.sub_estado ?? '').toLowerCase();
        if (!terminalStates.includes(currentSub)) {
          return { ...p, sub_estado: 'cancelo' };
        }
        return p;
      });

      await supabase
        .from('documentos')
        .update({ participantes: updatedParticipantes })
        .eq('id', documentoId);

      // ── In-app: notify owner ──────────────────────────────────────────────
      if (doc.owner_id && doc.owner_id !== user.id) {
        createNotificationServer({
          userId: doc.owner_id,
          type: 'alert',
          eventType: 'document.rejected',
          category: 'SIGNATURE',
          severity: 'warning',
          title: 'Participante rechazó el documento',
          description: `${actorName} ha rechazado "${docNombre}".${motivo ? ` Motivo: ${motivo}` : ''}`,
          priority: 'alta',
          workspaceId: doc.workspace_id,
          actorUserId: user.id,
          entityType: 'document',
          entityId: documentoId,
          actionUrl: `/visor-documento/${documentoId}`,
          actionLabel: 'Ver documento',
          deduplicationKey: `document.rejected:${documentoId}:${user.id}:${now}`,
          metadata: {
            documentoId,
            documentName: docNombre,
            participantEmail: user.email,
            action: 'rechazado',
          },
        }).catch(() => {});
      }

      // ── In-app: notify the rejector ───────────────────────────────────────
      createNotificationServer({
        userId: user.id,
        type: 'document',
        eventType: 'document.rejected',
        category: 'SIGNATURE',
        severity: 'warning',
        title: 'Has rechazado el documento',
        description: `Tu participación en "${docNombre}" ha concluido con rechazo.`,
        priority: 'media',
        workspaceId: doc.workspace_id,
        actorUserId: user.id,
        entityType: 'document',
        entityId: documentoId,
        actionUrl: `/visor-documento/${documentoId}`,
        actionLabel: 'Ver documento',
        deduplicationKey: `document.rejected.confirmation:${documentoId}:${user.id}:${now}`,
        metadata: { documentoId, documentName: docNombre, action: 'rechazado' },
      }).catch(() => {});

      // ── In-app: notify other non-terminal participants ────────────────────
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
      const otherParticipantUserIds = participantes
        .filter((p: any) => {
          const pEmail = (p.email ?? '').toLowerCase();
          return (
            pEmail !== userEmail &&
            !terminalStates.includes((p.sub_estado ?? '').toLowerCase()) &&
            p.user_id
          );
        })
        .map((p: any) => p.user_id)
        .filter((id: string) => id !== user.id && id !== doc.owner_id);

      if (otherParticipantUserIds.length > 0) {
        createNotificationsForUsersServer(otherParticipantUserIds, {
          type: 'alert',
          eventType: 'workflow.cancelled',
          category: 'WORKFLOW',
          severity: 'warning',
          title: 'Documento cancelado por rechazo',
          description: `El documento "${docNombre}" fue rechazado por un participante y el proceso ha sido detenido.`,
          priority: 'alta',
          workspaceId: doc.workspace_id,
          actorUserId: user.id,
          entityType: 'document',
          entityId: documentoId,
          actionUrl: `/visor-documento/${documentoId}`,
          actionLabel: 'Ver documento',
          deduplicationKey: `workflow.cancelled:${documentoId}:${now}`,
          metadata: { documentoId, documentName: docNombre, action: 'cancelado' },
        }).catch(() => {});
      }

      // ── Emails ────────────────────────────────────────────────────────────
      const rejector = participantes.find((p: any) => (p.email ?? '').toLowerCase() === userEmail);
      if (rejector?.email) {
        sendParticipationCompletionEmail({
          participantEmail: rejector.email,
          participantName: rejector.nombre || rejector.name,
          documentName: docNombre,
          participationStatus: 'rechazado',
          completedAt: now,
          participationMotivo: motivo,
        }).catch((err) => {
          console.error(
            '[update-estado] Failed to send rechazado email to rejector:',
            rejector.email,
            err?.message || err
          );
        });
      }

      // Email to owner when participant rejects
      if (ownerProfile?.email && doc.owner_id !== user.id) {
        sendOwnerParticipantActionEmail({
          ownerEmail: ownerProfile.email,
          ownerName: ownerProfile.full_name || undefined,
          documentName: docNombre,
          participantName: actorName,
          participantEmail: user.email,
          action: 'rechazado',
          motivo,
          completedAt: now,
        }).catch((err) => {
          console.error(
            '[update-estado] Failed to send owner rechazado notification email:',
            err?.message || err
          );
        });
      }

      const otherParticipants = participantes.filter((p: any) => {
        const pEmail = (p.email ?? '').toLowerCase();
        if (pEmail === userEmail) return false;
        return !terminalStates.includes((p.sub_estado ?? '').toLowerCase());
      });
      if (otherParticipants.length > 0) {
        sendParticipationCompletionEmailToAll({
          participants: otherParticipants,
          documentName: docNombre,
          participationStatus: 'cancelado',
          completedAt: now,
        }).catch((err) => {
          console.error(
            '[update-estado] Failed to send cancelado emails to other participants:',
            err?.message || err
          );
        });
      }

      return NextResponse.json({
        success: true,
        estado: 'rechazado',
        participantes: updatedParticipantes,
      });
    }

    if (action === 'cancelar') {
      if (!isOwner && !isWorkspaceManager) {
        return NextResponse.json(
          {
            error: 'Solo el propietario o un administrador autorizado puede cancelar el documento.',
          },
          { status: 403 }
        );
      }
      const { error: updateError } = await supabase
        .from('documentos')
        .update({
          estado: 'cancelado',
          cancelacion_motivo: motivo ?? null,
          cancelacion_descripcion: descripcion ?? null,
          cancelado_at: now,
        })
        .eq('id', documentoId);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

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
      const updatedParticipantes = participantes.map((p: any) => {
        const currentSub = (p.sub_estado ?? '').toLowerCase();
        if (!terminalStates.includes(currentSub)) {
          return { ...p, sub_estado: 'cancelo' };
        }
        return p;
      });

      await supabase
        .from('documentos')
        .update({ participantes: updatedParticipantes })
        .eq('id', documentoId);

      // ── In-app: notify owner (if a participant cancelled) ─────────────────
      if (doc.owner_id && doc.owner_id !== user.id) {
        createNotificationServer({
          userId: doc.owner_id,
          type: 'alert',
          eventType: 'workflow.cancelled',
          category: 'WORKFLOW',
          severity: 'warning',
          title: 'Participante canceló el documento',
          description: `${actorName} ha cancelado "${docNombre}".${motivo ? ` Motivo: ${motivo}` : ''}`,
          priority: 'alta',
          workspaceId: doc.workspace_id,
          actorUserId: user.id,
          entityType: 'document',
          entityId: documentoId,
          actionUrl: `/visor-documento/${documentoId}`,
          actionLabel: 'Ver documento',
          deduplicationKey: `workflow.cancelled.owner:${documentoId}:${user.id}:${now}`,
          metadata: {
            documentoId,
            documentName: docNombre,
            participantEmail: user.email,
            action: 'cancelado',
          },
        }).catch(() => {});
      }

      // ── In-app: notify all participants ───────────────────────────────────
      const participantUserIds = participantes
        .filter((p: any) => p.user_id && p.user_id !== user.id && p.user_id !== doc.owner_id)
        .map((p: any) => p.user_id);

      if (participantUserIds.length > 0) {
        createNotificationsForUsersServer(participantUserIds, {
          type: 'alert',
          eventType: 'workflow.cancelled',
          category: 'WORKFLOW',
          severity: 'warning',
          title: 'Documento cancelado',
          description: `El documento "${docNombre}" ha sido cancelado. Tu participación ha concluido.`,
          priority: 'alta',
          workspaceId: doc.workspace_id,
          actorUserId: user.id,
          entityType: 'document',
          entityId: documentoId,
          actionUrl: `/visor-documento/${documentoId}`,
          actionLabel: 'Ver documento',
          deduplicationKey: `workflow.cancelled:${documentoId}:${now}`,
          metadata: { documentoId, documentName: docNombre, action: 'cancelado' },
        }).catch(() => {});
      }

      // ── In-app: notify the actor ──────────────────────────────────────────
      createNotificationServer({
        userId: user.id,
        type: 'document',
        eventType: 'workflow.cancelled',
        category: 'WORKFLOW',
        severity: 'warning',
        title: 'Has cancelado el documento',
        description: `El documento "${docNombre}" ha sido cancelado.`,
        priority: 'media',
        workspaceId: doc.workspace_id,
        actorUserId: user.id,
        entityType: 'document',
        entityId: documentoId,
        actionUrl: `/visor-documento/${documentoId}`,
        actionLabel: 'Ver documento',
        deduplicationKey: `workflow.cancelled.confirmation:${documentoId}:${user.id}:${now}`,
        metadata: { documentoId, documentName: docNombre, action: 'cancelado' },
      }).catch(() => {});

      // ── Emails ────────────────────────────────────────────────────────────
      sendParticipationCompletionEmailToAll({
        participants: participantes,
        documentName: docNombre,
        participationStatus: 'cancelado',
        completedAt: now,
        participationMotivo: motivo,
      }).catch((err) => {
        console.error(
          '[update-estado] Failed to send cancelado emails on cancelar action:',
          err?.message || err
        );
      });

      // Email to owner when a participant (not owner) cancels
      if (ownerProfile?.email && doc.owner_id !== user.id) {
        sendOwnerParticipantActionEmail({
          ownerEmail: ownerProfile.email,
          ownerName: ownerProfile.full_name || undefined,
          documentName: docNombre,
          participantName: actorName,
          participantEmail: user.email,
          action: 'cancelado',
          motivo,
          completedAt: now,
        }).catch((err) => {
          console.error(
            '[update-estado] Failed to send owner cancelado notification email:',
            err?.message || err
          );
        });
      }

      return NextResponse.json({
        success: true,
        estado: 'cancelado',
        cancelado_at: now,
        participantes: updatedParticipantes,
      });
    }

    if (action === 'en_espera') {
      const { error: updateError } = await supabase
        .from('documentos')
        .update({
          estado: 'en_espera',
          en_espera_motivo: motivo ?? null,
          en_espera_descripcion: descripcion ?? null,
        })
        .eq('id', documentoId);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, estado: 'en_espera' });
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 });
  } catch (err: any) {
    console.error('[update-estado] Error:', err);
    return NextResponse.json({ error: err.message ?? 'Error interno' }, { status: 500 });
  }
}
