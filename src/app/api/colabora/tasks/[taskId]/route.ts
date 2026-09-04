import { z } from 'zod';
import { createNotificationServer } from '@/lib/notificationsInApp.server';
import { OrganizationApiError, organizationApiFailure } from '@/lib/organization/server';
import {
  authorizeCollaborationRequest,
  recordCollaborationAudit,
} from '@/lib/collaboration/server';

export const runtime = 'nodejs';

const updateSchema = z.object({
  workspace_id: z.string().uuid(),
  optimistic_version: z.number().int().positive(),
  action: z.enum([
    'start',
    'complete',
    'block',
    'unblock',
    'request_review',
    'reopen',
    'cancel',
    'reassign',
    'update',
  ]),
  reason: z.string().trim().max(2000).nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  due_date: z.string().datetime().nullable().optional(),
  prioridad: z.enum(['critica', 'alta', 'media', 'baja']).optional(),
});

const checklistSchema = z.discriminatedUnion('action', [
  z.object({
    workspace_id: z.string().uuid(),
    action: z.literal('add_checklist'),
    text: z.string().trim().min(1).max(500),
  }),
  z.object({
    workspace_id: z.string().uuid(),
    action: z.literal('toggle_checklist'),
    item_id: z.string().uuid(),
    done: z.boolean(),
  }),
]);

const commentSchema = z.object({
  workspace_id: z.string().uuid(),
  action: z.literal('comment'),
  text: z.string().trim().min(1).max(10000),
  audience: z.enum(['private', 'internal', 'shared', 'formal']).default('internal'),
  recipient_ids: z.array(z.string().uuid()).max(100).default([]),
  parent_id: z.string().uuid().nullable().optional(),
});

export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await context.params;
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspace_id') || '';
    const { service } = await authorizeCollaborationRequest(request, workspaceId, 'tasks.view');
    const [task, checklist, comments, attachments, history, dependencies, collaborators] =
      await Promise.all([
        service
          .from('tareas')
          .select('*')
          .eq('workspace_id', workspaceId)
          .eq('id', taskId)
          .maybeSingle(),
        service
          .from('task_checklist_items')
          .select('*')
          .eq('workspace_id', workspaceId)
          .eq('tarea_id', taskId)
          .order('position'),
        service
          .from('task_comments')
          .select('*')
          .eq('workspace_id', workspaceId)
          .eq('tarea_id', taskId)
          .order('created_at'),
        service
          .from('task_attachments')
          .select('*')
          .eq('workspace_id', workspaceId)
          .eq('tarea_id', taskId)
          .order('created_at'),
        service
          .from('task_history')
          .select('*')
          .eq('workspace_id', workspaceId)
          .eq('tarea_id', taskId)
          .order('created_at', { ascending: false }),
        service
          .from('task_dependencies')
          .select('*,depends_on:tareas!task_dependencies_depends_on_id_fkey(id,title,estado)')
          .eq('workspace_id', workspaceId)
          .eq('tarea_id', taskId),
        service
          .from('task_collaborators')
          .select('*,user_profiles(full_name,email)')
          .eq('workspace_id', workspaceId)
          .eq('task_id', taskId),
      ]);
    for (const result of [
      task,
      checklist,
      comments,
      attachments,
      history,
      dependencies,
      collaborators,
    ]) {
      if (result.error) throw result.error;
    }
    if (!task.data)
      throw new OrganizationApiError(
        404,
        'task_not_found',
        'La tarea no existe o no esta disponible.'
      );
    return Response.json({
      success: true,
      data: {
        task: task.data,
        checklist: checklist.data || [],
        comments: comments.data || [],
        attachments: attachments.data || [],
        history: history.data || [],
        dependencies: dependencies.data || [],
        collaborators: collaborators.data || [],
      },
    });
  } catch (error) {
    return organizationApiFailure(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await context.params;
    const body = await request.json();
    if (body?.action === 'comment') {
      const input = commentSchema.parse(body);
      const { service, user } = await authorizeCollaborationRequest(
        request,
        input.workspace_id,
        'tasks.edit',
        true
      );
      const profile = await service
        .from('user_profiles')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle();
      const result = await service
        .from('task_comments')
        .insert({
          tarea_id: taskId,
          workspace_id: input.workspace_id,
          author_id: user.id,
          author_name: profile.data?.full_name || user.email || 'Usuario',
          author_avatar: '',
          text: input.text,
          audience: input.audience,
          recipient_ids: input.recipient_ids,
          parent_id: input.parent_id || null,
          is_formal: input.audience === 'formal',
        })
        .select('*')
        .single();
      if (result.error) throw result.error;
      await service.from('task_history').insert({
        tarea_id: taskId,
        workspace_id: input.workspace_id,
        action: 'Comentario agregado',
        actor_id: user.id,
        actor_name: profile.data?.full_name || user.email || 'Usuario',
        metadata: { audience: input.audience },
      });
      return Response.json({ success: true, data: result.data });
    }

    if (body?.action === 'add_checklist' || body?.action === 'toggle_checklist') {
      const input = checklistSchema.parse(body);
      const { service, user } = await authorizeCollaborationRequest(
        request,
        input.workspace_id,
        'tasks.edit',
        true
      );
      const task = await service
        .from('tareas')
        .select('id,title')
        .eq('workspace_id', input.workspace_id)
        .eq('id', taskId)
        .maybeSingle();
      if (task.error) throw task.error;
      if (!task.data)
        throw new OrganizationApiError(
          404,
          'task_not_found',
          'La tarea no existe o no esta disponible.'
        );
      let result;
      if (input.action === 'add_checklist') {
        const position = await service
          .from('task_checklist_items')
          .select('position')
          .eq('workspace_id', input.workspace_id)
          .eq('tarea_id', taskId)
          .order('position', { ascending: false })
          .limit(1);
        if (position.error) throw position.error;
        result = await service
          .from('task_checklist_items')
          .insert({
            tarea_id: taskId,
            workspace_id: input.workspace_id,
            text: input.text,
            position: Number(position.data?.[0]?.position || 0) + 1,
            created_by: user.id,
          })
          .select('*')
          .single();
      } else {
        result = await service
          .from('task_checklist_items')
          .update({ done: input.done })
          .eq('id', input.item_id)
          .eq('workspace_id', input.workspace_id)
          .eq('tarea_id', taskId)
          .select('*')
          .maybeSingle();
      }
      if (result.error) throw result.error;
      if (!result.data)
        throw new OrganizationApiError(
          404,
          'checklist_item_not_found',
          'El elemento no existe o no esta disponible.'
        );
      await recordCollaborationAudit(service, {
        workspaceId: input.workspace_id,
        actorUserId: user.id,
        eventType: `collaboration.task_${input.action}`,
        resourceType: 'task',
        resourceId: taskId,
        summary: `Se actualizo el checklist de ${task.data.title}.`,
        payload: { item_id: result.data.id, done: result.data.done },
      });
      return Response.json({ success: true, data: result.data });
    }

    const input = updateSchema.parse(body);
    const permission =
      input.action === 'complete'
        ? 'tasks.complete'
        : input.action === 'cancel'
          ? 'tasks.cancel'
          : input.action === 'reassign'
            ? 'tasks.assign'
            : 'tasks.edit';
    const { service, user } = await authorizeCollaborationRequest(
      request,
      input.workspace_id,
      permission,
      true
    );
    const current = await service
      .from('tareas')
      .select('id,title,estado,is_blocked,assigned_to,created_by')
      .eq('id', taskId)
      .eq('workspace_id', input.workspace_id)
      .maybeSingle();
    if (current.error) throw current.error;
    if (!current.data)
      throw new OrganizationApiError(
        404,
        'task_not_found',
        'La tarea no existe o no esta disponible.'
      );
    if (input.action === 'complete' && current.data.is_blocked)
      throw new OrganizationApiError(
        409,
        'task_blocked',
        'Desbloquea la tarea antes de completarla.'
      );
    if (['block', 'cancel', 'reopen'].includes(input.action) && !input.reason)
      throw new OrganizationApiError(400, 'reason_required', 'Indica el motivo de esta accion.');

    const transitions: Record<string, string> = {
      start: 'en_proceso',
      complete: 'completada',
      block: 'bloqueada',
      unblock: 'pendiente',
      request_review: 'en_revision',
      reopen: 'pendiente',
      cancel: 'cancelada',
    };
    const update: Record<string, unknown> = {};
    if (transitions[input.action]) update.estado = transitions[input.action];
    if (input.action === 'block') {
      update.is_blocked = true;
      update.blocked_reason = input.reason || 'Bloqueada por el usuario';
    }
    if (input.action === 'unblock') {
      update.is_blocked = false;
      update.blocked_reason = null;
    }
    if (input.action === 'complete') update.completed_at = new Date().toISOString();
    if (input.action === 'reopen') {
      update.completed_at = null;
      update.cancelled_at = null;
    }
    if (input.action === 'cancel') {
      update.cancelled_at = new Date().toISOString();
      update.blocked_reason = input.reason || null;
    }
    if (input.assigned_to !== undefined) update.assigned_to = input.assigned_to;
    if (input.due_date !== undefined) update.due_date = input.due_date;
    if (input.prioridad) update.prioridad = input.prioridad;

    const result = await service
      .from('tareas')
      .update(update)
      .eq('id', taskId)
      .eq('workspace_id', input.workspace_id)
      .eq('optimistic_version', input.optimistic_version)
      .select('*')
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data)
      throw new OrganizationApiError(
        409,
        'version_conflict',
        'La tarea cambio en otra sesion. Actualiza y vuelve a intentarlo.'
      );
    const profile = await service
      .from('user_profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();
    await service.from('task_history').insert({
      tarea_id: taskId,
      workspace_id: input.workspace_id,
      action: `Tarea: ${input.action}`,
      actor_id: user.id,
      actor_name: profile.data?.full_name || user.email || 'Usuario',
      metadata: { reason: input.reason || null },
    });
    await recordCollaborationAudit(service, {
      workspaceId: input.workspace_id,
      actorUserId: user.id,
      eventType: `collaboration.task_${input.action}`,
      resourceType: 'task',
      resourceId: taskId,
      summary: `Se actualizo la tarea ${result.data.title}.`,
      payload: { action: input.action, reason: input.reason || null },
    });
    const assignee = result.data.assigned_to as string | null;
    const taskRecipient = assignee && assignee !== user.id ? assignee : null;
    const eventType =
      input.action === 'reassign'
        ? 'task.reassigned'
        : input.action === 'block'
          ? 'task.blocked'
          : input.action === 'unblock'
            ? 'task.unblocked'
            : input.action === 'complete'
              ? 'task.completed'
              : input.action === 'cancel'
                ? 'task.cancelled'
                : null;
    if (taskRecipient && eventType) {
      const messages: Record<
        string,
        { title: string; description: string; priority: 'alta' | 'media' | 'baja' }
      > = {
        'task.reassigned': {
          title: 'Se te reasignó una tarea',
          description: `Ahora eres responsable de "${result.data.title}".`,
          priority: 'media',
        },
        'task.blocked': {
          title: 'Una tarea asignada está bloqueada',
          description: `"${result.data.title}" requiere atención antes de continuar.`,
          priority: 'alta',
        },
        'task.unblocked': {
          title: 'Una tarea fue desbloqueada',
          description: `Puedes continuar con "${result.data.title}".`,
          priority: 'media',
        },
        'task.completed': {
          title: 'Tarea completada',
          description: `La tarea "${result.data.title}" fue completada.`,
          priority: 'baja',
        },
        'task.cancelled': {
          title: 'Tarea cancelada',
          description: `La tarea "${result.data.title}" fue cancelada.`,
          priority: 'media',
        },
      };
      const message = messages[eventType];
      void createNotificationServer({
        userId: taskRecipient,
        type: eventType === 'task.blocked' || eventType === 'task.cancelled' ? 'alert' : 'task',
        eventType,
        title: message.title,
        description: message.description,
        priority: message.priority,
        workspaceId: input.workspace_id,
        actorUserId: user.id,
        entityType: 'task',
        entityId: taskId,
        actionUrl: `/colabora/tareas/${taskId}`,
        actionLabel: 'Abrir tarea',
        metadata: { taskId, reason: input.reason || null },
        deduplicationKey: `${eventType}:${taskId}:${result.data.optimistic_version}:${taskRecipient}`,
      }).catch((error) => {
        console.error('[tasks] State notification could not be created', error);
      });
    }
    return Response.json({ success: true, data: result.data });
  } catch (error) {
    return organizationApiFailure(error);
  }
}
