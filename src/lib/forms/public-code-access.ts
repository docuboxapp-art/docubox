import 'server-only';
import { createHash } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';
import {
  isValidPublicCode,
  matchesPublicCode,
  matchesStoredPublicCode,
  normalizePublicCode,
  publicCodeLookup,
} from './public-access-code';

type Service = ReturnType<typeof createServiceClient>;
export type PublicCodeAccess = {
  formId: string;
  email: string;
  userId: string | null;
  name: string | null;
  recipientBound: boolean;
  signatureType: 'click_sign' | 'autografa_digital' | 'efirma_sat';
};
export class PublicCodeError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

const validEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;

/** The code is the scoped credential for this form, never an application login. */
export async function verifyPublicCode(
  service: Service,
  request: Request,
  input: {
    code: unknown;
    email: unknown;
    formId?: unknown;
  }
): Promise<PublicCodeAccess> {
  const code = normalizePublicCode(input.code);
  const email = String(input.email || '')
    .trim()
    .toLowerCase();
  const expectedFormId = typeof input.formId === 'string' ? input.formId : '';
  if (!validEmail(email)) throw new PublicCodeError('Ingresa el correo de la invitación.', 400);
  if (!isValidPublicCode(code))
    throw new PublicCodeError('Ingresa un código de acceso válido.', 400);
  if (expectedFormId && !/^[0-9a-f-]{36}$/i.test(expectedFormId))
    throw new PublicCodeError('Formulario inválido.', 400);

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const ipHash = createHash('sha256').update(ip).digest('hex');
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count, error: limitError } = await service
    .from('form_public_code_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .eq('succeeded', false)
    .gte('created_at', since);
  if (limitError) throw new PublicCodeError('No se pudo comprobar el límite de intentos.', 503);
  if ((count || 0) >= 10) throw new PublicCodeError('Demasiados intentos. Espera 15 minutos.', 429);

  const lookup = publicCodeLookup(code);
  const { data: recipientCode, error: recipientCodeError } = await service
    .from('form_public_invitees')
    .select('form_id,recipient_name,code_hash,signature_type')
    .eq('code_lookup', lookup)
    .eq('recipient_email', email)
    .maybeSingle();
  if (recipientCodeError) throw new PublicCodeError('No se pudo comprobar la invitación.', 503);
  const bound = Boolean(
    recipientCode &&
    matchesPublicCode(code, recipientCode.code_hash || '') &&
    (!expectedFormId || recipientCode.form_id === expectedFormId)
  );
  const { data: access, error: accessError } = await service
    .from('form_public_access_codes')
    .select('form_id,code_lookup,code_hash,legacy_code_lookup,legacy_code_hash')
    .or(`code_lookup.eq.${lookup},legacy_code_lookup.eq.${lookup}`)
    .maybeSingle();
  if (accessError) throw new PublicCodeError('No se pudo comprobar el código.', 503);
  const codeMatches = Boolean(
    access &&
    matchesStoredPublicCode(code, access) &&
    (!expectedFormId || access.form_id === expectedFormId)
  );
  const formId = bound ? recipientCode!.form_id : access?.form_id;
  const { data: invitee, error: inviteeError } =
    !bound && codeMatches
      ? await service
          .from('form_public_invitees')
          .select('recipient_name,code_hash,signature_type')
          .eq('form_id', access!.form_id)
          .eq('recipient_email', email)
          .maybeSingle()
      : { data: bound ? recipientCode : null, error: null };
  if (inviteeError) throw new PublicCodeError('No se pudo consultar la invitación.', 503);
  const valid = bound || (codeMatches && Boolean(invitee) && !invitee?.code_hash);
  const { data: profile, error: profileError } = valid
    ? await service
        .from('user_profiles')
        .select('id,email,full_name')
        .eq('email', email)
        .maybeSingle()
    : { data: null, error: null };
  if (profileError) throw new PublicCodeError('No se pudo consultar la identidad.', 503);
  const { error: attemptError } = await service.from('form_public_code_attempts').insert({
    code_lookup: lookup,
    user_id: profile?.id || null,
    ip_hash: ipHash,
    succeeded: valid,
  });
  if (attemptError) throw new PublicCodeError('No se pudo registrar el intento de acceso.', 503);
  if (!valid || !formId)
    throw new PublicCodeError('El código no corresponde a esta invitación.', 403);

  const { data: form, error: formError } = await service
    .from('form_templates')
    .select('status')
    .eq('id', formId)
    .maybeSingle();
  if (formError) throw new PublicCodeError('No se pudo consultar el formulario.', 503);
  if (form?.status !== 'published')
    throw new PublicCodeError('Este formulario ya no está disponible.', 404);
  const signatureType = invitee?.signature_type || 'autografa_digital';
  if (!['click_sign', 'autografa_digital', 'efirma_sat'].includes(signatureType))
    throw new PublicCodeError('La firma de esta invitación no es válida.', 409);
  return {
    formId,
    email,
    userId: profile?.id || null,
    name: profile?.full_name || invitee?.recipient_name || null,
    recipientBound: bound,
    signatureType,
  };
}
