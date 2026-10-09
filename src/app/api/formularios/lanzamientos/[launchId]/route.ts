import { NextRequest, NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';
import { getPublicAppUrl } from '@/lib/publicAppUrl';

type Context = { params: Promise<{ launchId: string }> };
type Action = 'resend' | 'cancel';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ||
      character
  );

async function manage(req: NextRequest, context: Context, action: Action) {
  try {
    const { launchId } = await context.params;
    if (!uuidPattern.test(launchId))
      return NextResponse.json({ error: 'Enlace no válido.' }, { status: 400 });
    const accessToken = req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!accessToken) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });

    const userClient = createAnonClient(accessToken);
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser(accessToken);
    if (authError || !user)
      return NextResponse.json({ error: 'Tu sesión expiró.' }, { status: 401 });

    const service = createServiceClient();
    const { data: launch, error: launchError } = await service
      .from('form_tokens')
      .select('id,template_id,recipient_name,recipient_email,token,expires_at,used_at')
      .eq('id', launchId)
      .maybeSingle();
    if (launchError || !launch)
      return NextResponse.json({ error: 'Lanzamiento no encontrado.' }, { status: 404 });

    // A visible template is scoped by the caller's workspace RLS policy.
    const { data: template, error: templateError } = await userClient
      .from('form_templates')
      .select('id,name,status,workspaces(name)')
      .eq('id', launch.template_id)
      .maybeSingle();
    if (templateError || !template)
      return NextResponse.json({ error: 'No tienes acceso a este formulario.' }, { status: 403 });
    if (launch.used_at || new Date(launch.expires_at).getTime() <= Date.now())
      return NextResponse.json({ error: 'Este enlace ya no está pendiente.' }, { status: 409 });

    if (action === 'cancel') {
      const { data, error } = await service
        .from('form_tokens')
        .update({ expires_at: new Date().toISOString() })
        .eq('id', launchId)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data)
        return NextResponse.json({ error: 'Este enlace ya no está pendiente.' }, { status: 409 });
      return NextResponse.json({ success: true });
    }

    if (template.status !== 'published')
      return NextResponse.json(
        { error: 'Publica el formulario antes de reenviar el enlace.' },
        { status: 409 }
      );
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey)
      return NextResponse.json(
        { error: 'El envío por correo no está configurado.' },
        { status: 503 }
      );

    const workspaceName = Array.isArray(template.workspaces)
      ? template.workspaces[0]?.name || 'DOCUBOX'
      : (template.workspaces as { name?: string } | null)?.name || 'DOCUBOX';
    const formUrl = `${getPublicAppUrl()}/portal-formulario/${encodeURIComponent(launch.token)}`;
    const expiry = new Date(launch.expires_at).toLocaleString('es-MX');
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'DOCUBOX <noreply@docubox.mx>',
        to: [launch.recipient_email],
        subject: `Recordatorio: completa el formulario ${template.name}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px"><h2 style="color:#1e6bff">Tienes un formulario pendiente</h2><p>Hola ${escapeHtml(launch.recipient_name || launch.recipient_email)},</p><p><strong>${escapeHtml(workspaceName)}</strong> te recuerda completar el formulario <strong>${escapeHtml(template.name)}</strong>.</p><p>Este enlace vence el ${escapeHtml(expiry)}.</p><p style="margin:32px 0"><a href="${escapeHtml(formUrl)}" style="background:#1e6bff;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">Completar formulario</a></p><p style="font-size:12px;color:#64748b">Si no esperabas este correo, puedes ignorarlo.</p></div>`,
      }),
    });
    if (!emailResponse.ok)
      return NextResponse.json(
        { error: 'No se pudo reenviar el correo. Inténtalo de nuevo.' },
        { status: 502 }
      );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[form-launch-management]', error);
    return NextResponse.json({ error: 'No fue posible gestionar el enlace.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: Context) {
  return manage(req, context, 'resend');
}
export async function DELETE(req: NextRequest, context: Context) {
  return manage(req, context, 'cancel');
}
