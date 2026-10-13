import { NextRequest, NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';
import { decryptPublicCode } from '@/lib/forms/public-access-code';
import { getPublicAppUrl } from '@/lib/publicAppUrl';
import { resolveTemplatePublicationContext } from '@/lib/templates/publication-server';
import { buildFormEmail } from '../../../../../../../supabase/functions/_shared/form-email-template';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ formId: string }> };
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const reply = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

async function manage(request: NextRequest, context: Context, action: 'resend' | 'cancel') {
  try {
    const { formId } = await context.params;
    if (!uuidPattern.test(formId)) return reply('Formulario no válido.', 400);
    const body = await request.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!emailPattern.test(email) || email.length > 254) return reply('Correo no válido.', 400);

    const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return reply('Inicia sesión para gestionar la invitación.', 401);
    const userClient = createAnonClient(token);
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser(token);
    if (authError || !user) return reply('Tu sesión expiró.', 401);

    // The caller must see the form through RLS and be its creator or a workspace manager.
    const { data: form, error: formError } = await userClient
      .from('form_templates')
      .select('id,name,status,workspace_id,created_by,workspaces(name)')
      .eq('id', formId)
      .maybeSingle();
    if (formError || !form) return reply('No tienes acceso a este formulario.', 403);
    const publication = await resolveTemplatePublicationContext(request, form.workspace_id).catch(
      () => null
    );
    if (
      !publication ||
      publication.user.id !== user.id ||
      (form.created_by !== user.id && !publication.canManageResources)
    )
      return reply('No tienes permiso para gestionar esta invitación.', 403);

    const service = createServiceClient();
    const { data: invitee, error: inviteeError } = await service
      .from('form_public_invitees')
      .select('recipient_name,recipient_email,invited_at,invited_by,code_hash,code_ciphertext')
      .eq('form_id', formId)
      .eq('recipient_email', email)
      .maybeSingle();
    if (inviteeError) throw inviteeError;
    if (!invitee) return reply('La invitación ya no está pendiente.', 409);
    const { data: answer, error: answerError } = await service
      .from('form_responses')
      .select('id')
      .eq('template_id', formId)
      .eq('respondent_email', email)
      .gte('submitted_at', invitee.invited_at)
      .limit(1)
      .maybeSingle();
    if (answerError) throw answerError;
    if (answer) return reply('Esta invitación ya recibió una respuesta.', 409);

    if (action === 'cancel') {
      // Removing this row also revokes the recipient-bound code immediately.
      const { data, error } = await service
        .from('form_public_invitees')
        .delete()
        .eq('form_id', formId)
        .eq('recipient_email', email)
        .eq('invited_at', invitee.invited_at)
        .select('form_id')
        .maybeSingle();
      if (error) throw error;
      if (!data) return reply('La invitación cambió. Actualiza la página.', 409);
      return NextResponse.json({ success: true }, { headers });
    }

    if (form.status !== 'published')
      return reply('Publica el formulario antes de reenviar la invitación.', 409);
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return reply('El envío por correo no está configurado.', 503);
    let codeCiphertext = invitee.code_ciphertext;
    if (!codeCiphertext && !invitee.code_hash) {
      const { data: sharedCode, error: codeError } = await service
        .from('form_public_access_codes')
        .select('code_ciphertext')
        .eq('form_id', formId)
        .maybeSingle();
      if (codeError) throw codeError;
      codeCiphertext = sharedCode?.code_ciphertext || null;
    }
    if (!codeCiphertext)
      return reply('La invitación no tiene un código disponible. Lánzala de nuevo.', 409);
    const code = decryptPublicCode(codeCiphertext);
    const launcherId = invitee.invited_by || user.id;
    const { data: launcherProfile } = await service
      .from('user_profiles')
      .select('full_name')
      .eq('id', launcherId)
      .maybeSingle();
    const launcherName = String(
      launcherProfile?.full_name || user.user_metadata?.full_name || user.email || 'Docubox'
    )
      .replace(/[\r\n]+/g, ' ')
      .trim();
    const workspace = form.workspaces as unknown as { name?: string } | null;
    const formUrl = `${getPublicAppUrl()}/formulario-publico/${formId}?email=${encodeURIComponent(email)}`;
    const common = {
      recipientName: invitee.recipient_name || email,
      formName: form.name,
      workspaceName: workspace?.name || 'Docubox',
      requesterName: launcherName,
      formUrl,
      expiresAt: null,
    };
    const from = process.env.RESEND_FROM_EMAIL || 'Docubox <noreply@docubox.com.mx>';
    const deliveryResponse = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          from,
          to: [email],
          subject: `Recordatorio: completa el formulario ${form.name}`,
          html: buildFormEmail({ ...common, variant: 'public_invitation' }),
        },
        {
          from,
          to: [email],
          subject: `Tu código de acceso al formulario: ${form.name}`,
          html: buildFormEmail({ ...common, variant: 'public_code', accessCode: code }),
        },
      ]),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    const delivery = await deliveryResponse?.json().catch(() => null);
    if (!deliveryResponse?.ok || !Array.isArray(delivery?.data) || delivery.data.length !== 2)
      return reply('No se pudieron reenviar los dos correos. Inténtalo nuevamente.', 502);
    return NextResponse.json({ success: true }, { headers });
  } catch (error) {
    console.error('[public-form-invite-management]', error);
    return reply('No fue posible gestionar la invitación.', 500);
  }
}

export async function POST(request: NextRequest, context: Context) {
  return manage(request, context, 'resend');
}

export async function DELETE(request: NextRequest, context: Context) {
  return manage(request, context, 'cancel');
}
