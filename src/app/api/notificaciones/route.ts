import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { appendNotificationEvent, assertWorkspaceAccess, createNotificationFolio, errorResponse, requireNotificaUser } from '@/lib/notifica/server';

export async function GET(request: NextRequest) {
  try {
    const user = await requireNotificaUser(request);
    const workspaceId = new URL(request.url).searchParams.get('workspaceId');
    if (!workspaceId) return NextResponse.json({ error: 'Falta el espacio de trabajo.' }, { status: 400 });
    await assertWorkspaceAccess(workspaceId, user.id);
    const { data, error } = await createServiceClient().from('certified_notifications').select('*, notification_recipients(name,email,phone,status)').eq('workspace_id', workspaceId).order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: data || [] });
  } catch (error) {
    const value = errorResponse(error);
    return NextResponse.json({ error: value.message }, { status: value.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireNotificaUser(request);
    const body = await request.json();
    if (!body.workspaceId || !body.documentId || !body.subject || !body.recipient?.name || !body.recipient?.email) {
      return NextResponse.json({ error: 'Completa el documento, asunto y destinatario.' }, { status: 400 });
    }
    await assertWorkspaceAccess(body.workspaceId, user.id);
    const supabase = createServiceClient();
    const { data: document, error: documentError } = await supabase.from('documentos').select('id,documento_id,nombre,file_name,file_size,file_type,file_hash_sha256,estado,updated_at,workspace_id,owner_id').eq('id', body.documentId).eq('owner_id', user.id).maybeSingle();
    if (documentError || !document) throw new Error(documentError?.message || 'No se encontro el documento seleccionado.');
    if (document.workspace_id && document.workspace_id !== body.workspaceId) return NextResponse.json({ error: 'El documento pertenece a otro espacio de trabajo.' }, { status: 403 });

    const snapshot = { id: document.id, documentId: document.documento_id, name: document.nombre || document.file_name, fileName: document.file_name, size: document.file_size, mimeType: document.file_type, hash: document.file_hash_sha256, status: document.estado, versionCapturedAt: document.updated_at };
    const { data: notification, error } = await supabase.from('certified_notifications').insert({
      workspace_id: body.workspaceId,
      source_document_id: document.id,
      folio: createNotificationFolio(),
      subject: body.subject.trim(),
      message: body.message?.trim() || '',
      category: body.category || 'Comunicacion contractual',
      status: 'draft',
      evidence_level: 'E1',
      document_snapshot: snapshot,
      document_hash_sha256: document.file_hash_sha256,
      due_at: body.dueAt || null,
      require_otp: body.requireOtp !== false,
      response_mode: body.responseMode || 'acknowledge',
      allowed_actions: Array.isArray(body.allowedActions) ? body.allowedActions : ['acknowledge'],
      channels: Array.isArray(body.channels) ? body.channels : ['email'],
      created_by: user.id,
      updated_by: user.id,
      last_event_label: 'Notificacion creada',
    }).select('*').single();
    if (error || !notification) throw new Error(error?.message || 'No fue posible crear la notificacion.');

    const { error: recipientError } = await supabase.from('notification_recipients').insert({ workspace_id: body.workspaceId, notification_id: notification.id, name: body.recipient.name.trim(), email: body.recipient.email.trim().toLowerCase(), phone: body.recipient.phone?.trim() || null, role: body.recipient.role || 'Destinatario', authentication_method: body.requireOtp === false ? 'secure_link' : 'email_otp' });
    if (recipientError) throw new Error(recipientError.message);
    const channels = (Array.isArray(body.channels) ? body.channels : ['email']).map((channel: string) => ({ workspace_id: body.workspaceId, notification_id: notification.id, channel, destination: channel === 'email' ? body.recipient.email.trim().toLowerCase() : body.recipient.phone?.trim() || '', status: 'pending' }));
    const { error: channelError } = await supabase.from('notification_delivery_channels').insert(channels);
    if (channelError) throw new Error(channelError.message);
    await appendNotificationEvent({ notificationId: notification.id, workspaceId: body.workspaceId, eventType: 'notification.created', label: 'Notificacion creada', actorUserId: user.id, actorLabel: user.email || 'Usuario Docubox', metadata: { documentHash: document.file_hash_sha256, recipient: body.recipient.email }, request });
    return NextResponse.json({ data: notification }, { status: 201 });
  } catch (error) {
    const value = errorResponse(error);
    return NextResponse.json({ error: value.message }, { status: value.status });
  }
}
