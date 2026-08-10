import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { appendNotificationEvent, errorResponse, sha256 } from '@/lib/notifica/server';

async function resolveAccess(token: string) {
  const supabase = createServiceClient();
  const { data: access } = await supabase.from('notification_access_tokens').select('*').eq('token_hash', sha256(token)).is('revoked_at', null).maybeSingle();
  if (!access || new Date(access.expires_at).getTime() <= Date.now()) return null;
  const { data: notification } = await supabase.from('certified_notifications').select('*').eq('id', access.notification_id).maybeSingle();
  const { data: recipient } = await supabase.from('notification_recipients').select('*').eq('id', access.recipient_id).maybeSingle();
  if (!notification || !recipient) return null;
  return { supabase, access, notification, recipient };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const resolved = await resolveAccess(token);
    if (!resolved) return NextResponse.json({ error: 'El acceso no existe, vencio o fue revocado.' }, { status: 404 });
    const { supabase, access, notification, recipient } = resolved;
    if (notification.require_otp) return NextResponse.json({ data: { locked: true, recipientEmailHint: maskEmail(recipient.email), subject: notification.subject, folio: notification.folio } });
    const firstAccess = !access.first_used_at;
    const now = new Date().toISOString();
    await supabase.from('notification_access_tokens').update({ first_used_at: access.first_used_at || now, last_used_at: now, use_count: access.use_count + 1 }).eq('id', access.id);
    if (firstAccess) {
      await supabase.from('notification_recipients').update({ status: 'accessed', accessed_at: now }).eq('id', recipient.id);
      await supabase.from('certified_notifications').update({ status: 'accessed', evidence_level: 'E4' }).eq('id', notification.id);
      await appendNotificationEvent({ notificationId: notification.id, workspaceId: notification.workspace_id, eventType: 'recipient.accessed', label: 'Documento consultado por el destinatario', actorLabel: recipient.email, metadata: { recipientId: recipient.id }, request });
    }
    return NextResponse.json({ data: { locked: false, notification: { id: notification.id, folio: notification.folio, subject: notification.subject, message: notification.message, category: notification.category, document: notification.document_snapshot, documentHash: notification.document_hash_sha256, dueAt: notification.due_at, allowedActions: notification.allowed_actions }, recipient: { name: recipient.name, email: recipient.email } } });
  } catch (error) {
    const value = errorResponse(error);
    return NextResponse.json({ error: value.message }, { status: value.status });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const resolved = await resolveAccess(token);
    if (!resolved) return NextResponse.json({ error: 'El acceso no existe, vencio o fue revocado.' }, { status: 404 });
    const { supabase, notification, recipient } = resolved;
    if (notification.require_otp) return NextResponse.json({ error: 'Debes validar el codigo OTP antes de continuar.' }, { status: 401 });
    const body = await request.json();
    const action = String(body.action || '');
    if (!notification.allowed_actions.includes(action)) return NextResponse.json({ error: 'Esta actuacion no esta permitida.' }, { status: 409 });
    const now = new Date().toISOString();
    const responseHash = sha256(JSON.stringify({ notificationId: notification.id, recipientId: recipient.id, action, responseText: body.responseText || '', occurredAt: now }));
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const { error } = await supabase.from('notification_responses').insert({ workspace_id: notification.workspace_id, notification_id: notification.id, recipient_id: recipient.id, action, response_text: body.responseText?.trim() || null, response_hash_sha256: responseHash, ip_address: forwarded || null, user_agent: request.headers.get('user-agent') || null, created_at: now });
    if (error) throw new Error(error.message);
    const state = action === 'acknowledge' ? { status: 'acknowledged', evidence: 'E5', label: 'Acuse de recepcion registrado' } : { status: action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'responded', evidence: 'E6', label: action === 'accept' ? 'Comunicacion aceptada' : action === 'reject' ? 'Comunicacion rechazada' : 'Respuesta registrada' };
    await supabase.from('notification_recipients').update({ status: action === 'acknowledge' ? 'acknowledged' : 'responded', acknowledged_at: action === 'acknowledge' ? now : recipient.acknowledged_at }).eq('id', recipient.id);
    await supabase.from('certified_notifications').update({ status: state.status, evidence_level: state.evidence }).eq('id', notification.id);
    await appendNotificationEvent({ notificationId: notification.id, workspaceId: notification.workspace_id, eventType: `recipient.${action}`, label: state.label, actorLabel: recipient.email, metadata: { recipientId: recipient.id, responseHash }, request });
    return NextResponse.json({ data: { status: state.status, evidenceLevel: state.evidence, responseHash } });
  } catch (error) {
    const value = errorResponse(error);
    return NextResponse.json({ error: value.message }, { status: value.status });
  }
}

function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}`;
}
