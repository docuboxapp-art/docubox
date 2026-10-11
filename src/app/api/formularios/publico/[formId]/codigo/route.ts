import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  createPublicCode,
  decryptPublicCode,
  encryptPublicCode,
  hashPublicCode,
  publicCodeLookup,
} from '@/lib/forms/public-access-code';
import { resolveTemplatePublicationContext } from '@/lib/templates/publication-server';
import { getPublicAppUrl } from '@/lib/publicAppUrl';
import { buildFormEmail } from '../../../../../../../supabase/functions/_shared/form-email-template';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function accessCode(request: NextRequest, context: { params: Promise<{ formId: string }> }, create: boolean) {
  const { formId } = await context.params;
  const jwt = request.headers
    .get('Authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim();
  if (!jwt) return NextResponse.json({ error: 'Inicia sesión.' }, { status: 401, headers });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret)
    return NextResponse.json({ error: 'Servicio no disponible.' }, { status: 503, headers });
  const service = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const {
    data: { user },
  } = await service.auth.getUser(jwt);
  if (!user) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401, headers });
  const { data: form } = await service
    .from('form_templates')
    .select('id,name,status,settings,created_by,workspace_id,allowed_signature_types,workspaces(name)')
    .eq('id', formId)
    .maybeSingle();
  if (!form || form.status !== 'published')
    return NextResponse.json(
      { error: 'No tienes acceso al código de este formulario.' },
      { status: 403, headers }
    );
  const contextForForm = await resolveTemplatePublicationContext(request, form.workspace_id).catch(
    () => null
  );
  if (
    !contextForForm ||
    contextForForm.user.id !== user.id ||
    (form.created_by !== user.id && !contextForForm.canManageResources)
  )
    return NextResponse.json(
      { error: 'No tienes acceso al código de este formulario.' },
      { status: 403, headers }
    );
  const body = create ? await request.json().catch(() => ({})) : {};
  const recipient = body && typeof body === 'object' ? body.recipient : null;
  const recipientEmail = String(recipient?.email || '').trim().toLowerCase();
  if (create && !emailPattern.test(recipientEmail))
    return NextResponse.json({ error: 'Escribe un correo electrónico válido.' }, { status: 400, headers });
  const resendKey = process.env.RESEND_API_KEY;
  if (create && !resendKey)
    return NextResponse.json({ error: 'El envío por correo no está configurado.' }, { status: 503, headers });
  const allowedTypes = Array.isArray(form.allowed_signature_types) && form.allowed_signature_types.length
    ? form.allowed_signature_types : form.settings?.allowedSignatureTypes;
  if (Array.isArray(allowedTypes) && allowedTypes.length && !allowedTypes.includes('autografa_digital'))
    return NextResponse.json({ error: 'Habilita la firma autógrafa digital antes de activar el acceso público.' }, { status: 409, headers });
  const { data: existing, error: lookupError } = await service
    .from('form_public_access_codes')
    .select('code_ciphertext')
    .eq('form_id', formId)
    .maybeSingle();
  if (lookupError)
    return NextResponse.json(
      { error: 'Falta aplicar la migración de códigos públicos.' },
      { status: 503, headers }
    );
  if (!existing && !create)
    return NextResponse.json({ error: 'Este formulario aún no tiene un código público. Actívalo desde Lanzar formulario.' }, { status: 404, headers });
  let code = existing ? decryptPublicCode(existing.code_ciphertext) : createPublicCode();
  if (!existing) {
    const { error } = await service.from('form_public_access_codes').insert({
      form_id: formId,
      code_lookup: publicCodeLookup(code),
      code_hash: hashPublicCode(code),
      code_ciphertext: encryptPublicCode(code),
    });
    if (error?.code === '23505') {
      const { data: concurrent } = await service.from('form_public_access_codes')
        .select('code_ciphertext').eq('form_id', formId).maybeSingle();
      if (concurrent) code = decryptPublicCode(concurrent.code_ciphertext);
      else return NextResponse.json({ error: 'No se pudo recuperar el código.' }, { status: 503, headers });
    } else if (error)
      return NextResponse.json({ error: 'No se pudo generar el código.' }, { status: 503, headers });
  }
  if (!create) return NextResponse.json({ code }, { headers });

  const { error: inviteeError } = await service.from('form_public_invitees').upsert({
    form_id: formId,
    recipient_email: recipientEmail,
    recipient_name: '',
    launch_prefill: {},
    invited_by: user.id,
    invited_at: new Date().toISOString(),
  }, { onConflict: 'form_id,recipient_email' });
  if (inviteeError)
    return NextResponse.json({ error: 'No se pudieron guardar los datos del participante. Revisa la migración de invitaciones.' }, { status: 503, headers });

  const { data: launcherProfile } = await service.from('user_profiles')
    .select('full_name').eq('id', user.id).maybeSingle();
  const launcherName = String(launcherProfile?.full_name || user.user_metadata?.full_name || user.email || 'Docubox').replace(/[\r\n]+/g, ' ').trim();
  const origin = getPublicAppUrl();
  const formUrl = `${origin}/formulario-publico/${formId}?email=${encodeURIComponent(recipientEmail)}`;
  const workspace = form.workspaces as unknown as { name?: string } | null;
  const common = {
    recipientName: '', formName: form.name, workspaceName: workspace?.name || 'Docubox',
    requesterName: launcherName, formUrl, expiresAt: null,
  };
  const from = process.env.RESEND_FROM_EMAIL || 'Docubox <noreply@docubox.com.mx>';
  const emailResponse = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      { from, to: [recipientEmail], subject: `${launcherName} te ha enviado un formulario: ${form.name}`,
        html: buildFormEmail({ ...common, variant: 'public_invitation' }) },
      { from, to: [recipientEmail], subject: `Tu código de acceso al formulario: ${form.name}`,
        html: buildFormEmail({ ...common, variant: 'public_code', accessCode: code }) },
    ]),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  const delivery = await emailResponse?.json().catch(() => null);
  if (!emailResponse?.ok || !Array.isArray(delivery?.data) || delivery.data.length !== 2)
    return NextResponse.json({ error: 'No se pudieron aceptar los dos correos para envío. Inténtalo nuevamente.' }, { status: 502, headers });
  return NextResponse.json({ code, emails_sent: 2 }, { headers });
}

export async function GET(request: NextRequest, context: { params: Promise<{ formId: string }> }) {
  return accessCode(request, context, false);
}

export async function POST(request: NextRequest, context: { params: Promise<{ formId: string }> }) {
  return accessCode(request, context, true);
}
