import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  caseIdentity,
  CaseRuntimeError,
  isUuid,
  record,
  runtimeFailure,
  runtimeHeaders,
  textValue,
} from '@/lib/case-files/runtime.server';
import { launchEmailPattern, normalizeLaunchParticipants } from '@/lib/case-files/launch';
import {
  caseInvitationConfig,
  caseInvitationOrigin,
  sendCaseInvitations,
  configureCaseInvitationDispatch,
} from '@/lib/case-files/invitations.server';
import { consumeServerRateLimit } from '@/lib/security/server-rate-limit';
import {
  defaultCaseLaunchSettings,
  normalizeCaseLaunchSettings,
} from '@/lib/case-files/launch-settings';
import {
  caseLaunchCredential,
  casePublicLaunchAccess,
} from '@/lib/case-files/launch-access.server';

export const runtime = 'nodejs';
export const maxDuration = 120;
export async function POST(request: NextRequest) {
  try {
    const actor = await caseIdentity(request);
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > 65536)
      throw new CaseRuntimeError(
        'CASE_INPUT_INVALID',
        'La selección excede el tamaño permitido.',
        413
      );
    const body = record(JSON.parse(raw));
    let settings;
    try {
      settings = normalizeCaseLaunchSettings(body.settings || defaultCaseLaunchSettings);
    } catch (cause) {
      throw new CaseRuntimeError(
        'CASE_LAUNCH_SETTINGS_INVALID',
        cause instanceof Error ? cause.message : 'Revisa la configuración del lanzamiento.',
        422
      );
    }
    if (settings.accessMode === 'public') {
      body.subjectName = 'Participante invitado';
      body.subjectUserId = null;
    }
    if (
      !isUuid(body.templateId) ||
      !isUuid(body.operationKey) ||
      !textValue(body.subjectName).trim() ||
      textValue(body.subjectName).trim().length > 240 ||
      !textValue(body.title).trim() ||
      textValue(body.title).trim().length > 240
    )
      return NextResponse.json(
        { error: 'Selecciona el tipo e indica la persona o empresa del expediente.' },
        { status: 422 }
      );
    if (body.subjectUserId && !isUuid(body.subjectUserId))
      return NextResponse.json({ error: 'Persona de cuenta inválida.' }, { status: 422 });
    const email = textValue(body.subjectEmail).trim().toLowerCase();
    if (
      email.length > 254 ||
      (!body.subjectUserId && !launchEmailPattern.test(email)) ||
      (email && !launchEmailPattern.test(email))
    )
      throw new CaseRuntimeError(
        'CASE_PARTICIPANT_INVALID',
        'Indica un correo válido para el titular.',
        422
      );
    let participants;
    try {
      participants = normalizeLaunchParticipants(body.participants ?? [], {
        name: textValue(body.subjectName),
        email,
        userId: textValue(body.subjectUserId),
      });
    } catch (cause) {
      throw new CaseRuntimeError(
        'CASE_PARTICIPANT_INVALID',
        cause instanceof Error ? cause.message : 'Revisa los participantes.',
        422
      );
    }
    const config = caseInvitationConfig(),
      service = createServiceClient();
    if (
      !(await consumeServerRateLimit({
        scope: 'case-launch-invitation',
        identifiers: [actor.id],
        limit: 10,
        windowSeconds: 600,
      }))
    )
      throw new CaseRuntimeError(
        'CASE_EMAIL_RATE_LIMIT',
        'Espera antes de lanzar más expedientes con invitaciones.',
        429
      );
    await configureCaseInvitationDispatch(service);
    const result = await service.rpc('case_launch_configured', {
      p_template: body.templateId,
      p_actor: actor.id,
      p_title: textValue(body.title).trim().slice(0, 240),
      p_subject_name: textValue(body.subjectName).trim().slice(0, 240),
      p_subject_user: body.subjectUserId || null,
      p_subject_email: email,
      p_participants: participants.map(({ name, email: participantEmail, userId, role }) => ({
        name,
        email: participantEmail,
        userId: userId || null,
        role,
      })),
      p_assignments: record(body.assignments),
      p_operation: body.operationKey,
      p_deliveries: Array.from({ length: participants.length + 1 }, () =>
        caseLaunchCredential(config.secret)
      ),
      p_origin: caseInvitationOrigin(request),
      p_settings: settings,
    });
    if (result.error) throw result.error;
    const id = textValue(record(result.data).id);
    if (!isUuid(id))
      throw new CaseRuntimeError(
        'CASE_OPERATION_FAILED',
        'No se pudo confirmar el lanzamiento.',
        503
      );
    // The configured-launch fingerprint includes urgency, so retries cannot change it.
    // Persist the priority before dispatching invitations (also on a recovered retry).
    if (settings.urgent !== undefined) {
      const priority = await service
        .from('case_files')
        .update({ priority: settings.urgent ? 'urgent' : 'normal' })
        .eq('id', id)
        .eq('created_by', actor.id)
        .select('id')
        .single();
      if (priority.error || !priority.data)
        throw new CaseRuntimeError(
          'CASE_OPERATION_FAILED',
          'No se pudo guardar la prioridad. Reintenta el lanzamiento.',
          503
        );
    }
    // The case and outbox are already durable. A partial send must never masquerade as failed creation.
    if (settings.scheduledAt)
      return NextResponse.json(
        { data: { id, delivery: null, scheduledAt: settings.scheduledAt } },
        { headers: runtimeHeaders }
      );
    try {
      const delivery = await sendCaseInvitations(service, id, actor.id);
      const access =
        settings.accessMode === 'public'
          ? await casePublicLaunchAccess(service, id, actor.id, config.secret)
          : null;
      return NextResponse.json(
        { data: { id, delivery, ...(access ? { access } : {}) } },
        { headers: runtimeHeaders }
      );
    } catch {
      return NextResponse.json(
        { data: { id, delivery: null, deliveryPending: true } },
        { headers: runtimeHeaders }
      );
    }
  } catch (error) {
    const failure = runtimeFailure(error);
    return NextResponse.json(failure.body, { status: failure.status, headers: runtimeHeaders });
  }
}
