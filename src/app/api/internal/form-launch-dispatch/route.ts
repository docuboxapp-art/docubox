import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getPublicAppUrl } from '@/lib/publicAppUrl';
import { buildFormEmail } from '../../../../../supabase/functions/_shared/form-email-template';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Schedule = {
  id: string;
  template_id: string;
  workspace_id: string;
  requested_by: string;
  requester_name: string;
  recipient_name: string;
  recipient_email: string;
  signature_type: string;
  require_liveness: boolean;
  expiration_hours: number | null;
  delivery_expires_at: string | null;
  token_id: string | null;
  attempt_count: number;
};

async function authorized(request: NextRequest) {
  const supplied = request.headers.get('authorization');
  if (process.env.CRON_SECRET && supplied === `Bearer ${process.env.CRON_SECRET}`) return true;
  const timestamp = request.headers.get('x-docubox-cron-timestamp') || '';
  const signature = request.headers.get('x-docubox-cron-signature') || '';
  if (!/^\d{10}$/.test(timestamp) || !/^[0-9a-f]{64}$/i.test(signature) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300)
    return false;
  const { data: secret, error } = await createServiceClient().rpc('get_form_dispatch_secret');
  if (error || typeof secret !== 'string' || secret.length < 16) return false;
  const expected = createHmac('sha256', secret).update(timestamp).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

export async function POST(request: NextRequest) {
  if (!await authorized(request)) return new NextResponse(null, { status: 404 });
  const service = createServiceClient();
  const { data, error } = await service.rpc('claim_due_form_sends', { p_limit: 20 });
  if (error) {
    console.error('[form-launch-dispatch] claim failed', error);
    return NextResponse.json({ error: 'No se pudieron consultar los envíos programados.' }, { status: 500 });
  }

  let sent = 0;
  let failed = 0;
  for (const schedule of (data || []) as Schedule[]) {
    let issuedTokenId = schedule.token_id;
    let emailAccepted = false;
    try {
      const { data: template, error: templateError } = await service.from('form_templates')
        .select('id,name,status,workspace_id,settings,workspaces(name)')
        .eq('id', schedule.template_id).maybeSingle();
      if (templateError || !template || template.status !== 'published' || template.workspace_id !== schedule.workspace_id || template.settings?.accessMode === 'public')
        throw new Error('El formulario ya no está publicado para invitaciones privadas.');
      const resendKey = process.env.RESEND_API_KEY;
      const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!resendKey || !secret) throw new Error('El envío por correo no está configurado.');

      const token = createHmac('sha256', secret).update(`form-schedule:${schedule.id}`).digest('hex');
      const expiration = schedule.delivery_expires_at || (template.settings?.configureLinkExpiration === true && schedule.expiration_hours !== null
        ? new Date(Date.now() + schedule.expiration_hours * 60 * 60 * 1000).toISOString() : null);
      if (expiration && new Date(expiration).getTime() <= Date.now())
        throw new Error('La vigencia del enlace terminó antes de poder enviar el correo.');
      if (expiration && !schedule.delivery_expires_at) {
        const storedExpiration = await service.from('form_send_schedules').update({ delivery_expires_at: expiration }).eq('id', schedule.id).eq('status', 'processing');
        if (storedExpiration.error) throw storedExpiration.error;
      }
      const { data: launcherAccount, error: launcherError } = await service.auth.admin.getUserById(schedule.requested_by);
      if (launcherError) throw launcherError;
      const sentToSelf = schedule.recipient_email.toLowerCase() === launcherAccount.user?.email?.toLowerCase();
      let tokenId = schedule.token_id;
      if (!tokenId) {
        const { data: tokenRow, error: tokenError } = await service.from('form_tokens').upsert({
          template_id: schedule.template_id,
          access_mode: 'private',
          recipient_email: schedule.recipient_email,
          recipient_name: schedule.recipient_name,
          signature_type: schedule.signature_type,
          require_liveness: schedule.require_liveness,
          launched_by_user_id: schedule.requested_by,
          launcher_name: schedule.requester_name,
          sent_to_self: sentToSelf,
          token,
          expires_at: expiration,
        }, { onConflict: 'token' }).select('id').single();
        if (tokenError || !tokenRow) throw tokenError || new Error('No se pudo crear el enlace.');
        tokenId = tokenRow.id;
        issuedTokenId = tokenId;
        const linked = await service.from('form_send_schedules').update({ token_id: tokenId }).eq('id', schedule.id).eq('status', 'processing');
        if (linked.error) throw linked.error;
      }
      const workspaceName = Array.isArray(template.workspaces)
        ? template.workspaces[0]?.name || 'DOCUBOX'
        : (template.workspaces as { name?: string } | null)?.name || 'DOCUBOX';
      const formUrl = `${getPublicAppUrl()}/portal-formulario/${token}`;
      const emailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `form-schedule-${schedule.id}`,
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL || 'Docubox <noreply@docubox.com.mx>',
          to: [schedule.recipient_email],
          subject: sentToSelf ? `Tienes un formulario por completar: ${template.name}` : `${schedule.requester_name} te ha enviado un formulario: ${template.name}`,
          html: buildFormEmail({
            variant: 'invitation',
            recipientName: schedule.recipient_name,
            formName: template.name,
            workspaceName,
            requesterName: schedule.requester_name,
            sentToSelf,
            formUrl,
            expiresAt: expiration,
            requireLiveness: schedule.require_liveness,
          }),
        }),
      });
      if (!emailResponse.ok) throw new Error(`Resend respondió ${emailResponse.status}`);
      emailAccepted = true;
      const completed = await service.from('form_send_schedules').update({
        status: 'sent', sent_at: new Date().toISOString(), claim_expires_at: null,
        next_retry_at: null, last_error: null,
      }).eq('id', schedule.id).eq('status', 'processing');
      if (completed.error) throw completed.error;
      sent++;
    } catch (cause) {
      const retry = schedule.attempt_count < 5;
      if (!retry && issuedTokenId && !emailAccepted) {
        const revoked = await service.from('form_tokens').update({ expires_at: new Date().toISOString() })
          .eq('id', issuedTokenId).is('used_at', null);
        if (revoked.error) console.error('[form-launch-dispatch] token revocation failed', revoked.error);
      }
      const delayMinutes = Math.min(60, 2 ** Math.max(0, schedule.attempt_count - 1));
      const result = await service.from('form_send_schedules').update({
        status: retry ? 'retrying' : 'failed',
        next_retry_at: retry ? new Date(Date.now() + delayMinutes * 60_000).toISOString() : null,
        claim_expires_at: null,
        last_error: cause instanceof Error ? cause.message.slice(0, 500) : 'Error de envío',
      }).eq('id', schedule.id).eq('status', 'processing');
      if (result.error) console.error('[form-launch-dispatch] retry state failed', result.error);
      failed++;
    }
  }
  return NextResponse.json({ claimed: (data || []).length, sent, failed });
}
