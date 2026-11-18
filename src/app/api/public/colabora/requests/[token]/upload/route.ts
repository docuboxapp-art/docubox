import { organizationApiFailure } from '@/lib/organization/server';
import { createHash, randomUUID } from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { hasCurrentCollaborationEntitlement } from '@/lib/collaboration/entitlements-server';

export const runtime = 'nodejs';

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

function safeName(name: string) {
  return (
    name
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(-120) || 'archivo'
  );
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const service = createServiceClient();
  let uploadedPath = '';
  try {
    const { token } = await context.params;
    const sessionToken = request.headers.get('x-colabora-session') || '';
    if (!sessionToken) return Response.json({ error: 'La sesion es requerida.' }, { status: 401 });

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
    if (
      !(await hasCurrentCollaborationEntitlement(
        service,
        documentRequest.workspace_id,
        'collaboration_core',
        true
      ))
    )
      return Response.json(
        { error: 'La organización no tiene habilitadas nuevas entregas.' },
        { status: 403 }
      );

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
      return Response.json(
        { error: 'La sesion vencio. Vuelve a verificar tu correo.' },
        { status: 401 }
      );

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
      .select('id,status,item_type')
      .eq('workspace_id', documentRequest.workspace_id)
      .eq('request_id', documentRequest.id)
      .eq('id', itemId)
      .maybeSingle();
    if (itemResult.error) throw itemResult.error;
    if (!itemResult.data || ['approved', 'waived'].includes(itemResult.data.status))
      return Response.json({ error: 'Este requisito ya no admite archivos.' }, { status: 409 });

    if (!['document', 'identity'].includes(itemResult.data.item_type))
      return Response.json(
        { error: 'Este requisito se completa mediante su formulario o proceso de firma.' },
        { status: 422 }
      );
    const bytes = Buffer.from(await file.arrayBuffer());
    uploadedPath = `collaboration-requests/${documentRequest.workspace_id}/${documentRequest.id}/${itemId}/${randomUUID()}-${safeName(file.name)}`;
    const upload = await service.storage.from('documents').upload(uploadedPath, bytes, {
      contentType: file.type,
      cacheControl: '0',
      upsert: false,
    });
    if (upload.error) throw upload.error;

    const inserted = await service.rpc('colabora_receive_request_file', {
      request_hash: sha(token),
      session_hash: sha(sessionToken),
      item_id: itemId,
      file_values: {
        original_name: file.name,
        storage_path: uploadedPath,
        mime_type: file.type,
        byte_size: file.size,
        sha256: sha(bytes),
      },
    });
    if (inserted.error) throw inserted.error;
    uploadedPath = '';
    return Response.json(
      { success: true, data: inserted.data },
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    if (uploadedPath) await service.storage.from('documents').remove([uploadedPath]);
    return organizationApiFailure(error);
  }
}
