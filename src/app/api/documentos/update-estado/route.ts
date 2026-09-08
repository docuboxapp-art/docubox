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
import {
  hasEffectiveParticipation,
  type ParticipationResponseRecord,
  type SignatureEvidenceRecord,
} from '@/lib/documents/participant-visibility';

/**
 * POST /api/documentos/update-estado
 *
 * Updates document estado and participant sub_estados using the service role,
 * so that both owners AND participants can trigger state changes (reject, cancel, en_espera).
 *
 * Body:
 *   action: 'rechazar' | 'cancelar' | 'desinvitar' | 'en_espera'
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
    const { action, documentoId, motivo, descripcion, participantId, participantEmail } = body;

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

    if (!isOwner && !isParticipant && !isWorkspaceManager) {
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

    if (action === 'desinvitar') {
      if (!isOwner && !isWorkspaceManager) {
        return NextResponse.json(
          { error: 'Solo el propietario o un administrador autorizado puede desinvitar participantes.' },
          { status: 403 }
        );
      }

      const activeDocumentStates = new Set([
        'pendiente',
        'en_proceso',
        'en_espera',
        'sent',
        'in_progress',
        'waiting_signatures',
      ]);
      if (!activeDocumentStates.has(String(doc.estado || '').toLowerCase())) {
        return NextResponse.json(
          { error: 'Sólo se pueden desinvitar participantes de un documento activo.' },
          { status: 409 }
        );
      }

      const normalizedParticipantEmail = String(participantEmail || '').trim().toLowerCase();
      const participantIndex = participantes.findIndex(
        (participant: any) =>
          (participantId && (participant.id === participantId || participant.user_id === participantId))
          || (normalizedParticipantEmail
            && String(participant.email || '').trim().toLowerCase() === normalizedParticipantEmail)
      );
      if (participantIndex < 0) {
        return NextResponse.json({ error: 'Participante no encontrado.' }, { status: 404 });
      }

      const participant = participantes[participantIndex];
      if (participant.isCurrentUser || participant.user_id === doc.owner_id) {
        return NextResponse.json(
          { error: 'El propietario no puede desinvitarse del documento.' },
          { status: 409 }
        );
      }
      if (participant.current_access === false) {
        return NextResponse.json({
          success: true,
          alreadyRevoked: true,
          hadEffectiveParticipation: participant.historical_participation === true,
          participant: {
            id: participant.id || null,
            email: participant.email || null,
          },
        });
      }

      const [responsesResult, evidenceResult] = await Promise.all([
        supabase
          .from('participation_responses')
          .select(
            'participante_id,participante_email,firma_data,firma_completada,aprobacion_completada,terminos_aceptados'
          )
          .eq('documento_id', documentoId),
        supabase
          .from('signature_evidence')
          .select('captured_by,participant_email')
          .eq('document_id', documentoId),
      ]);
      if (responsesResult.error || evidenceResult.error) {
        return NextResponse.json(
          { error: 'No fue posible comprobar la participación histórica.' },
          { status: 500 }
        );
      }

      const hadEffectiveParticipation = hasEffectiveParticipation(
        participant,
        (responsesResult.data || []) as ParticipationResponseRecord[],
        (evidenceResult.data || []) as SignatureEvidenceRecord[]
      );
      const revokedParticipant = {
        ...participant,
        sub_estado: hadEffectiveParticipation
          ? participant.sub_estado
          : 'revocado',
        participation_status: hadEffectiveParticipation
          ? participant.participation_status || participant.sub_estado || participant.status
          : 'REVOKED',
        current_access: false,
        historical_participation: hadEffectiveParticipation,
        visible: hadEffectiveParticipation,
        participant_relationship_status: 'REVOKED',
        access_revoked_at: now,
        access_revoked_by: user.id,
        access_revoke_reason: motivo || 'OWNER_UNINVITED_PARTICIPANT',
        portal_token_invalidated_at: now,
        recordatorios_cancelados_at: now,
      };
      const updatedParticipantes = participantes.map((entry: any, index: number) =>
        index === participantIndex ? revokedParticipant : entry
      );

      const { error: updateError } = await supabase
        .from('documentos')
        .update({ participantes: updatedParticipantes })
        .eq('id', documentoId);
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      const { error: auditError } = await supabase
        .from('document_lifecycle_audit_events')
        .insert({
          workspace_id: doc.workspace_id || null,
          document_id: documentoId,
          actor_id: user.id,
          actor_email: user.email || null,
          action: hadEffectiveParticipation
            ? 'PARTICIPANT_HISTORY_RETAINED_AFTER_REVOKE'
            : 'PARTICIPANT_UNINVITED',
          previous_state: {
            participant_id: participant.id || null,
            participant_email: participant.email || null,
            current_access: participant.current_access !== false,
            participation_status: participant.participation_status || participant.sub_estado || null,
          },
          new_state: {
            participant_relationship_status: 'REVOKED',
            current_access: false,
            historical_participation: hadEffectiveParticipation,
            visible: hadEffectiveParticipation,
          },
          reason: motivo || 'OWNER_UNINVITED_PARTICIPANT',
          result: 'success',
          request_id: req.headers.get('x-request-id') || null,
          ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
          user_agent: req.headers.get('user-agent') || null,
          metadata: { had_effective_participation: hadEffectiveParticipation },
        });
      if (auditError) {
        console.error('[update-estado] Could not audit participant revocation:', auditError.message);
      }

      if (participant.user_id && participant.user_id !== user.id) {
        createNotificationServer({
          userId: participant.user_id,
          type: 'alert',
          eventType: 'participant.access.revoked',
          category: 'WORKFLOW',
          severity: 'warning',
          title: 'Tu acceso al documento fue revocado',
          description: hadEffectiveParticipation
            ? `Ya no puedes realizar acciones en "${docNombre}". Tu participación anterior se conserva.`
            : `Ya no formas parte del flujo de "${docNombre}".`,
          priority: 'media',
          workspaceId: doc.workspace_id,
          actorUserId: user.id,
          entityType: 'document',
          entityId: documentoId,
          actionUrl: '/mis-participaciones',
          actionLabel: 'Ver mis participaciones',
          deduplicationKey: `participant.access.revoked:${documentoId}:${participant.user_id}`,
          metadata: {
            documentoId,
            documentName: docNombre,
            hadEffectiveParticipation,
          },
        }).catch(() => {});
      }

      return NextResponse.json({
        success: true,
        hadEffectiveParticipation,
        participant: {
          id: participant.id || null,
          email: participant.email || null,
        },
      });
    }

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
      const [responsesResult, evidenceResult] = await Promise.all([
        supabase
          .from('participation_responses')
          .select(
            'participante_id,participante_email,firma_data,firma_completada,aprobacion_completada,terminos_aceptados'
          )
          .eq('documento_id', documentoId),
        supabase
          .from('signature_evidence')
          .select('captured_by,participant_email')
          .eq('document_id', documentoId),
      ]);
      if (responsesResult.error || evidenceResult.error) {
        return NextResponse.json(
          { error: 'No fue posible comprobar la participación histórica antes de cancelar.' },
          { status: 500 }
        );
      }

      const responses = (responsesResult.data || []) as ParticipationResponseRecord[];
      const evidence = (evidenceResult.data || []) as SignatureEvidenceRecord[];
      const participantOutcomes = participantes.map((participant: any) => {
        const hadEffectiveParticipation = hasEffectiveParticipation(participant, responses, evidence);
        if (hadEffectiveParticipation) {
          return {
            participant: {
              ...participant,
              current_access: false,
              historical_participation: true,
              visible: true,
              participant_relationship_status: 'CANCELLED_BY_DOCUMENT',
              participation_status: participant.sub_estado ?? participant.status ?? 'participacion_realizada',
              workflow_cancelled_at: now,
            },
            hadEffectiveParticipation,
          };
        }

        return {
          participant: {
            ...participant,
            sub_estado: 'cancelo',
            current_access: false,
            historical_participation: false,
            visible: false,
            participant_relationship_status: 'CANCELLED_BY_DOCUMENT',
            participation_status: 'CANCELLED_BY_DOCUMENT',
            access_revoked_at: now,
            access_revoked_by: user.id,
            access_revoke_reason: 'DOCUMENT_CANCELLED',
            portal_token_invalidated_at: now,
          },
          hadEffectiveParticipation,
        };
      });
      const updatedParticipantes = participantOutcomes.map(({ participant }) => participant);

      const { error: updateError } = await supabase
        .from('documentos')
        .update({
          estado: 'cancelado',
          cancelacion_motivo: motivo ?? null,
          cancelacion_descripcion: descripcion ?? null,
          cancelado_at: now,
          participantes: updatedParticipantes,
        })
        .eq('id', documentoId);
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      const auditEvents = participantOutcomes.map(({ participant, hadEffectiveParticipation }) => ({
        workspace_id: doc.workspace_id || null,
        document_id: documentoId,
        actor_id: user.id,
        actor_email: user.email || null,
        action: hadEffectiveParticipation
          ? 'PARTICIPANT_HISTORY_RETAINED_AFTER_CANCEL'
          : 'PARTICIPANT_ACCESS_REVOKED_BY_DOCUMENT_CANCEL',
        previous_state: {
          participant_id: participant.id || null,
          participant_email: participant.email || null,
        },
        new_state: {
          participant_relationship_status: 'CANCELLED_BY_DOCUMENT',
          current_access: false,
          historical_participation: hadEffectiveParticipation,
          visible: hadEffectiveParticipation,
        },
        reason: motivo ?? 'DOCUMENT_CANCELLED',
        result: 'success',
        request_id: req.headers.get('x-request-id') || null,
        ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
        user_agent: req.headers.get('user-agent') || null,
        metadata: { had_effective_participation: hadEffectiveParticipation },
      }));
      if (auditEvents.length > 0) {
        const { error: auditError } = await supabase
          .from('document_lifecycle_audit_events')
          .insert(auditEvents);
        if (auditError) {
          console.error('[update-estado] Could not audit participant cancellation outcomes:', auditError.message);
        }
      }

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
      const participantUserIds = participantOutcomes
        .filter(
          ({ participant, hadEffectiveParticipation }) =>
            hadEffectiveParticipation
            && participant.user_id
            && participant.user_id !== user.id
            && participant.user_id !== doc.owner_id
        )
        .map(({ participant }) => participant.user_id);

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
