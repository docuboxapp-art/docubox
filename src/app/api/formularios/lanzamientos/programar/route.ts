import { NextRequest, NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';
import { isSupportedTimeZone } from '@/lib/datetime';
import { getPublicAppUrl } from '@/lib/publicAppUrl';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const signatureTypes = ['click_sign', 'autografa_digital', 'efirma_sat'];

export async function POST(request: NextRequest) {
  try {
    const accessToken = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!accessToken) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    const userClient = createAnonClient(accessToken);
    const { data: { user }, error: authError } = await userClient.auth.getUser(accessToken);
    if (authError || !user) return NextResponse.json({ error: 'Tu sesión expiró.' }, { status: 401 });

    const body = await request.json();
    const templateId = String(body.template_id || '');
    const recipientName = String(body.recipient_name || '').trim();
    const recipientEmail = String(body.recipient_email || '').trim().toLowerCase();
    const signatureType = String(body.signature_type || '');
    const scheduledAt = new Date(String(body.scheduled_at || ''));
    const timezone = String(body.timezone || '');
    const requireLiveness = body.require_liveness;
    const prefill = body.launch_prefill && typeof body.launch_prefill === 'object' && !Array.isArray(body.launch_prefill)
      ? Object.fromEntries(['nombre','apellido_paterno','apellido_materno','full_name','phone','rfc','curp','personalidad_juridica','business_name']
          .map((key) => [key, typeof body.launch_prefill[key] === 'string' ? body.launch_prefill[key].trim().slice(0, 160) : '']))
      : {};
    if (!recipientName || !emailPattern.test(recipientEmail) || !signatureTypes.includes(signatureType) || typeof requireLiveness !== 'boolean')
      return NextResponse.json({ error: 'Revisa los datos del participante y la firma.' }, { status: 400 });
    if (!isSupportedTimeZone(timezone) || Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now() + 60_000 || scheduledAt.getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000)
      return NextResponse.json({ error: 'Selecciona una fecha y hora futura válida, dentro del próximo año.' }, { status: 400 });

    const { data: template, error: templateError } = await userClient.from('form_templates')
      .select('id,workspace_id,status,settings')
      .eq('id', templateId).maybeSingle();
    if (templateError || !template) return NextResponse.json({ error: 'Formulario no encontrado.' }, { status: 404 });
    if (template.status !== 'published')
      return NextResponse.json({ error: 'Este formulario no está publicado.' }, { status: 409 });
    const expiration = template.settings?.configureLinkExpiration === true ? Number(body.expiration_hours) : null;
    if (expiration !== null && (!Number.isFinite(expiration) || expiration < 1 / 60 || expiration > 720))
      return NextResponse.json({ error: 'La vigencia debe estar entre 1 minuto y 720 horas.' }, { status: 400 });
    if (!process.env.RESEND_API_KEY)
      return NextResponse.json({ error: 'El envío por correo no está configurado.' }, { status: 503 });
    if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 16)
      return NextResponse.json({ error: 'La programación de envíos no está configurada.' }, { status: 503 });

    const service = createServiceClient();
    const dispatch = await service.rpc('configure_form_dispatch', {
      p_url: `${getPublicAppUrl()}/api/internal/form-launch-dispatch`,
      p_secret: process.env.CRON_SECRET,
    });
    if (dispatch.error) throw dispatch.error;
    const { data: profile } = await service.from('user_profiles').select('full_name').eq('id', user.id).maybeSingle();
    const requesterName = String(profile?.full_name || user.user_metadata?.full_name || user.email || 'Usuario de Docubox').replace(/[\r\n]+/g, ' ').trim();
    const { data: schedule, error: insertError } = await service.from('form_send_schedules').insert({
      template_id: template.id,
      workspace_id: template.workspace_id,
      requested_by: user.id,
      requester_name: requesterName,
      recipient_name: recipientName,
      recipient_email: recipientEmail,
      launch_prefill: prefill,
      signature_type: signatureType,
      require_liveness: requireLiveness,
      expiration_hours: expiration,
      scheduled_at: scheduledAt.toISOString(),
      timezone,
    }).select('id,scheduled_at,status').single();
    if (insertError) throw insertError;
    return NextResponse.json({ schedule_id: schedule.id, scheduled_at: schedule.scheduled_at, status: schedule.status }, { status: 201 });
  } catch (error) {
    console.error('[form-launch-schedule]', error);
    return NextResponse.json({ error: 'No se pudo programar el envío.' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const accessToken = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!accessToken) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId) return NextResponse.json({ error: 'Selecciona un espacio de trabajo.' }, { status: 400 });
    const userClient = createAnonClient(accessToken);
    const { data: { user }, error: authError } = await userClient.auth.getUser(accessToken);
    if (authError || !user) return NextResponse.json({ error: 'Tu sesión expiró.' }, { status: 401 });
    const { data: templates, error: templateError } = await userClient.from('form_templates')
      .select('id').eq('workspace_id', workspaceId);
    if (templateError) throw templateError;
    const ids = (templates || []).map((template) => template.id);
    if (!ids.length) return NextResponse.json({ schedules: [] });
    const { data, error } = await createServiceClient().from('form_send_schedules')
      .select('id,template_id,recipient_name,recipient_email,scheduled_at,timezone,status,token_id,last_error')
      .in('template_id', ids).in('status', ['scheduled', 'retrying', 'processing', 'failed'])
      .order('scheduled_at', { ascending: true }).limit(200);
    if (error) throw error;
    return NextResponse.json({ schedules: data || [] });
  } catch (error) {
    console.error('[form-launch-schedule-list]', error);
    return NextResponse.json({ error: 'No se pudieron consultar los envíos programados.' }, { status: 500 });
  }
}
