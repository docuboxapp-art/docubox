import { z } from 'zod';
import { createHash } from 'node:crypto';
import { createNotificationServer } from '@/lib/notificationsInApp.server';
import {
  authorizeCollaborationRequest,
  recordCollaborationAudit,
} from '@/lib/collaboration/server';
import { organizationApiFailure } from '@/lib/organization/server';
export const runtime = 'nodejs';
const inputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    action: z.enum(['start', 'request_review', 'reassign', 'update']),
    items: z
      .array(z.object({ id: z.string().uuid(), optimistic_version: z.number().int().positive() }))
      .min(1)
      .max(25),
    assigned_to: z.string().uuid().optional(),
    prioridad: z.enum(['critica', 'alta', 'media', 'baja']).optional(),
    due_date: z.string().datetime().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.items.map((item) => item.id)).size !== value.items.length)
      ctx.addIssue({ code: 'custom', message: 'Selecciona cada tarea una sola vez.' });
    if (value.action === 'reassign' && !value.assigned_to)
      ctx.addIssue({ code: 'custom', message: 'Selecciona un responsable.' });
    if (value.action === 'update' && !value.prioridad && value.due_date === undefined)
      ctx.addIssue({ code: 'custom', message: 'Selecciona prioridad o vencimiento.' });
  });
export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await request.json());
    const { service, user } = await authorizeCollaborationRequest(
      request,
      input.workspace_id,
      input.action === 'reassign' ? 'tasks.assign' : 'tasks.edit',
      true
    );
    const changes = {
      ...(input.assigned_to !== undefined ? { assigned_to: input.assigned_to } : {}),
      ...(input.prioridad ? { prioridad: input.prioridad } : {}),
      ...(input.due_date !== undefined ? { due_date: input.due_date } : {}),
    };
    const { data, error } = await service.rpc('colabora_bulk_mutate_tasks', {
      ws: input.workspace_id,
      actor: user.id,
      items: input.items,
      action: input.action,
      changes,
    });
    if (error) throw error;
    const results = data as Array<{
      id: string;
      success: boolean;
      code?: string;
      data?: { optimistic_version?: number };
    }>;
    const succeeded = results.filter((item) => item.success).length;
    let notificationStatus = 'not_requested';
    if (input.assigned_to && input.assigned_to !== user.id && succeeded) {
      const fingerprint = createHash('sha256')
        .update(
          results
            .filter((item) => item.success)
            .map((item) => `${item.id}:${item.data?.optimistic_version || 0}`)
            .sort()
            .join('|')
        )
        .digest('hex');
      try {
        await createNotificationServer({
          userId: input.assigned_to,
          type: 'task',
          eventType: 'task.reassigned',
          title: succeeded === 1 ? 'Se te asignó una tarea' : `Se te asignaron ${succeeded} tareas`,
          description: 'Consulta las tareas asignadas en Docubox Colabora.',
          priority: 'media',
          workspaceId: input.workspace_id,
          actorUserId: user.id,
          entityType: 'task',
          entityId: results.find((item) => item.success)!.id,
          actionUrl: '/colabora/tareas',
          actionLabel: 'Ver tareas',
          deduplicationKey: `task.bulk_assigned:${fingerprint}:${input.assigned_to}`,
          metadata: { count: succeeded },
        });
        notificationStatus = 'queued';
      } catch {
        notificationStatus = 'failed';
      }
    }
    await recordCollaborationAudit(service, {
      workspaceId: input.workspace_id,
      actorUserId: user.id,
      eventType: 'collaboration.tasks_bulk_updated',
      resourceType: 'task',
      summary: 'Se procesó una actualización de tareas por lote.',
      payload: {
        action: input.action,
        total: results.length,
        succeeded,
        failed: results.length - succeeded,
        notification_status: notificationStatus,
      },
    });
    return Response.json(
      {
        success: true,
        data: results,
        succeeded,
        failed: results.length - succeeded,
        notification_status: notificationStatus,
      },
      {
        status: succeeded === results.length ? 200 : 207,
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );
  } catch (error) {
    return organizationApiFailure(error);
  }
}
