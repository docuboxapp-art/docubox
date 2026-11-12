import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';
import { CaseRuntimeError } from './runtime.server';
import { hashInvitationToken } from './invitations';
import { signEntryGrant, verifyEntryGrant } from './entry-cookie';
import { isDefinitivelyInvalidAuthToken } from '@/lib/supabase/auth-verification';

export const caseEntryCookie = (hash: string) => `case_entry_${hash.slice(0, 20)}`;
export const caseEntryAccessCookie = (hash: string) => `case_access_${hash.slice(0, 20)}`;
export function signCaseEntryCode(hash: string, codeHash: string, expires: number) {
  return signEntryGrant(process.env.SUPABASE_SERVICE_ROLE_KEY!, hash, codeHash, expires);
}
export function verifyCaseEntryCode(hash: string, value: string, now = Date.now()) {
  return verifyEntryGrant(process.env.SUPABASE_SERVICE_ROLE_KEY!, hash, value, now);
}
export async function caseEntryCode(hash: string, request?: NextRequest) {
  const jar = await cookies();
  return verifyCaseEntryCode(
    hash,
    request?.cookies.get(caseEntryCookie(hash))?.value ||
      jar.get(caseEntryCookie(hash))?.value ||
      ''
  );
}
/** Public code holders prove identity biometrically, without creating a full account session. */
export async function casePublicEntryIdentity(service: SupabaseClient, email: string) {
  const profile = await service
    .from('user_profiles')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  if (profile.error) throw profile.error;
  if (!profile.data) return null;
  const result = await service.auth.admin.getUserById(profile.data.id);
  if (result.error) throw result.error;
  const user = result.data.user;
  return user?.email_confirmed_at &&
    !user.is_anonymous &&
    user.email?.toLowerCase() === email.toLowerCase()
    ? user
    : null;
}
export async function caseEntryIdentity(request?: NextRequest) {
  const bearer = request?.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  const jar = await cookies();
  const client = bearer
    ? createAnonClient(bearer)
    : createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll: () => jar.getAll(),
            setAll: (values) => {
              try {
                values.forEach((value) => jar.set(value.name, value.value, value.options));
              } catch {
                /* Server Components read cookies; middleware persists refreshes. */
              }
            },
          },
        }
      );
  const result = await client.auth.getUser(bearer);
  if (
    result.error &&
    result.error.name !== 'AuthSessionMissingError' &&
    !isDefinitivelyInvalidAuthToken(result.error)
  )
    throw new CaseRuntimeError(
      'CASE_AUTH_UNAVAILABLE',
      'No se pudo comprobar la sesión. Vuelve a intentarlo en unos momentos.',
      503
    );
  const user = result.data.user;
  return !result.error && user?.email_confirmed_at && !user.is_anonymous ? user : null;
}
export async function caseEntryContext(hash: string) {
  const service = createServiceClient(),
    r = await service.rpc('case_portal_context', { p_hash: hash, p_write: false });
  if (r.error) throw r.error;
  const config = await service
    .from('case_launches')
    .select('access_mode,require_liveness,scheduled_at')
    .eq('case_file_id', r.data.case.id)
    .maybeSingle();
  if (config.error) throw config.error;
  return { service, ctx: r.data, config: config.data };
}
export async function getCaseEntryState(hash: string, request?: NextRequest, captureHash?: string) {
  const { service, ctx, config } = await caseEntryContext(hash);
  if (!config)
    return {
      ready: true,
      mode: 'legacy' as const,
      needsLogin: false,
      needsCode: false,
      needsLiveness: false,
    };
  const jar = await cookies();
  const code = await caseEntryCode(hash, request);
  if (config.access_mode === 'public' && !code)
    return {
      ready: false,
      mode: 'public' as const,
      needsLogin: false,
      needsCode: true,
      needsLiveness: true,
    };
  const user =
    config.access_mode === 'public'
      ? await casePublicEntryIdentity(service, ctx.invitation.recipient)
      : await caseEntryIdentity(request);
  if (config.access_mode === 'public' && !user)
    return {
      ready: false,
      mode: 'public' as const,
      needsLogin: false,
      needsRegistration: true,
      needsCode: false,
      needsLiveness: true,
    };
  if (!user || user.email?.toLowerCase() !== ctx.invitation.recipient.toLowerCase())
    return {
      ready: false,
      mode: config.access_mode as 'private' | 'public',
      needsLogin: true,
      needsCode: config.access_mode === 'public' && !code,
      needsLiveness: config.require_liveness,
      wrongAccount: !!user,
    };
  const grant = await service.rpc('case_portal_authorize_actor', {
    p_hash: hash,
    p_actor: user.id,
    p_code_hash: code,
    p_capture_hash: captureHash || null,
  });
  if (grant.error) throw grant.error;
  const currentBrowserVerified =
    config.access_mode !== 'public' ||
    !!captureHash ||
    verifyCaseEntryCode(
      `authorized:${hash}`,
      request?.cookies.get(caseEntryAccessCookie(hash))?.value ||
        jar.get(caseEntryAccessCookie(hash))?.value ||
        ''
    ) === code;
  return {
    ready: grant.data.authorized === true && currentBrowserVerified,
    mode: config.access_mode as 'private' | 'public',
    needsLogin: false,
    needsCode: grant.data.reason === 'code',
    needsLiveness: grant.data.reason === 'liveness' || !currentBrowserVerified,
  };
}
export async function assertCasePortalEntry(hash: string, request?: NextRequest) {
  const entry = await getCaseEntryState(hash, request);
  if (!entry.ready)
    throw new CaseRuntimeError(
      entry.needsLogin
        ? 'CASE_PORTAL_ACCOUNT_REQUIRED'
        : entry.needsCode
          ? 'CASE_PORTAL_CODE_REQUIRED'
          : 'CASE_PORTAL_LIVENESS_REQUIRED',
      entry.needsLogin
        ? 'Inicia sesión con el correo de la invitación.'
        : entry.needsCode
          ? 'Comprueba el código recibido por separado.'
          : 'Completa la prueba de vida para abrir el expediente.',
      entry.needsLogin ? 401 : 403
    );
}
export function invitationHash(request: NextRequest) {
  const token = request.headers.get('x-case-invitation') || '';
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new CaseRuntimeError('CASE_PORTAL_INVALID', 'Invitación inválida.', 403);
  return hashInvitationToken(token);
}
