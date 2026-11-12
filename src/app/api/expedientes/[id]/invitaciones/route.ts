import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  caseIdentity,
  CaseRuntimeError,
  isUuid,
  record,
  runtimeFailure,
  runtimeHeaders,
} from '@/lib/case-files/runtime.server';
import {
  caseInvitationConfig,
  caseInvitationSummary,
  sendCaseInvitations,
} from '@/lib/case-files/invitations.server';
import { caseLaunchCredential } from '@/lib/case-files/launch-access.server';
import { consumeServerRateLimit } from '@/lib/security/server-rate-limit';
export const runtime = 'nodejs';
export const maxDuration = 120;
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  try {
    const actor = await caseIdentity(request),
      { id } = await context.params;
    if (!isUuid(id)) throw new CaseRuntimeError('CASE_INPUT_INVALID', 'Expediente inválido.', 422);
    return NextResponse.json(
      { data: await caseInvitationSummary(createServiceClient(), id, actor.id) },
      { headers: runtimeHeaders }
    );
  } catch (error) {
    const failure = runtimeFailure(error);
    return NextResponse.json(failure.body, { status: failure.status, headers: runtimeHeaders });
  }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    const actor = await caseIdentity(request),
      { id } = await context.params,
      raw = await request.text();
    if (!isUuid(id) || raw.length > 1500)
      throw new CaseRuntimeError('CASE_INPUT_INVALID', 'Solicitud inválida.', 422);
    const body = record(JSON.parse(raw)),
      service = createServiceClient();
    await caseInvitationSummary(service, id, actor.id);
    if (
      !(await consumeServerRateLimit({
        scope: 'case-invitation-delivery',
        identifiers: [id, actor.id],
        limit: 6,
        windowSeconds: 600,
      }))
    )
      throw new CaseRuntimeError(
        'CASE_EMAIL_RATE_LIMIT',
        'Espera antes de volver a enviar invitaciones.',
        429
      );
    if (body.action === 'revoke' || body.action === 'renew') {
      if (!isUuid(body.invitationId) || !isUuid(body.operationKey))
        throw new CaseRuntimeError('CASE_INPUT_INVALID', 'Selecciona una invitación válida.', 422);
      const credential =
        body.action === 'renew' ? caseLaunchCredential(caseInvitationConfig().secret) : {};
      const result = await service.rpc('case_invitation_manage', {
        p_case: id,
        p_actor: actor.id,
        p_id: body.invitationId,
        p_action: body.action,
        p_operation: body.operationKey,
        p_credential: credential,
      });
      if (result.error) throw result.error;
      if (body.action === 'revoke')
        return NextResponse.json(
          { data: await caseInvitationSummary(service, id, actor.id) },
          { headers: runtimeHeaders }
        );
    } else if (body.action !== 'retry')
      throw new CaseRuntimeError('CASE_INPUT_INVALID', 'Acción no disponible.', 422);
    return NextResponse.json(
      { data: await sendCaseInvitations(service, id, actor.id) },
      { headers: runtimeHeaders }
    );
  } catch (error) {
    const failure = runtimeFailure(error);
    return NextResponse.json(failure.body, { status: failure.status, headers: runtimeHeaders });
  }
}
