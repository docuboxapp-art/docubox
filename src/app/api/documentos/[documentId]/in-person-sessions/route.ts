import { randomBytes, randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import {
  appendPackageEvent,
  isPhaseBFeatureEnabled,
  PHASE_B_FEATURE_KEYS,
  phaseBUnavailableResponse,
  sha256,
} from '@/lib/document-package/server';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';
import {
  consumeServerRateLimit,
  ServerRateLimitUnavailableError,
} from '@/lib/security/server-rate-limit';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await context.params;
    const access = await requireDocumentAccess(request, documentId, { ownerOrAdminOnly: true });
    if (!(await isPhaseBFeatureEnabled(access.service, PHASE_B_FEATURE_KEYS.inPerson))) {
      return phaseBUnavailableResponse();
    }
    const body = (await request.json()) as { participantReferenceId?: string };
    const participantReferenceId = String(body.participantReferenceId || '');
    const allowed = await consumeServerRateLimit({
      scope: 'in-person-session-create',
      identifiers: [documentId, access.user.id],
      limit: 8,
      windowSeconds: 900,
    });
    if (!allowed)
      return Response.json(
        { error: 'Espera antes de crear otra sesión presencial.' },
        { status: 429 }
      );
    const participantResult = await access.service
      .from('document_participant_references')
      .select('id,workspace_id,active,snapshot')
      .eq('id', participantReferenceId)
      .eq('document_id', documentId)
      .eq('active', true)
      .maybeSingle();
    if (participantResult.error) throw participantResult.error;
    const participant = participantResult.data;
    const snapshot = participant?.snapshot as Record<string, unknown> | undefined;
    const state = String(snapshot?.sub_estado || snapshot?.estado || '').toLowerCase();
    if (
      !participant ||
      String(snapshot?.acto || '').toLowerCase() !== 'firmante' ||
      snapshot?.delivery_mode !== 'in_person' ||
      ['firmo', 'firmado', 'aprobo', 'aprobado', 'rechazo', 'rechazado'].includes(state)
    ) {
      return Response.json(
        { error: 'El participante no es elegible para firma presencial.' },
        { status: 409 }
      );
    }
    const rawToken = randomBytes(32).toString('base64url');
    const sessionId = randomUUID();
    const correlationId = randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const inserted = await access.service
      .from('in_person_signing_sessions')
      .insert({
        id: sessionId,
        workspace_id: participant.workspace_id,
        document_id: documentId,
        participant_reference_id: participantReferenceId,
        created_by: access.user.id,
        token_hash: sha256(rawToken),
        status: 'created',
        allowed_actions: ['view', 'requirements', 'sign'],
        correlation_id: correlationId,
        expires_at: expiresAt,
      })
      .select('id,expires_at')
      .single();
    if (inserted.error) {
      if (inserted.error.code === '23505') {
        return Response.json(
          { error: 'Ya existe una sesión presencial activa para este participante.' },
          { status: 409 }
        );
      }
      throw inserted.error;
    }
    await appendPackageEvent({
      service: access.service,
      workspaceId: participant.workspace_id,
      documentId,
      participantReferenceId,
      actorUserId: access.user.id,
      eventType: 'in_person_session.created',
      eventKey: `in-person:${sessionId}:created`,
      correlationId,
      payload: { session_id: sessionId, expires_at: expiresAt },
    });
    return Response.json(
      {
        success: true,
        data: { sessionId, token: rawToken, expiresAt, path: `/firma-presencial/${rawToken}` },
      },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof ServerRateLimitUnavailableError) {
      return Response.json(
        { error: 'La firma presencial no está disponible temporalmente.' },
        { status: 503 }
      );
    }
    const response = documentAccessResponse(error);
    return Response.json(response.body, { status: response.status });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await context.params;
    const access = await requireDocumentAccess(request, documentId, { ownerOrAdminOnly: true });
    const body = (await request.json()) as { sessionId?: string };
    const sessionId = String(body.sessionId || '');
    const cancelled = await access.service
      .from('in_person_signing_sessions')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        revoked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .eq('document_id', documentId)
      .in('status', ['created', 'started'])
      .is('revoked_at', null)
      .select('id,workspace_id,participant_reference_id,correlation_id')
      .maybeSingle();
    if (cancelled.error) throw cancelled.error;
    if (!cancelled.data)
      return Response.json({ error: 'La sesión ya no está activa.' }, { status: 409 });
    await appendPackageEvent({
      service: access.service,
      workspaceId: cancelled.data.workspace_id,
      documentId,
      participantReferenceId: cancelled.data.participant_reference_id,
      actorUserId: access.user.id,
      eventType: 'in_person_session.cancelled',
      eventKey: `in-person:${sessionId}:cancelled`,
      correlationId: cancelled.data.correlation_id,
      payload: { session_id: sessionId },
    });
    return Response.json({ success: true });
  } catch (error) {
    const response = documentAccessResponse(error);
    return Response.json(response.body, { status: response.status });
  }
}
