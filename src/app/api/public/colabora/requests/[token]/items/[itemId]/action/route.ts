import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { organizationApiFailure, OrganizationApiError } from '@/lib/organization/server';
import {
  authorizeExternalCollaborationRequest,
  collaborationTokenHash,
} from '@/lib/collaboration/external-request.server';

export const runtime = 'nodejs';
export async function POST(
  request: Request,
  context: { params: Promise<{ token: string; itemId: string }> }
) {
  try {
    const { token, itemId } = await context.params;
    z.string().uuid().parse(itemId);
    const service = createServiceClient();
    const { documentRequest } = await authorizeExternalCollaborationRequest(
      service,
      request,
      token
    );
    if (['completed', 'cancelled', 'expired'].includes(documentRequest.status))
      throw new OrganizationApiError(409, 'request_locked', 'La solicitud ya está cerrada.');
    const result = await service
      .from('collaboration_request_items')
      .select('id,item_type,status,document_id,form_response_id')
      .eq('workspace_id', documentRequest.workspace_id)
      .eq('request_id', documentRequest.id)
      .eq('id', itemId)
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data)
      throw new OrganizationApiError(404, 'item_not_found', 'El requisito no existe.');
    if (['approved', 'waived', 'expired'].includes(result.data.status))
      throw new OrganizationApiError(409, 'item_locked', 'El requisito ya fue resuelto.');
    let url: string;
    if (result.data.item_type === 'form') {
      const issued = await service.rpc('colabora_request_form_token', {
        request_hash: collaborationTokenHash(token),
        session_hash: collaborationTokenHash(request.headers.get('x-colabora-session') || ''),
        item_id: itemId,
      });
      if (issued.error) throw issued.error;
      url = `/${issued.data.resume ? 'form' : 'portal-formulario'}/${encodeURIComponent(issued.data.token)}`;
    } else if (result.data.item_type === 'signature') {
      const document = await service
        .from('documentos')
        .select('id,documento_id,participantes')
        .eq('workspace_id', documentRequest.workspace_id)
        .eq('id', result.data.document_id)
        .is('deleted_at', null)
        .maybeSingle();
      if (document.error) throw document.error;
      if (
        !document.data ||
        !Array.isArray(document.data.participantes) ||
        !document.data.participantes.some(
          (p: Record<string, unknown>) =>
            String(p.email || '').toLowerCase() ===
            String(documentRequest.recipient_email).toLowerCase()
        )
      )
        throw new OrganizationApiError(
          409,
          'signature_unavailable',
          'El documento ya no está disponible para este destinatario.'
        );
      url = `/firmar-documento/${encodeURIComponent(document.data.documento_id || document.data.id)}`;
    } else
      throw new OrganizationApiError(
        422,
        'upload_required',
        'Carga el archivo desde el requisito.'
      );
    return Response.json(
      { success: true, url },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return organizationApiFailure(error);
  }
}
