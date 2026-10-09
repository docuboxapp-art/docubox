import { NextRequest, NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

type Context = { params: Promise<{ scheduleId: string }> };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const { scheduleId } = await context.params;
    if (!uuidPattern.test(scheduleId)) return NextResponse.json({ error: 'Envío no válido.' }, { status: 400 });
    const accessToken = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!accessToken) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    const userClient = createAnonClient(accessToken);
    const { data: { user }, error: authError } = await userClient.auth.getUser(accessToken);
    if (authError || !user) return NextResponse.json({ error: 'Tu sesión expiró.' }, { status: 401 });
    const service = createServiceClient();
    const { data: schedule, error: scheduleError } = await service.from('form_send_schedules')
      .select('id,template_id,token_id,status').eq('id', scheduleId).maybeSingle();
    if (scheduleError || !schedule) return NextResponse.json({ error: 'Envío programado no encontrado.' }, { status: 404 });
    const { data: template, error: templateError } = await userClient.from('form_templates')
      .select('id').eq('id', schedule.template_id).maybeSingle();
    if (templateError || !template) return NextResponse.json({ error: 'No tienes acceso a este formulario.' }, { status: 403 });
    const { data: cancelled, error } = await service.from('form_send_schedules')
      .update({ status: 'cancelled', claim_expires_at: null, next_retry_at: null })
      .eq('id', scheduleId).in('status', ['scheduled', 'retrying', 'failed'])
      .select('id').maybeSingle();
    if (error) throw error;
    if (!cancelled) return NextResponse.json({ error: 'Este envío ya se está procesando o concluyó.' }, { status: 409 });
    if (schedule.token_id) {
      const revoked = await service.from('form_tokens').update({ expires_at: new Date().toISOString() })
        .eq('id', schedule.token_id).is('used_at', null);
      if (revoked.error) throw revoked.error;
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[form-launch-schedule-cancel]', error);
    return NextResponse.json({ error: 'No se pudo cancelar el envío.' }, { status: 500 });
  }
}
