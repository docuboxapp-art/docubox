import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { consumeServerRateLimit } from '@/lib/security/server-rate-limit';
import {
  caseIdentity,
  caseSnapshot,
  CaseRuntimeError,
  isUuid,
  record,
  rows,
  runtimeFailure,
  runtimeHeaders,
  refreshCaseControl,
} from '@/lib/case-files/runtime.server';
export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await caseIdentity(request),
      { id } = await context.params,
      raw = await request.text();
    if (!isUuid(id) || raw.length > 2000)
      throw new CaseRuntimeError('CASE_INPUT_INVALID', 'Solicitud inválida.', 422);
    const body = record(JSON.parse(raw)),
      service = createServiceClient(),
      snapshot = await caseSnapshot(service, id, actor.id);
    if (['sealed', 'cancelled'].includes(String(snapshot.case.status)))
      throw new CaseRuntimeError('CASE_TERMINAL', 'El expediente está cerrado.');
    const check = rows(snapshot.checks).find(
      (row) => row.template_verification_id === body.itemId && row.method === 'email_otp'
    );
    if (!check)
      throw new CaseRuntimeError('CASE_VERIFICATION_INVALID', 'Verificación no disponible.', 422);
    const allowed = await consumeServerRateLimit({
      scope: `case-email-${body.action}`,
      identifiers: [id, actor.id],
      limit: body.action === 'send' ? 3 : 10,
      windowSeconds: 600,
    });
    if (!allowed)
      return NextResponse.json(
        { error: 'Espera antes de volver a solicitar o comprobar el código.' },
        { status: 429 }
      );
    if (body.action === 'send') {
      if (!process.env.RESEND_API_KEY)
        throw new CaseRuntimeError(
          'CASE_EMAIL_UNAVAILABLE',
          'El envío de códigos no está disponible.',
          503
        );
      const subject = await service
        .from('case_file_participants')
        .select('email,user_id')
        .eq('id', snapshot.case.runtime_subject_id)
        .eq('case_file_id', id)
        .single();
      if (subject.error) throw subject.error;
      let email = subject.data.email;
      if (!email && subject.data.user_id) {
        const account = await service.auth.admin.getUserById(subject.data.user_id);
        if (account.error) throw account.error;
        email = account.data.user?.email;
      }
      if (!email)
        throw new CaseRuntimeError(
          'CASE_EMAIL_REQUIRED',
          'El participante no tiene correo disponible.',
          422
        );
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0'),
        salt = randomBytes(24).toString('hex');
      const pending = await service
        .from('case_file_invitations')
        .update({ revoked_at: new Date().toISOString() })
        .eq('case_file_id', id)
        .eq('verification_id', body.itemId)
        .is('otp_verified_at', null)
        .is('revoked_at', null);
      if (pending.error) throw pending.error;
      const inserted = await service
        .from('case_file_invitations')
        .insert({
          workspace_id: snapshot.case.workspace_id,
          case_file_id: id,
          participant_id: snapshot.case.runtime_subject_id,
          verification_id: body.itemId,
          recipient: email,
          created_by: actor.id,
          token_hash: `${salt}:${scryptSync(code, salt, 32).toString('hex')}`,
          expires_at: new Date(Date.now() + 600_000).toISOString(),
        })
        .select('id')
        .single();
      if (inserted.error) throw inserted.error;
      const sent = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': inserted.data.id,
        },
        body: JSON.stringify({
          from: process.env.FROM_EMAIL || 'Docubox <noreply@docubox.com.mx>',
          to: [email],
          subject: 'Verificación de correo del expediente',
          text: `Tu código para verificar el correo en este expediente es ${code}. Vence en 10 minutos. Este código no firma documentos ni autoriza el cierre.`,
        }),
        signal: AbortSignal.timeout(8000),
      });
      const saved = await service
        .from('case_file_invitations')
        .update({ delivery_status: sent.ok ? 'sent' : 'failed' })
        .eq('id', inserted.data.id);
      if (saved.error) throw saved.error;
      if (!sent.ok)
        throw new CaseRuntimeError(
          'CASE_EMAIL_UNAVAILABLE',
          'No se pudo entregar el código. Inténtalo más tarde.',
          503
        );
      return NextResponse.json(
        { data: { challengeId: inserted.data.id } },
        { headers: runtimeHeaders }
      );
    }
    if (
      body.action !== 'verify' ||
      !isUuid(body.challengeId) ||
      !/^\d{6}$/.test(String(body.code || ''))
    )
      throw new CaseRuntimeError('CASE_INPUT_INVALID', 'Escribe el código de seis dígitos.', 422);
    const challenge = await service
      .from('case_file_invitations')
      .select('token_hash')
      .eq('id', body.challengeId)
      .eq('case_file_id', id)
      .eq('verification_id', body.itemId)
      .eq('participant_id', snapshot.case.runtime_subject_id)
      .maybeSingle();
    if (challenge.error) throw challenge.error;
    const [salt, digest] = String(challenge.data?.token_hash || '').split(':');
    const valid = Boolean(
      salt &&
      /^[a-f0-9]{64}$/.test(digest || '') &&
      timingSafeEqual(scryptSync(String(body.code), salt, 32), Buffer.from(digest, 'hex'))
    );
    const result = await service.rpc('case_control_otp', {
      p_case: id,
      p_actor: actor.id,
      p_challenge: body.challengeId,
      p_valid: valid,
    });
    if (result.error) throw result.error;
    if (result.data === true) await refreshCaseControl(service, id, actor.id);
    return NextResponse.json(
      { data: { verified: result.data === true } },
      { headers: runtimeHeaders }
    );
  } catch (error) {
    const failure = runtimeFailure(error);
    return NextResponse.json(failure.body, { status: failure.status, headers: runtimeHeaders });
  }
}
