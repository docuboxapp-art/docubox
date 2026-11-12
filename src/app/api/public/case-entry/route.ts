import { NextRequest, NextResponse } from 'next/server';
import {
  caseEntryContext,
  caseEntryCookie,
  caseEntryAccessCookie,
  caseEntryCode,
  casePublicEntryIdentity,
  caseEntryIdentity,
  getCaseEntryState,
  invitationHash,
  signCaseEntryCode,
} from '@/lib/case-files/entry.server';
import {
  hashPublicCode,
  isValidPublicCode,
  matchesPublicCode,
  normalizePublicCode,
} from '@/lib/forms/public-access-code';
import {
  CaseRuntimeError,
  record,
  runtimeFailure,
  runtimeHeaders,
} from '@/lib/case-files/runtime.server';
import { consumeServerRateLimit } from '@/lib/security/server-rate-limit';
import { hashCapabilityToken } from '@/lib/security/capability-token';
import { captureEncryptionKey } from '@/lib/identity/capture-crypto';
import { findStoredIdentity } from '@/lib/identity/stored-identity';
import { randomBytes } from 'node:crypto';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(
      { data: await getCaseEntryState(invitationHash(request), request) },
      { headers: runtimeHeaders }
    );
  } catch (cause) {
    const f = runtimeFailure(cause);
    return NextResponse.json(f.body, { status: f.status, headers: runtimeHeaders });
  }
}
export async function POST(request: NextRequest) {
  try {
    const hash = invitationHash(request);
    if (request.headers.get('origin') && request.headers.get('origin') !== request.nextUrl.origin)
      throw new CaseRuntimeError('CASE_PORTAL_ORIGIN', 'Solicitud no permitida.', 403);
    if (Number(request.headers.get('content-length')) > 3000)
      throw new CaseRuntimeError('CASE_INPUT_INVALID', 'Solicitud inválida.', 413);
    const raw = await request.text();
    if (raw.length > 3000)
      throw new CaseRuntimeError('CASE_INPUT_INVALID', 'Solicitud inválida.', 413);
    const body = record(JSON.parse(raw));
    if (
      !(await consumeServerRateLimit({
        scope: body.action === 'code' ? 'case-entry-code' : 'case-entry',
        identifiers: [hash],
        limit: body.action === 'code' ? 8 : 30,
        windowSeconds: 600,
      }))
    )
      throw new CaseRuntimeError('CASE_PORTAL_RATE', 'Espera antes de volver a intentarlo.', 429);
    const { service, ctx, config } = await caseEntryContext(hash);
    if (body.action === 'code') {
      const code = normalizePublicCode(body.code),
        email = String(body.email || '')
          .trim()
          .toLowerCase();
      const saved = await service
        .from('case_invitation_codes')
        .select('code_hash')
        .eq('invitation_id', ctx.invitation.id)
        .maybeSingle();
      if (saved.error) throw saved.error;
      if (
        config?.access_mode !== 'public' ||
        email !== ctx.invitation.recipient.toLowerCase() ||
        !isValidPublicCode(code) ||
        !saved.data ||
        !matchesPublicCode(code, saved.data.code_hash)
      )
        throw new CaseRuntimeError(
          'CASE_PORTAL_CODE_INVALID',
          'El código no corresponde a esta invitación.',
          403
        );
      const expires = Math.min(Date.now() + 1800000, Date.parse(ctx.invitation.expires_at));
      const response = NextResponse.json({ data: { valid: true } }, { headers: runtimeHeaders });
      response.cookies.set(
        caseEntryCookie(hash),
        signCaseEntryCode(hash, hashPublicCode(code), expires),
        {
          httpOnly: true,
          secure: request.nextUrl.protocol === 'https:',
          sameSite: 'lax',
          path: '/',
          maxAge: Math.floor((expires - Date.now()) / 1000),
        }
      );
      return response;
    }
    if (body.action === 'enter' || body.action === 'complete') {
      const capture = body.action === 'complete' ? String(body.mobileSessionToken || '') : null;
      if (capture && !/^[a-f0-9]{64}$/i.test(capture))
        throw new CaseRuntimeError('CASE_INPUT_INVALID', 'Sesión de captura inválida.', 422);
      const state = await getCaseEntryState(
        hash,
        request,
        capture ? hashCapabilityToken(capture) : undefined
      );
      const response = NextResponse.json({ data: state }, { headers: runtimeHeaders });
      if (capture && state.ready && state.mode === 'public') {
        const code = await caseEntryCode(hash, request);
        if (!code)
          throw new CaseRuntimeError('CASE_PORTAL_CODE_INVALID', 'Comprueba el código.', 403);
        const expires = Math.min(Date.now() + 1800000, Date.parse(ctx.invitation.expires_at));
        response.cookies.set(
          caseEntryAccessCookie(hash),
          signCaseEntryCode(`authorized:${hash}`, code, expires),
          {
            httpOnly: true,
            secure: request.nextUrl.protocol === 'https:',
            sameSite: 'lax',
            path: '/',
            maxAge: Math.floor((expires - Date.now()) / 1000),
          }
        );
      }
      return response;
    }
    if (body.action === 'mobile') {
      const entry = await getCaseEntryState(hash, request);
      if (entry.needsLogin || entry.needsCode || !entry.needsLiveness)
        throw new CaseRuntimeError(
          'CASE_PORTAL_SCOPE',
          'Comprueba primero tu acceso al expediente.',
          403
        );
      const actor =
        config?.access_mode === 'public' && (await caseEntryCode(hash, request))
          ? await casePublicEntryIdentity(service, ctx.invitation.recipient)
          : await caseEntryIdentity(request);
      if (!actor) throw new CaseRuntimeError('CASE_PORTAL_ACCOUNT_REQUIRED', 'Inicia sesión.', 401);
      const key = captureEncryptionKey();
      if (!key)
        throw new CaseRuntimeError(
          'CASE_BIOMETRIC_UNAVAILABLE',
          'El servicio biométrico no está disponible.',
          503
        );
      const stored = await findStoredIdentity(service, actor.id, key),
        token = randomBytes(32).toString('hex'),
        expiresAt = new Date(Date.now() + 600000).toISOString();
      const r = await service
        .from('mobile_upload_sessions')
        .insert({
          token,
          user_id: actor.id,
          status: 'pending',
          expires_at: expiresAt,
          metadata: {
            mode: 'case_portal_liveness',
            case_invitation_id: ctx.invitation.id,
            user_id: actor.id,
            has_enrollment: !!stored?.front,
          },
        })
        .select('id')
        .single();
      if (r.error) throw r.error;
      return NextResponse.json(
        { token, expiresAt, sessionId: r.data.id, hasStoredId: !!stored?.front },
        { headers: runtimeHeaders }
      );
    }
    throw new CaseRuntimeError('CASE_INPUT_INVALID', 'Acción inválida.', 422);
  } catch (cause) {
    const f = runtimeFailure(cause);
    return NextResponse.json(f.body, { status: f.status, headers: runtimeHeaders });
  }
}
