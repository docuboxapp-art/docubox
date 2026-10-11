import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isValidPublicCode, matchesStoredPublicCode, normalizePublicCode, publicCodeLookup } from '@/lib/forms/public-access-code';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
const reply = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

export async function POST(request: NextRequest) {
  const jwt = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return reply('Inicia sesión para comprobar el código.', 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return reply('Servicio no disponible.', 503);
  const service = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: authError } = await service.auth.getUser(jwt);
  if (authError || !user || user.is_anonymous || !user.email_confirmed_at)
    return reply('Necesitas una cuenta con correo verificado.', 401);

  const body = await request.json().catch(() => ({}));
  const code = normalizePublicCode(body?.code);
  const formId = typeof body?.formId === 'string' ? body.formId : '';
  if (!isValidPublicCode(code)) return reply('Ingresa un código de acceso válido.', 400);

  const lookup = publicCodeLookup(code);
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count, error: limitError } = await service.from('form_public_code_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).eq('succeeded', false).gte('created_at', since);
  if (limitError) return reply('No se pudo comprobar el límite de intentos.', 503);
  if ((count || 0) >= 5) return reply('Demasiados intentos. Espera 15 minutos.', 429);

  const { data: access, error: accessError } = await service.from('form_public_access_codes')
    .select('form_id,code_lookup,code_hash,legacy_code_lookup,legacy_code_hash')
    .or(`code_lookup.eq.${lookup},legacy_code_lookup.eq.${lookup}`).maybeSingle();
  if (accessError) return reply('No se pudo comprobar el código.', 503);
  const valid = Boolean(access && matchesStoredPublicCode(code, access) && (!formId || access.form_id === formId));
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const { error: attemptError } = await service.from('form_public_code_attempts').insert({
    code_lookup: lookup,
    user_id: user.id,
    ip_hash: createHash('sha256').update(ip).digest('hex'),
    succeeded: valid,
  });
  if (attemptError) return reply('No se pudo registrar el intento de acceso.', 503);
  if (!valid || !access) return reply('El código no corresponde a este formulario.', 403);

  const { data: form, error: formError } = await service.from('form_templates')
    .select('name,status,settings,allowed_signature_types').eq('id', access.form_id).maybeSingle();
  if (formError) return reply('No se pudo consultar el formulario.', 503);
  if (!form || form.status !== 'published') return reply('Este formulario ya no está disponible.', 404);
  const allowedTypes =
    Array.isArray(form.allowed_signature_types) && form.allowed_signature_types.length
      ? form.allowed_signature_types
      : form.settings?.allowedSignatureTypes;
  if (Array.isArray(allowedTypes) && allowedTypes.length && !allowedTypes.includes('autografa_digital'))
    return reply('La firma autógrafa no está habilitada para este formulario.', 409);
  return NextResponse.json({ valid: true, formName: form.name }, { headers });
}
