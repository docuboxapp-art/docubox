import { z } from 'zod';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    z.string().uuid().parse(documentId);
    const access = await requireDocumentAccess(request as any, documentId);
    if (!access.delegatedParticipantReferenceId) {
      return Response.json({ success: true, delegated: false, data: null });
    }
    const result = await access.service
      .from('document_participant_delegations')
      .select('id,original_participant_reference_id,delegate_user_id,reason,created_at')
      .eq('document_id', documentId)
      .eq('delegate_user_id', access.user.id)
      .eq('status', 'active')
      .eq('original_participant_reference_id', access.delegatedParticipantReferenceId)
      .maybeSingle();
    if (result.error) throw result.error;
    return Response.json({ success: true, delegated: Boolean(result.data), data: result.data });
  } catch (cause) {
    const failure = documentAccessResponse(cause);
    return Response.json(failure.body, { status: failure.status });
  }
}
