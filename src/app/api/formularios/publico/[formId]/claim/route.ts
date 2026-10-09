import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const noStore = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function POST(request: NextRequest, context: { params: Promise<{ formId: string }> }) {
  const { formId } = await context.params;
  const accessToken = request.headers
    .get('Authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim();
  if (!accessToken)
    return NextResponse.json(
      { error: 'Inicia sesión para responder.' },
      { status: 401, headers: noStore }
    );

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey)
    return NextResponse.json(
      { error: 'Servicio no disponible.' },
      { status: 503, headers: noStore }
    );
  const service = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const {
    data: { user },
    error: authError,
  } = await service.auth.getUser(accessToken);
  if (authError || !user || user.is_anonymous || !user.email || !user.email_confirmed_at)
    return NextResponse.json(
      { error: 'Necesitas una cuenta con correo verificado.' },
      { status: 401, headers: noStore }
    );

  const { data: form, error: formError } = await service
    .from('form_templates')
    .select('id,name,status,settings,allowed_signature_types')
    .eq('id', formId)
    .maybeSingle();
  if (formError)
    return NextResponse.json(
      { error: 'No se pudo consultar el formulario.' },
      { status: 503, headers: noStore }
    );
  if (!form || form.status !== 'published' || form.settings?.accessMode !== 'public')
    return NextResponse.json(
      { error: 'Este enlace público no está disponible.' },
      { status: 404, headers: noStore }
    );

  const allowedTypes =
    Array.isArray(form.allowed_signature_types) && form.allowed_signature_types.length
      ? form.allowed_signature_types
      : form.settings?.allowedSignatureTypes;
  if (
    Array.isArray(allowedTypes) &&
    allowedTypes.length &&
    !allowedTypes.includes('autografa_digital')
  )
    return NextResponse.json(
      { error: 'La firma autógrafa no está habilitada para este formulario.' },
      { status: 409, headers: noStore }
    );

  const { data: prior, error: priorError } = await service
    .from('form_tokens')
    .select('token,used_at,expires_at')
    .eq('template_id', formId)
    .eq('access_mode', 'public')
    .eq('recipient_user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (priorError)
    return NextResponse.json(
      { error: 'No se pudo comprobar el acceso.' },
      { status: 503, headers: noStore }
    );
  if (prior?.used_at)
    return NextResponse.json(
      { error: 'Ya respondiste este formulario.' },
      { status: 409, headers: noStore }
    );
  if (prior && new Date(prior.expires_at).getTime() > Date.now())
    return NextResponse.json({ url: `/form/${prior.token}` }, { headers: noStore });

  const configured = Number(form.settings?.expirationHours);
  const hours =
    form.settings?.configureLinkExpiration === true &&
    Number.isFinite(configured) &&
    configured >= 1 / 60 &&
    configured <= 720
      ? configured
      : 72;
  const token = randomBytes(32).toString('hex');
  const { error: insertError } = await service.from('form_tokens').insert({
    template_id: formId,
    access_mode: 'public',
    recipient_user_id: user.id,
    recipient_email: user.email.trim().toLowerCase(),
    recipient_name: String(user.user_metadata?.full_name || user.email),
    signer_role: 'Participante',
    signature_type: 'autografa_digital',
    require_liveness: true,
    token,
    expires_at: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
  });
  if (insertError)
    return NextResponse.json(
      { error: 'No se pudo abrir el formulario.' },
      { status: 503, headers: noStore }
    );
  return NextResponse.json({ url: `/form/${token}` }, { headers: noStore });
}
