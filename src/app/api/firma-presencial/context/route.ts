import { NextRequest, NextResponse } from 'next/server';
import { appendPackageEvent, sha256 } from '@/lib/document-package/server';
import {
  expireKioskSessionIfNeeded,
  kioskCookieOptions,
  kioskParticipantMatchesUser,
  KIOSK_COOKIE_NAME,
  loadKioskSessionFromRequest,
} from '@/lib/in-person/kiosk-session.server';
import { bearerToken } from '@/lib/security/document-access';
import { consumeServerRateLimit } from '@/lib/security/server-rate-limit';
import { createAnonClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
const terminalStatuses = new Set(['completed', 'cancelled', 'expired']);

export async function GET(request: NextRequest) {
  try {
    const loaded = await loadKioskSessionFromRequest(request);
    if (!loaded.token || !loaded.session) {
      return NextResponse.json({ error: 'KIOSK_CONTEXT_NOT_FOUND' }, { status: 404, headers });
    }
    const session = await expireKioskSessionIfNeeded(loaded.service, loaded.session);
    return NextResponse.json(
      {
        success: true,
        data: {
          sessionId: session.id,
          documentId: session.document_id,
          status: session.status,
          active: session.status === 'started' && !session.revoked_at,
          terminal: terminalStatuses.has(session.status),
          expiresAt: session.expires_at,
        },
      },
      { headers }
    );
  } catch {
    return NextResponse.json({ error: 'KIOSK_CONTEXT_UNAVAILABLE' }, { status: 503, headers });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { action?: string };
    const loaded = await loadKioskSessionFromRequest(request);
    if (!loaded.token || !loaded.session) {
      return NextResponse.json({ error: 'KIOSK_CONTEXT_NOT_FOUND' }, { status: 404, headers });
    }
    const session = await expireKioskSessionIfNeeded(loaded.service, loaded.session);
    const allowed = await consumeServerRateLimit({
      scope: `in-person-session-${String(body.action || 'invalid')}`,
      identifiers: [sha256(loaded.token), request.headers.get('x-forwarded-for') || 'unknown'],
      limit: body.action === 'release_for_recovery' ? 5 : 12,
      windowSeconds: 900,
    });
    if (!allowed) {
      return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429, headers });
    }

    if (body.action === 'release_for_recovery') {
      if (!terminalStatuses.has(session.status)) {
        return NextResponse.json({ error: 'KIOSK_SESSION_NOT_TERMINAL' }, { status: 409, headers });
      }
      await appendPackageEvent({
        service: loaded.service,
        workspaceId: session.workspace_id,
        documentId: session.document_id,
        participantReferenceId: session.participant_reference_id,
        eventType: 'in_person_session.owner_recovery_requested',
        eventKey: `in-person:${session.id}:owner-recovery-requested`,
        correlationId: session.correlation_id,
        payload: { session_id: session.id },
      });
      const response = NextResponse.json({
        success: true,
        data: {
          loginPath: `/login?redirect=${encodeURIComponent(`/firma-presencial/recuperar/${session.id}`)}`,
        },
      });
      response.cookies.set(KIOSK_COOKIE_NAME, '', { ...kioskCookieOptions(), maxAge: 0 });
      return response;
    }

    if (!['complete', 'cancel'].includes(String(body.action || ''))) {
      return NextResponse.json({ error: 'KIOSK_ACTION_INVALID' }, { status: 400, headers });
    }

    const token = bearerToken(request);
    if (!token) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401, headers });
    const auth = await createAnonClient().auth.getUser(token);
    if (auth.error || !auth.data.user) {
      return NextResponse.json({ error: 'AUTH_INVALID' }, { status: 401, headers });
    }
    const identity = await kioskParticipantMatchesUser(loaded.service, session, auth.data.user);
    if (!identity.matches || !identity.participant) {
      return NextResponse.json({ error: 'KIOSK_PARTICIPANT_MISMATCH' }, { status: 403, headers });
    }

    if (body.action === 'cancel') {
      if (session.status !== 'started' || session.revoked_at) {
        return NextResponse.json(
          { error: 'KIOSK_SESSION_NOT_CANCELLABLE' },
          { status: 409, headers }
        );
      }
      const cancelledAt = new Date().toISOString();
      const update = await loaded.service
        .from('in_person_signing_sessions')
        .update({
          status: 'cancelled',
          cancelled_at: cancelledAt,
          revoked_at: cancelledAt,
          updated_at: cancelledAt,
        })
        .eq('id', session.id)
        .eq('status', 'started')
        .is('revoked_at', null)
        .select('id')
        .maybeSingle();
      if (update.error) throw update.error;
      if (!update.data) {
        return NextResponse.json(
          { error: 'KIOSK_CANCELLATION_CONFLICT' },
          { status: 409, headers }
        );
      }
      await appendPackageEvent({
        service: loaded.service,
        workspaceId: session.workspace_id,
        documentId: session.document_id,
        participantReferenceId: session.participant_reference_id,
        actorUserId: auth.data.user.id,
        eventType: 'in_person_session.cancelled',
        eventKey: `in-person:${session.id}:cancelled`,
        correlationId: session.correlation_id,
        payload: { session_id: session.id },
      });
      return NextResponse.json(
        {
          success: true,
          data: { neutralPath: `/firma-presencial/finalizada/${session.id}` },
        },
        { headers }
      );
    }

    const normalizedEmail = auth.data.user.email?.trim().toLowerCase() || '';
    const responseByUser = await loaded.service
      .from('participation_responses')
      .select('firma_completada,aprobacion_completada,firma_completada_at,aprobacion_completada_at')
      .eq('documento_id', session.document_id)
      .eq('participante_id', auth.data.user.id)
      .limit(1)
      .maybeSingle();
    if (responseByUser.error) throw responseByUser.error;
    const responseByEmail =
      responseByUser.data || !normalizedEmail
        ? null
        : await loaded.service
            .from('participation_responses')
            .select(
              'firma_completada,aprobacion_completada,firma_completada_at,aprobacion_completada_at'
            )
            .eq('documento_id', session.document_id)
            .ilike('participante_email', normalizedEmail)
            .limit(1)
            .maybeSingle();
    if (responseByEmail?.error) throw responseByEmail.error;
    const completedResponse = responseByUser.data || responseByEmail?.data;
    const participantState = completedResponse?.firma_completada
      ? 'firmado'
      : completedResponse?.aprobacion_completada
        ? 'aprobado'
        : '';
    if (!participantState) {
      return NextResponse.json({ error: 'SIGNATURE_NOT_COMPLETED' }, { status: 409, headers });
    }
    if (!terminalStatuses.has(session.status)) {
      const completedAt = new Date().toISOString();
      const update = await loaded.service
        .from('in_person_signing_sessions')
        .update({
          status: 'completed',
          completed_at: completedAt,
          revoked_at: completedAt,
          updated_at: completedAt,
        })
        .eq('id', session.id)
        .eq('status', 'started')
        .is('revoked_at', null)
        .select('id')
        .maybeSingle();
      if (update.error) throw update.error;
      if (!update.data) {
        return NextResponse.json({ error: 'KIOSK_COMPLETION_CONFLICT' }, { status: 409, headers });
      }
    } else if (session.status !== 'completed') {
      return NextResponse.json(
        { error: 'KIOSK_SESSION_NOT_COMPLETABLE' },
        { status: 409, headers }
      );
    }
    await appendPackageEvent({
      service: loaded.service,
      workspaceId: session.workspace_id,
      documentId: session.document_id,
      participantReferenceId: session.participant_reference_id,
      actorUserId: auth.data.user.id,
      eventType: 'in_person_session.completed',
      eventKey: `in-person:${session.id}:completed`,
      correlationId: session.correlation_id,
      payload: { session_id: session.id, participant_state: participantState },
    });
    return NextResponse.json(
      {
        success: true,
        data: { neutralPath: `/firma-presencial/finalizada/${session.id}` },
      },
      { headers }
    );
  } catch {
    return NextResponse.json({ error: 'KIOSK_CONTEXT_UNAVAILABLE' }, { status: 503, headers });
  }
}
