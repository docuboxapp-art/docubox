import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { appendPackageEvent, sha256 } from '@/lib/document-package/server';
import {
  expireKioskSessionIfNeeded,
  kioskCookieOptions,
  KIOSK_COOKIE_NAME,
  loadKioskSessionByToken,
} from '@/lib/in-person/kiosk-session.server';
import {
  consumeServerRateLimit,
  ServerRateLimitUnavailableError,
} from '@/lib/security/server-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
};

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const tokenHash = sha256(token);
    const allowed = await consumeServerRateLimit({
      scope: 'in-person-session-access',
      identifiers: [tokenHash, request.headers.get('x-forwarded-for') || 'unknown'],
      limit: 30,
      windowSeconds: 900,
    });
    if (!allowed)
      return Response.json(
        { error: 'Demasiados intentos.' },
        { status: 429, headers: privateHeaders }
      );
    const loaded = await loadKioskSessionByToken(token);
    if (!loaded.session)
      return Response.json(
        { error: 'Sesión no disponible.' },
        { status: 404, headers: privateHeaders }
      );
    const session = await expireKioskSessionIfNeeded(loaded.service, loaded.session);
    const [participantResult, documentResult] = await Promise.all([
      loaded.service
        .from('document_participant_references')
        .select('snapshot')
        .eq('id', session.participant_reference_id)
        .eq('document_id', session.document_id)
        .maybeSingle(),
      loaded.service
        .from('documentos')
        .select('nombre,estado')
        .eq('id', session.document_id)
        .maybeSingle(),
    ]);
    if (participantResult.error) throw participantResult.error;
    if (documentResult.error) throw documentResult.error;
    const snapshot = (participantResult.data?.snapshot || {}) as Record<string, unknown>;
    return Response.json(
      {
        success: true,
        data: {
          status: session.status,
          sessionId: session.id,
          expiresAt: session.expires_at,
          participantName: String(snapshot.name || snapshot.nombre || 'Participante'),
          documentName: documentResult.data?.nombre || 'Documento',
          available: !session.revoked_at && ['created', 'started'].includes(session.status),
        },
      },
      { headers: privateHeaders }
    );
  } catch (error) {
    const status = error instanceof ServerRateLimitUnavailableError ? 503 : 500;
    return Response.json(
      { error: 'No fue posible validar la sesión.' },
      { status, headers: privateHeaders }
    );
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const body = (await request.json()) as { action?: string; claim?: string };
    if (body.action !== 'start' || !body.claim || body.claim.length < 16) {
      return Response.json(
        { error: 'Solicitud no válida.' },
        { status: 400, headers: privateHeaders }
      );
    }
    const tokenHash = sha256(token);
    const allowed = await consumeServerRateLimit({
      scope: 'in-person-session-start',
      identifiers: [tokenHash, request.headers.get('x-forwarded-for') || 'unknown'],
      limit: 5,
      windowSeconds: 900,
    });
    if (!allowed)
      return Response.json(
        { error: 'Demasiados intentos.' },
        { status: 429, headers: privateHeaders }
      );
    const loaded = await loadKioskSessionByToken(token);
    if (!loaded.session)
      return Response.json(
        { error: 'Sesión no disponible.' },
        { status: 404, headers: privateHeaders }
      );
    const session = await expireKioskSessionIfNeeded(loaded.service, loaded.session);
    if (session.status !== 'created' || session.revoked_at) {
      return Response.json(
        { error: 'La sesión ya fue utilizada o venció.', code: 'SESSION_REPLAY_BLOCKED' },
        { status: 409, headers: privateHeaders }
      );
    }
    const startedAt = new Date().toISOString();
    const started = await loaded.service
      .from('in_person_signing_sessions')
      .update({
        status: 'started',
        started_at: startedAt,
        start_claim_hash: createHash('sha256').update(body.claim).digest('hex'),
        updated_at: startedAt,
      })
      .eq('id', session.id)
      .eq('status', 'created')
      .is('started_at', null)
      .is('revoked_at', null)
      .gt('expires_at', startedAt)
      .select('id')
      .maybeSingle();
    if (started.error) throw started.error;
    if (!started.data) {
      return Response.json(
        { error: 'La sesión ya fue utilizada.', code: 'SESSION_REPLAY_BLOCKED' },
        { status: 409, headers: privateHeaders }
      );
    }
    const participantResult = await loaded.service
      .from('document_participant_references')
      .select('snapshot')
      .eq('id', session.participant_reference_id)
      .eq('document_id', session.document_id)
      .single();
    if (participantResult.error) throw participantResult.error;
    const snapshot = participantResult.data.snapshot as Record<string, unknown>;
    const portalToken = String(snapshot.portal_token || '');
    if (!portalToken) {
      await loaded.service
        .from('in_person_signing_sessions')
        .update({ status: 'cancelled', cancelled_at: startedAt, revoked_at: startedAt })
        .eq('id', session.id);
      return Response.json(
        { error: 'El acceso del participante no está disponible.' },
        { status: 409, headers: privateHeaders }
      );
    }
    await appendPackageEvent({
      service: loaded.service,
      workspaceId: session.workspace_id,
      documentId: session.document_id,
      participantReferenceId: session.participant_reference_id,
      eventType: 'in_person_session.started',
      eventKey: `in-person:${session.id}:started`,
      correlationId: session.correlation_id,
      payload: { session_id: session.id, allowed_actions: session.allowed_actions },
    });
    const response = NextResponse.json(
      {
        success: true,
        data: {
          sessionId: session.id,
          portalPath: `/portal-participante/${encodeURIComponent(portalToken)}`,
        },
      },
      { headers: privateHeaders }
    );
    response.cookies.set(KIOSK_COOKIE_NAME, token, kioskCookieOptions());
    return response;
  } catch (error) {
    const status = error instanceof ServerRateLimitUnavailableError ? 503 : 500;
    return Response.json(
      { error: 'No fue posible iniciar la sesión.' },
      { status, headers: privateHeaders }
    );
  }
}
