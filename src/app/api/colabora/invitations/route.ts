import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { authorizeCollaborationRequest } from '@/lib/collaboration/server';
import { collaborationTokenHash } from '@/lib/collaboration/external-request.server';
import { sendCollaborationRequestInvitation } from '@/lib/collaboration/invitations.server';
import { organizationApiFailure, OrganizationApiError } from '@/lib/organization/server';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const input = z
      .object({ workspace_id: z.string().uuid(), request_id: z.string().uuid() })
      .strict()
      .parse(await request.json());
    const { service, user, userClient } = await authorizeCollaborationRequest(
      request,
      input.workspace_id,
      'requests.create',
      true,
      { type: 'request', id: input.request_id }
    );
    const visible = await userClient
      .from('collaboration_document_requests')
      .select('id')
      .eq('workspace_id', input.workspace_id)
      .eq('id', input.request_id)
      .maybeSingle();
    if (visible.error) throw visible.error;
    if (!visible.data)
      throw new OrganizationApiError(
        404,
        'request_not_found',
        'La solicitud no está en tu alcance.'
      );
    const token = randomBytes(32).toString('base64url');
    const changed = await service.rpc('colabora_rotate_request_invitation', {
      ws: input.workspace_id,
      actor: user.id,
      request_id: input.request_id,
      token_hash: collaborationTokenHash(token),
    });
    if (changed.error) throw changed.error;
    const delivery = await sendCollaborationRequestInvitation(service, changed.data, token);
    return Response.json(
      {
        success: true,
        status: delivery.status,
        path: `/solicitud/${token}`,
        message:
          delivery.status === 'sent'
            ? 'La invitación se envió al destinatario.'
            : 'La solicitud se guardó, pero el correo no pudo enviarse. Puedes compartir el nuevo enlace o reintentar después.',
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return organizationApiFailure(error);
  }
}
