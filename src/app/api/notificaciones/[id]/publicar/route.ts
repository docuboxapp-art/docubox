import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { appendNotificationEvent, assertWorkspaceAccess, createAccessToken, errorResponse, requireNotificaUser } from '@/lib/notifica/server';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireNotificaUser(request);
    const { id } = await params;
    const supabase = createServiceClient();
    const { data: notification } = await supabase.from('certified_notifications').select('id,workspace_id,status,require_otp,document_hash_sha256').eq('id', id).maybeSingle();
    if (!notification) return NextResponse.json({ error: 'Notificacion no encontrada.' }, { status: 404 });
    await assertWorkspaceAccess(notification.workspace_id, user.id);
    if (notification.status !== 'draft') return NextResponse.json({ error: 'Solo un borrador puede ponerse a disposicion.' }, { status: 409 });
    const { data: recipient } = await supabase.from('notification_recipients').select('id,email').eq('notification_id', id).limit(1).maybeSingle();
    if (!recipient) return NextResponse.json({ error: 'La notificacion no tiene destinatario.' }, { status: 409 });
    const { token, tokenHash } = createAccessToken();
    const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
    const { error: tokenError } = await supabase.from('notification_access_tokens').insert({ workspace_id: notification.workspace_id, notification_id: id, recipient_id: recipient.id, token_hash: tokenHash, expires_at: expiresAt });
    if (tokenError) throw new Error(tokenError.message);
    const now = new Date().toISOString();
    const { error: updateError } = await supabase.from('certified_notifications').update({ status: 'available', evidence_level: 'E2', published_at: now, updated_by: user.id }).eq('id', id);
    if (updateError) throw new Error(updateError.message);
    await appendNotificationEvent({ notificationId: id, workspaceId: notification.workspace_id, eventType: 'notification.available', label: 'Documento puesto a disposicion', actorUserId: user.id, actorLabel: user.email || 'Usuario Docubox', metadata: { documentHash: notification.document_hash_sha256, expiresAt }, request });
    const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
    return NextResponse.json({ data: { status: 'available', evidenceLevel: 'E2', accessUrl: `${origin}/notificacion/${token}`, expiresAt } });
  } catch (error) {
    const value = errorResponse(error);
    return NextResponse.json({ error: value.message }, { status: value.status });
  }
}
