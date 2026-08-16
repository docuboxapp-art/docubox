import { createHash, randomUUID } from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

function safeName(name: string) {
  return name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'archivo';
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const service = createServiceClient();
  let uploadedPath = '';
  try {
    const { token } = await context.params;
    const sessionToken = request.headers.get('x-colabora-session') || '';
    if (!sessionToken)
      return Response.json({ error: 'La sesion es requerida.' }, { status: 401 });

    const requestResult = await service
      .from('collaboration_document_requests')
      .select('id,workspace_id,status,access_expires_at')
      .eq('access_token_hash', sha(token))
      .maybeSingle();
    if (requestResult.error) throw requestResult.error;
    const documentRequest = requestResult.data;
    if (
      !documentRequest ||
      !['sent', 'in_progress'].includes(documentRequest.status) ||
      (documentRequest.access_expires_at &&
        new Date(documentRequest.access_expires_at).getTime() <= Date.now())
    )
      return Response.json({ error: 'La solicitud no acepta nuevas cargas.' }, { status: 410 });

    const sessionResult = await service
      .from('collaboration_request_external_sessions')
      .select('id')
      .eq('request_id', documentRequest.id)
      .eq('session_token_hash', sha(sessionToken))
      .is('revoked_at', null)
      .not('otp_consumed_at', 'is', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (sessionResult.error) throw sessionResult.error;
    if (!sessionResult.data)
      return Response.json({ error: 'La sesion vencio. Vuelve a verificar tu correo.' }, { status: 401 });

    const formData = await request.formData();
    const itemId = String(formData.get('item_id') || '');
    const file = formData.get('file');
    if (!(file instanceof File) || !itemId)
      return Response.json({ error: 'Selecciona el requisito y un archivo.' }, { status: 400 });
    if (!ALLOWED_TYPES.has(file.type))
      return Response.json({ error: 'Solo se permiten archivos PDF, JPG o PNG.' }, { status: 415 });
    if (file.size <= 0 || file.size > MAX_BYTES)
      return Response.json({ error: 'El archivo debe pesar menos de 25 MB.' }, { status: 413 });

    const itemResult = await service
      .from('collaboration_request_items')
      .select('id,status')
      .eq('workspace_id', documentRequest.workspace_id)
      .eq('request_id', documentRequest.id)
      .eq('id', itemId)
      .maybeSingle();
    if (itemResult.error) throw itemResult.error;
    if (!itemResult.data || ['approved', 'waived'].includes(itemResult.data.status))
      return Response.json({ error: 'Este requisito ya no admite archivos.' }, { status: 409 });

    const previous = await service
      .from('collaboration_request_files')
      .select('id,version')
      .eq('request_item_id', itemId)
      .order('version', { ascending: false })
      .limit(1);
    if (previous.error) throw previous.error;
    const version = (previous.data?.[0]?.version || 0) + 1;
    const bytes = Buffer.from(await file.arrayBuffer());
    uploadedPath = `collaboration-requests/${documentRequest.workspace_id}/${documentRequest.id}/${itemId}/${randomUUID()}-${safeName(file.name)}`;
    const upload = await service.storage.from('documents').upload(uploadedPath, bytes, {
      contentType: file.type,
      cacheControl: '0',
      upsert: false,
    });
    if (upload.error) throw upload.error;

    const inserted = await service
      .from('collaboration_request_files')
      .insert({
        workspace_id: documentRequest.workspace_id,
        request_item_id: itemId,
        original_name: file.name,
        storage_path: uploadedPath,
        mime_type: file.type,
        byte_size: file.size,
        sha256: sha(bytes),
        malware_scan_status: 'pending',
        version,
        replaced_file_id: previous.data?.[0]?.id || null,
        uploaded_by_external_session_id: sessionResult.data.id,
      })
      .select('id,original_name,mime_type,byte_size,sha256,malware_scan_status,version,received_at')
      .single();
    if (inserted.error) throw inserted.error;
    const itemUpdate = await service
      .from('collaboration_request_items')
      .update({ status: 'uploaded', validation_status: 'pending', rejection_reason: null })
      .eq('id', itemId);
    if (itemUpdate.error) throw itemUpdate.error;
    await service
      .from('collaboration_document_requests')
      .update({ status: 'in_progress' })
      .eq('id', documentRequest.id)
      .in('status', ['sent', 'in_progress']);
    await service.from('collaboration_activity_events').insert({
      workspace_id: documentRequest.workspace_id,
      event_type: 'request.file_received',
      resource_type: 'document_request',
      resource_id: documentRequest.id,
      summary: `Se recibio un archivo para la solicitud documental.`,
      visibility: 'internal',
      metadata: { request_item_id: itemId, file_id: inserted.data.id, version },
    });
    return Response.json({ success: true, data: inserted.data }, { status: 201 });
  } catch {
    if (uploadedPath) await service.storage.from('documents').remove([uploadedPath]);
    return Response.json({ error: 'No se pudo recibir el archivo.' }, { status: 500 });
  }
}

