import { z } from 'zod';
import { OrganizationApiError, organizationApiFailure } from '@/lib/organization/server';
import {
  authorizeCollaborationRequest,
  recordCollaborationAudit,
  requireCollaborationEntitlement,
} from '@/lib/collaboration/server';

export const runtime = 'nodejs';

const commentSchema = z.object({
  workspace_id: z.string().uuid(),
  action: z.literal('comment'),
  document_version_id: z.string().uuid(),
  review_round_id: z.string().uuid().nullable().optional(),
  body: z.string().trim().min(1).max(20000),
  audience: z.enum(['private', 'internal', 'shared', 'formal']).default('internal'),
  comment_type: z.enum(['general', 'annotation', 'change_request', 'decision']).default('general'),
  is_blocking: z.boolean().default(false),
  recipient_ids: z.array(z.string().uuid()).max(100).default([]),
  annotation: z
    .object({
      page_number: z.number().int().positive(),
      annotation_type: z.enum(['point', 'highlight', 'rectangle', 'region']),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().min(0).max(1).nullable().optional(),
      height: z.number().min(0).max(1).nullable().optional(),
    })
    .nullable()
    .optional(),
});

const decisionSchema = z.object({
  workspace_id: z.string().uuid(),
  action: z.enum(['approve', 'request_changes', 'close_review']),
  review_round_id: z.string().uuid(),
  optimistic_version: z.number().int().positive(),
  note: z.string().trim().max(5000).nullable().optional(),
});

const commentStateSchema = z.object({
  workspace_id: z.string().uuid(),
  action: z.enum(['resolve_comment', 'reopen_comment']),
  comment_id: z.string().uuid(),
});

export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    const workspaceId = new URL(request.url).searchParams.get('workspace_id') || '';
    const { service, access } = await authorizeCollaborationRequest(
      request,
      workspaceId,
      'reviews.view'
    );
    requireCollaborationEntitlement(access, 'collaboration_advanced_reviews');
    const [document, versions, rounds, comments] = await Promise.all([
      service
        .from('documentos')
        .select(
          'id,documento_id,nombre,descripcion,file_name,file_size,file_type,file_hash_sha256,estado,workspace_id,created_at,updated_at'
        )
        .eq('workspace_id', workspaceId)
        .eq('id', documentId)
        .maybeSingle(),
      service
        .from('document_versions')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('document_id', documentId)
        .order('version_number', { ascending: false }),
      service
        .from('collaboration_review_rounds')
        .select('*,collaboration_reviewers(*,user_profiles(full_name,email))')
        .eq('workspace_id', workspaceId)
        .eq('document_id', documentId)
        .order('round_number', { ascending: false }),
      service
        .from('collaboration_comments')
        .select(
          '*,author:user_profiles!collaboration_comments_author_id_fkey(full_name,email),collaboration_annotations(*)'
        )
        .eq('workspace_id', workspaceId)
        .eq('document_id', documentId)
        .order('created_at'),
    ]);
    for (const result of [document, versions, rounds, comments])
      if (result.error) throw result.error;
    if (!document.data)
      throw new OrganizationApiError(
        404,
        'document_not_found',
        'El documento no existe o no esta en tu alcance.'
      );
    return Response.json({
      success: true,
      data: {
        document: document.data,
        versions: versions.data || [],
        rounds: rounds.data || [],
        comments: comments.data || [],
      },
    });
  } catch (error) {
    return organizationApiFailure(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    const body = await request.json();
    if (body?.action === 'comment') {
      const input = commentSchema.parse(body);
      const { service, user, access } = await authorizeCollaborationRequest(
        request,
        input.workspace_id,
        'reviews.comment',
        true
      );
      requireCollaborationEntitlement(access, 'collaboration_advanced_reviews', true);
      const version = await service
        .from('document_versions')
        .select('id,status')
        .eq('workspace_id', input.workspace_id)
        .eq('document_id', documentId)
        .eq('id', input.document_version_id)
        .maybeSingle();
      if (version.error) throw version.error;
      if (!version.data)
        throw new OrganizationApiError(
          409,
          'version_mismatch',
          'La version seleccionada no pertenece al documento.'
        );
      const { annotation, action: _action, ...comment } = input;
      const result = await service
        .from('collaboration_comments')
        .insert({
          ...comment,
          document_id: documentId,
          author_id: user.id,
          review_round_id: input.review_round_id || null,
        })
        .select('*')
        .single();
      if (result.error) throw result.error;
      if (annotation) {
        const annotationResult = await service.from('collaboration_annotations').insert({
          ...annotation,
          workspace_id: input.workspace_id,
          document_id: documentId,
          document_version_id: input.document_version_id,
          comment_id: result.data.id,
        });
        if (annotationResult.error) throw annotationResult.error;
      }
      if (input.recipient_ids.length) {
        const mentions = await service.from('collaboration_comment_mentions').insert(
          input.recipient_ids.map((mentionedUserId) => ({
            comment_id: result.data.id,
            workspace_id: input.workspace_id,
            mentioned_user_id: mentionedUserId,
          }))
        );
        if (mentions.error) throw mentions.error;
      }
      await recordCollaborationAudit(service, {
        workspaceId: input.workspace_id,
        actorUserId: user.id,
        eventType: 'collaboration.review_comment_created',
        resourceType: 'review_comment',
        resourceId: result.data.id,
        summary: 'Se agrego un comentario a la revision documental.',
        payload: { audience: input.audience, blocking: input.is_blocking },
      });
      return Response.json({ success: true, data: result.data }, { status: 201 });
    }

    if (body?.action === 'resolve_comment' || body?.action === 'reopen_comment') {
      const input = commentStateSchema.parse(body);
      const { service, user, access } = await authorizeCollaborationRequest(
        request,
        input.workspace_id,
        'reviews.resolve_comments',
        true
      );
      requireCollaborationEntitlement(access, 'collaboration_advanced_reviews', true);
      const status = input.action === 'resolve_comment' ? 'resolved' : 'open';
      const result = await service
        .from('collaboration_comments')
        .update({
          status,
          resolved_by: status === 'resolved' ? user.id : null,
          resolved_at: status === 'resolved' ? new Date().toISOString() : null,
        })
        .eq('workspace_id', input.workspace_id)
        .eq('document_id', documentId)
        .eq('id', input.comment_id)
        .select('*')
        .maybeSingle();
      if (result.error) throw result.error;
      if (!result.data)
        throw new OrganizationApiError(
          404,
          'comment_not_found',
          'El comentario no existe o no esta en tu alcance.'
        );
      await recordCollaborationAudit(service, {
        workspaceId: input.workspace_id,
        actorUserId: user.id,
        eventType: `collaboration.${input.action}`,
        resourceType: 'review_comment',
        resourceId: input.comment_id,
        summary:
          status === 'resolved'
            ? 'Se resolvio un comentario de revision.'
            : 'Se reabrio un comentario de revision.',
      });
      return Response.json({ success: true, data: result.data });
    }

    const input = decisionSchema.parse(body);
    const permission =
      input.action === 'approve'
        ? 'reviews.approve'
        : input.action === 'request_changes'
          ? 'reviews.request_changes'
          : 'reviews.resolve_comments';
    const { service, user, access } = await authorizeCollaborationRequest(
      request,
      input.workspace_id,
      permission,
      true
    );
    requireCollaborationEntitlement(access, 'collaboration_advanced_reviews', true);
    const round = await service
      .from('collaboration_review_rounds')
      .select('*')
      .eq('workspace_id', input.workspace_id)
      .eq('document_id', documentId)
      .eq('id', input.review_round_id)
      .maybeSingle();
    if (round.error) throw round.error;
    if (!round.data)
      throw new OrganizationApiError(404, 'review_not_found', 'La ronda de revision no existe.');
    if (input.action === 'approve' && round.data.blocking_comments_required) {
      const blocking = await service
        .from('collaboration_comments')
        .select('id', { count: 'exact', head: true })
        .eq('review_round_id', input.review_round_id)
        .eq('is_blocking', true)
        .eq('status', 'open');
      if (blocking.error) throw blocking.error;
      if ((blocking.count || 0) > 0)
        throw new OrganizationApiError(
          409,
          'blocking_comments',
          'Resuelve los comentarios bloqueantes antes de aprobar.'
        );
    }
    const nextStatus =
      input.action === 'approve'
        ? 'approved'
        : input.action === 'request_changes'
          ? 'changes_requested'
          : 'closed';
    const result = await service
      .from('collaboration_review_rounds')
      .update({
        status: nextStatus,
        decision_note: input.note || null,
        decided_by: user.id,
        decided_at: new Date().toISOString(),
      })
      .eq('id', input.review_round_id)
      .eq('workspace_id', input.workspace_id)
      .eq('optimistic_version', input.optimistic_version)
      .select('*')
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data)
      throw new OrganizationApiError(
        409,
        'version_conflict',
        'La ronda cambio en otra sesion. Actualiza y vuelve a intentarlo.'
      );
    if (input.action === 'approve') {
      const approvedVersion = await service
        .from('document_versions')
        .update({ status: 'approved' })
        .eq('workspace_id', input.workspace_id)
        .eq('document_id', documentId)
        .eq('id', round.data.document_version_id)
        .eq('status', 'in_review');
      if (approvedVersion.error) throw approvedVersion.error;
    }
    await recordCollaborationAudit(service, {
      workspaceId: input.workspace_id,
      actorUserId: user.id,
      eventType: `collaboration.review_${input.action}`,
      resourceType: 'review_round',
      resourceId: input.review_round_id,
      summary: `La ronda de revision cambio a ${nextStatus}.`,
      payload: { note: input.note || null },
    });
    return Response.json({ success: true, data: result.data });
  } catch (error) {
    return organizationApiFailure(error);
  }
}
