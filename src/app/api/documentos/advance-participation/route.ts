import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import {
  isEmailNotificationEnabled,
  sendParticipantInvitationEmails,
} from '@/lib/emailNotifications';
import { createNotificationServer } from '@/lib/notificationsInApp.server';
import { getParticipantPortalUrl } from '@/lib/publicAppUrl';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';
import { appendDocumentOperationalEvent } from '@/lib/documents/operational-events';
import { isPhaseCFeatureEnabled, PHASE_C_FEATURE_KEYS } from '@/lib/orchestration/feature-flags';

const TERMINAL_SUB_ESTADOS = [
  'firmo',
  'firmado',
  'aprobo',
  'aprobado',
  'rechazo',
  'rechazado',
  'cancelo',
  'cancelado',
  'atestiguo',
  'testigo_completado',
  'superseded',
];

function isTerminal(sub: string): boolean {
  return TERMINAL_SUB_ESTADOS.includes((sub ?? '').toLowerCase());
}

function participantMatchesUser(
  participant: Record<string, unknown>,
  userId: string,
  email: string
) {
  return (
    participant.user_id === userId ||
    participant.id === userId ||
    String(participant.email || '')
      .trim()
      .toLowerCase() === email
  );
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
    const body = (await req.json()) as { documentoId?: unknown };
    const documentoId = typeof body.documentoId === 'string' ? body.documentoId : '';
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        documentoId
      )
    ) {
      return NextResponse.json({ error: 'documentoId requerido' }, { status: 400 });
    }
    const access = await requireDocumentAccess(req, documentoId);
    const { document: doc, service, user } = access;

    // Only advance if document is still active
    if (
      ['completado', 'cancelado', 'rechazado', 'vencido', 'expirado'].includes(
        String(doc.estado || '').toLowerCase()
      ) ||
      (doc.tiene_vencimiento === true &&
        doc.fecha_vencimiento &&
        new Date(doc.fecha_vencimiento).getTime() <= Date.now())
    ) {
      return NextResponse.json({ success: true, advanced: false, reason: 'document_terminal' });
    }

    const participantes: any[] = doc.participantes ?? [];
    const normalizedEmail = String(user.email || '')
      .trim()
      .toLowerCase();
    const actorParticipant = participantes.find(
      (participant: Record<string, unknown>) =>
        participantMatchesUser(participant, user.id, normalizedEmail) ||
        (access.delegatedParticipantReferenceId &&
          participant.participant_ref_id === access.delegatedParticipantReferenceId)
    );
    const actorCompleted = Boolean(
      actorParticipant &&
      isTerminal(String(actorParticipant.sub_estado || actorParticipant.estado || ''))
    );
    const actorAccessState = String(actorParticipant?.current_access || '').toLowerCase();
    const actorCanAdvance = Boolean(
      actorParticipant &&
      actorParticipant.visible !== false &&
      String(actorParticipant.visible ?? 'true').toLowerCase() !== 'false' &&
      !['false', '0', 'no', 'revoked', 'suspended', 'removed', 'hidden'].includes(
        actorAccessState
      ) &&
      actorCompleted
    );
    if (!actorCanAdvance) {
      return NextResponse.json(
        { error: 'La participación actual no permite avanzar el flujo.' },
        { status: 403 }
      );
    }
    const participationOrder: string = doc.participation_order ?? 'paralelo';
    const gruposFirma: any[] = doc.grupos_firma ?? [];
    const docNombre = doc.nombre || 'Documento';

    // Fetch sender (owner) profile
    const { data: ownerProfile } = await service
      .from('user_profiles')
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

    const delayedRoutingEnabled = await isPhaseCFeatureEnabled(
      service,
      PHASE_C_FEATURE_KEYS.delayedRouting
    );
    const routingPlans = nextParticipants.map((participant) => ({
      participant,
      schedule: delayedRoutingEnabled ? buildRoutingSchedule(participant) : null,
    }));
    const immediateParticipants = routingPlans
      .filter((plan) => !plan.schedule)
      .map((plan) => plan.participant);
    const delayedParticipants = routingPlans.filter((plan) => plan.schedule);

    // Make the next turn visible. Delivery is confirmed after each channel responds.
    const nextIds = immediateParticipants.map((p: any) => p.id).filter(Boolean);
    const nextEmails = immediateParticipants.map((p: any) => p.email).filter(Boolean);

    const updatedParticipantes = participantes.map((p: any) => {
      const isNext = nextIds.includes(p.id) || nextEmails.includes(p.email);
      if (isNext) {
        return { ...p, visible: true };
      }
      return p;
    });

    const claimed = await service
      .from('documentos')
      .update({ participantes: updatedParticipantes })
      .eq('id', documentoId)
      .eq('participantes', participantes)
      .select('id')
      .maybeSingle();
    if (claimed.error) throw claimed.error;
    if (!claimed.data) {
      return NextResponse.json({ success: true, advanced: false, reason: 'duplicate_or_stale' });
    }

    const correlationId = req.headers.get('x-request-id') || randomUUID();
    const nextParticipantKeys = nextParticipants
      .map((participant: any) =>
        String(
          participant.participant_ref_id ||
            participant.id ||
            participant.user_id ||
            participant.email ||
            ''
        )
      )
      .sort();
    const transitionHash = createHash('sha256').update(nextParticipantKeys.join('|')).digest('hex');
    const advanceEvent = await appendDocumentOperationalEvent(service, {
      documentId: documentoId,
      workspaceId: doc.workspace_id || null,
      actorUserId: user.id,
      eventType: 'workflow.participation_advanced',
      eventKey: `advance:${transitionHash}`,
      correlationId,
      payload: {
        participation_order: participationOrder,
        participant_count: nextParticipants.length,
        immediate_count: immediateParticipants.length,
        scheduled_count: delayedParticipants.length,
      },
    });

    for (const plan of delayedParticipants) {
      const participant = plan.participant as Record<string, unknown>;
      const schedule = plan.schedule!;
      const participantReferenceId = String(participant.participant_ref_id || '');
      if (!participantReferenceId) continue;
      const inserted = await service.from('document_routing_schedules').insert({
        workspace_id: doc.workspace_id,
        document_id: documentoId,
        participant_reference_id: participantReferenceId,
        participant_json_id: String(participant.id || ''),
        source_event_id: advanceEvent.id,
        routing_mode: schedule.mode,
        activate_at: schedule.activateAt,
        wait_event_type: schedule.waitEventType,
        timezone: schedule.timezone,
        status: schedule.status,
        idempotency_key: `routing:${advanceEvent.id || transitionHash}:${participantReferenceId}`,
      });
      if (inserted.error?.code !== '23505' && inserted.error) throw inserted.error;
    }

    // Send in-app notifications to next participants who have a user_id
    for (const p of immediateParticipants) {
      if (p.isCurrentUser) continue;
      const participantUserId = p.user_id;
      if (participantUserId) {
        const signingUrl = getParticipantPortalUrl(p.portal_token || documentoId);
        createNotificationServer({
          userId: participantUserId,
          type: 'document',
          eventType: 'workflow.step_available',
          category: 'WORKFLOW',
          severity: 'warning',
          workspaceId: doc.workspace_id,
          actorUserId: user.id,
          entityType: 'document',
          entityId: documentoId,
          actionUrl: signingUrl,
          actionLabel: 'Revisar y participar',
          deduplicationKey: `workflow.step_available:${documentoId}:${p.id || participantUserId}`,
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

    // Send email notifications only to participants who selected email.
    const emailParticipants = immediateParticipants.filter((p: any) => {
      if (!p.email || p.isCurrentUser) return false;
      if (!p.email.includes('@')) return false;
      return isEmailNotificationEnabled(p.tipoNotificacion);
    });

    const deliveredEmails = new Map<string, string | undefined>();
    const failedEmails = new Set<string>();
    if (emailParticipants.length > 0) {
      const participantsWithPortalUrl = emailParticipants.map((p: any) => ({
        ...p,
        documentUrl: getParticipantPortalUrl(p.portal_token || documentoId),
      }));

      const delivery = await sendParticipantInvitationEmails({
        participants: participantsWithPortalUrl,
        documentId: documentoId,
        documentName: docNombre,
        senderName,
        documentUrl: getParticipantPortalUrl(documentoId),
      });

      delivery.sent.forEach((item) => {
        deliveredEmails.set(item.email.trim().toLowerCase(), item.providerMessageId);
      });
      delivery.failed.forEach((item) => {
        failedEmails.add(item.email.trim().toLowerCase());
      });
    }

    if (deliveredEmails.size > 0) {
      const deliveredAt = new Date().toISOString();
      const participantsWithDelivery = updatedParticipantes.map((participant: any) => {
        const email = String(participant.email || '')
          .trim()
          .toLowerCase();
        if (!deliveredEmails.has(email)) return participant;
        return {
          ...participant,
          notificado: true,
          fecha_notificacion: deliveredAt,
        };
      });
      const deliveryUpdate = await service
        .from('documentos')
        .update({ participantes: participantsWithDelivery })
        .eq('id', documentoId)
        .eq('participantes', updatedParticipantes)
        .select('id')
        .maybeSingle();
      if (deliveryUpdate.error) throw deliveryUpdate.error;
    }

    // Log audit trail
    try {
      await service.from('audit_trail').insert(
        emailParticipants.map((p: any) => {
          const normalizedEmail = String(p.email || '')
            .trim()
            .toLowerCase();
          const accepted = deliveredEmails.has(normalizedEmail);
          return {
            documento_id: documentoId,
            actor_id: user.id,
            action: accepted ? 'invitacion_enviada' : 'invitacion_fallida',
            category: 'notificacion',
            details: {
              participant_email: p.email,
              participant_name: p.name,
              participation_order: participationOrder,
              channel: 'email',
              delivery_status: accepted ? 'accepted' : 'failed',
              provider_message_id: deliveredEmails.get(normalizedEmail) || null,
            },
          };
        })
      );
    } catch {
      /* non-critical */
    }

    return NextResponse.json({
      success: true,
      advanced: true,
      notifiedCount: immediateParticipants.length,
      scheduledCount: delayedParticipants.length,
      notifiedEmails: Array.from(deliveredEmails.keys()),
      failedEmails: Array.from(failedEmails),
    });
  } catch (cause: unknown) {
    const accessFailure = documentAccessResponse(cause);
    if (accessFailure.status !== 500) {
      return NextResponse.json(accessFailure.body, { status: accessFailure.status });
    }
    console.error('[advance-participation] Error:', cause);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

function buildRoutingSchedule(participant: Record<string, unknown>) {
  const mode = String(participant.routing_mode || 'immediate');
  if (mode === 'immediate' || !participant.participant_ref_id || !participant.id) return null;
  if (mode === 'delay') {
    const amount = Math.min(Math.max(Number(participant.routing_delay_amount || 0), 1), 10080);
    const unit = String(participant.routing_delay_unit || 'hours');
    const multiplier = unit === 'minutes' ? 60_000 : unit === 'days' ? 86_400_000 : 3_600_000;
    return {
      mode: 'delay',
      activateAt: new Date(Date.now() + amount * multiplier).toISOString(),
      waitEventType: null,
      timezone: null,
      status: 'scheduled',
    };
  }
  if (mode === 'date_time') {
    const activateAt =
      typeof participant.routing_activate_at === 'string' ? participant.routing_activate_at : '';
    if (!activateAt || new Date(activateAt).getTime() <= Date.now()) return null;
    return {
      mode: 'date_time',
      activateAt,
      waitEventType: null,
      timezone:
        typeof participant.routing_timezone === 'string' ? participant.routing_timezone : null,
      status: 'scheduled',
    };
  }
  if (mode === 'after_event') {
    const event = String(participant.routing_after_event || '');
    if (!['document.completed', 'workflow.participation_advanced'].includes(event)) return null;
    return {
      mode: 'after_event',
      activateAt: null,
      waitEventType: event,
      timezone: null,
      status: 'waiting_event',
    };
  }
  return null;
}

// ─── Helper: determine next participants based on participation order ──────────

function getNextParticipantsToNotify(
  participantes: any[],
  participationOrder: string,
  gruposFirma: any[]
): any[] {
  const nonOwner = participantes.filter((p: any) => !p.isCurrentUser);
  const pendingHidden = (participant: any) =>
    participant.visible !== true && !isTerminal(participant.sub_estado ?? participant.estado ?? '');

  // PARALELO: all non-terminal, non-owner participants
  if (participationOrder === 'paralelo' || !participationOrder) {
    return nonOwner.filter(pendingHidden);
  }

  // SECUENCIAL: first non-terminal participant in order
  if (participationOrder === 'secuencial') {
    const next = nonOwner.find(pendingHidden);
    return next ? [next] : [];
  }

  // MIXTO: process groups in order
  if (participationOrder === 'mixto' && gruposFirma.length > 0) {
    for (const grupo of gruposFirma) {
      const grupoTipo: string = grupo.tipo ?? 'paralelo';
      const grupoParticipantIds: string[] = grupo.participantIds ?? [];

      // Get participants in this group
      const grupoParticipantes = participantes.filter(
        (p: any) => grupoParticipantIds.includes(p.id) && !p.isCurrentUser
      );

      // Check if this group is fully completed
      const completionPolicy = String(grupo.completionPolicy || 'ALL').toUpperCase();
      const groupCompleted =
        grupoParticipantes.length > 0 &&
        (completionPolicy === 'ANY_ONE'
          ? grupoParticipantes.some((p: any) => isTerminal(p.sub_estado ?? p.estado ?? ''))
          : grupoParticipantes.every((p: any) => isTerminal(p.sub_estado ?? p.estado ?? '')));
      if (groupCompleted) {
        continue; // This group is done, move to next
      }

      // This is the active group
      if (grupoTipo === 'paralelo') {
        // All non-terminal participants in this group
        return grupoParticipantes.filter(pendingHidden);
      } else if (grupoTipo === 'secuencial') {
        // First non-terminal participant in this group (in order)
        const orderedGroup = grupoParticipantIds
          .map((id: string) => participantes.find((p: any) => p.id === id))
          .filter(Boolean);
        const next = orderedGroup.find((p: any) => pendingHidden(p) && !p.isCurrentUser);
        return next ? [next] : [];
      }

      break;
    }
    return [];
  }

  // Fallback
  return nonOwner.filter(pendingHidden);
}
