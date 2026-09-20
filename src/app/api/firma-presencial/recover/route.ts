import { NextRequest, NextResponse } from 'next/server';
import { appendPackageEvent } from '@/lib/document-package/server';
import { bearerToken } from '@/lib/security/document-access';
import { consumeServerRateLimit } from '@/lib/security/server-rate-limit';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const terminalStatuses = ['completed', 'cancelled', 'expired'];

export async function POST(request: NextRequest) {
  try {
    const token = bearerToken(request);
    if (!token) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
    const auth = await createAnonClient().auth.getUser(token);
    if (auth.error || !auth.data.user) {
      return NextResponse.json({ error: 'AUTH_INVALID' }, { status: 401 });
    }
    const body = (await request.json()) as { sessionId?: string };
    const sessionId = String(body.sessionId || '');
    const allowed = await consumeServerRateLimit({
      scope: 'in-person-owner-recovery',
      identifiers: [
        auth.data.user.id,
        sessionId || 'missing',
        request.headers.get('x-forwarded-for') || 'unknown',
      ],
      limit: 5,
      windowSeconds: 900,
    });
    if (!allowed) {
      return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
    }
    const service = createServiceClient();
    const result = await service
      .from('in_person_signing_sessions')
      .select(
        'id,workspace_id,document_id,participant_reference_id,created_by,status,correlation_id'
      )
      .eq('id', sessionId)
      .eq('created_by', auth.data.user.id)
      .in('status', terminalStatuses)
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) {
      return NextResponse.json({ error: 'OWNER_RECOVERY_DENIED' }, { status: 403 });
    }
    await appendPackageEvent({
      service,
      workspaceId: result.data.workspace_id,
      documentId: result.data.document_id,
      participantReferenceId: result.data.participant_reference_id,
      actorUserId: auth.data.user.id,
      eventType: 'in_person_session.owner_context_restored',
      eventKey: `in-person:${sessionId}:owner-context-restored`,
      correlationId: result.data.correlation_id,
      payload: { session_id: sessionId },
    });
    return NextResponse.json({
      success: true,
      data: { returnPath: `/visor-documento/${result.data.document_id}` },
    });
  } catch {
    return NextResponse.json({ error: 'OWNER_RECOVERY_UNAVAILABLE' }, { status: 503 });
  }
}
