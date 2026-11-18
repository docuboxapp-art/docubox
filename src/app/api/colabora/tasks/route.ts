import { assertCollaborationCreationReferences } from '@/lib/collaboration/references.server';
import { z } from 'zod';
import { createNotificationServer } from '@/lib/notificationsInApp.server';
import { organizationApiFailure } from '@/lib/organization/server';
import {
  authorizeCollaborationRequest,
  assertCollaborationCreationScope,
  recordCollaborationAudit,
} from '@/lib/collaboration/server';

export const runtime = 'nodejs';
const listSchema = z.object({
  workspace_id: z.string().uuid(),
  status: z
    .enum([
      'nueva',
      'pendiente',
      'en_proceso',
      'bloqueada',
      'en_revision',
      'vencida',
      'escalada',
      'completada',
      'cancelada',
      'rechazada',
    ])
    .optional(),
  assignee: z.string().uuid().optional(),
  priority: z.enum(['critica', 'alta', 'media', 'baja']).optional(),
  due: z.enum(['overdue', 'soon']).optional(),
  mine: z.enum(['1']).optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(50),
});

const taskSchema = z.object({
  workspace_id: z.string().uuid(),
  title: z.string().trim().min(3).max(240),
  description: z.string().trim().max(5000).nullable().optional(),
  tipo: z
    .enum([
      'firmar_documento',
      'revisar_documento',
      'aprobar_documento',
      'subir_anexo',
      'validar_identidad',
      'corregir_datos',
      'resolver_comentario',
      'confirmar_lectura',
      'descargar_constancia',
      'validar_efirma',
      'obtener_nom151',
      'cerrar_expediente',
    ])
    .default('revisar_documento'),
  prioridad: z.enum(['critica', 'alta', 'media', 'baja']).default('media'),
  assigned_to: z.string().uuid().nullable().optional(),
  assigned_team_id: z.string().uuid().nullable().optional(),
  due_date: z.string().datetime().nullable().optional(),
  collaboration_space_id: z.string().uuid().nullable().optional(),
  source_type: z.string().trim().max(80).nullable().optional(),
  source_id: z.string().uuid().nullable().optional(),
  confidentiality: z.enum(['private', 'internal', 'shared', 'formal']).default('internal'),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = listSchema.parse(Object.fromEntries(url.searchParams));
    const { workspace_id: workspaceId, status, assignee, search } = filters;
    const { userClient: service, user } = await authorizeCollaborationRequest(
      request,
      workspaceId,
      'tasks.view'
    );

    let query = service
      .from('tareas')
      .select(
        'id,title,description,tipo,prioridad,estado,riesgo,due_date,sla,sla_due_at,is_overdue,is_blocked,blocked_reason,assigned_to,assigned_team_id,responsible_name,creator_name,document_name,document_id,expediente_id,expediente_name,tags,collaboration_space_id,confidentiality,optimistic_version,created_at,updated_at',
        { count: 'exact' }
      )
      .eq('workspace_id', workspaceId)
      .order('is_overdue', { ascending: false })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('id')
      .range((filters.page - 1) * filters.page_size, filters.page * filters.page_size - 1);
    if (status) query = query.eq('estado', status);
    if (assignee) query = query.eq('assigned_to', assignee);
    if (filters.mine === '1') query = query.eq('assigned_to', user.id);
    if (filters.priority) query = query.eq('prioridad', filters.priority);
    if (filters.due) {
      const now = new Date();
      query = query.not('estado', 'in', '(completada,cancelada,rechazada)');
      query =
        filters.due === 'overdue'
          ? query.lt('due_date', now.toISOString())
          : query
              .gte('due_date', now.toISOString())
              .lte('due_date', new Date(now.getTime() + 72 * 3600000).toISOString());
    }
    if (search)
      query = query.or(
        `title.ilike.%${search.replace(/[%_,()"'\\\r\n]/g, '')}%,description.ilike.%${search.replace(/[%_,()"'\\\r\n]/g, '')}%`
      );
    const result = await query;
    if (result.error) throw result.error;
    return Response.json(
      {
        success: true,
        data: result.data || [],
        total: result.count ?? 0,
        page: filters.page,
        page_size: filters.page_size,
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return organizationApiFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = taskSchema.parse(await request.json());
    const { service, user, userClient } = await authorizeCollaborationRequest(
      request,
      input.workspace_id,
      'tasks.create',
      true
    );
    await assertCollaborationCreationReferences(service, input.workspace_id, input);
    await assertCollaborationCreationScope(
      userClient,
      input.workspace_id,
      'tasks.create',
      'task',
      user.id,
      input
    );
    const [profile, assignee] = await Promise.all([
      service.from('user_profiles').select('full_name').eq('id', user.id).maybeSingle(),
      input.assigned_to
        ? service
            .from('user_profiles')
            .select('full_name,email')
            .eq('id', input.assigned_to)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (profile.error) throw profile.error;
    if (assignee.error) throw assignee.error;
    const result = await service
      .from('tareas')
      .insert({
        ...input,
        description: input.description || null,
        estado: 'nueva',
        riesgo: input.prioridad === 'critica' ? 'alto' : 'bajo',
        created_by: user.id,
        creator_name: profile.data?.full_name || user.email || 'Usuario',
        responsible_name: assignee.data?.full_name || assignee.data?.email || null,
        main_action: 'Abrir tarea',
        is_overdue: false,
        is_blocked: false,
        is_critical: input.prioridad === 'critica',
      })
      .select('*')
      .single();
    if (result.error) throw result.error;
    await Promise.all([
      service.from('task_history').insert({
        tarea_id: result.data.id,
        workspace_id: input.workspace_id,
        action: 'Tarea creada en Docubox Colabora',
        actor_id: user.id,
        actor_name: profile.data?.full_name || user.email || 'Usuario',
      }),
      recordCollaborationAudit(service, {
        workspaceId: input.workspace_id,
        actorUserId: user.id,
        eventType: 'collaboration.task_created',
        resourceType: 'task',
        resourceId: result.data.id,
        summary: `Se creo la tarea ${input.title}.`,
        payload: { priority: input.prioridad, assignee: input.assigned_to || null },
      }),
    ]);
    if (input.assigned_to && input.assigned_to !== user.id) {
      void createNotificationServer({
        userId: input.assigned_to,
        type: 'task',
        eventType: 'task.assigned',
        title: 'Se te asignó una tarea',
        description: `Tienes asignada la tarea "${result.data.title}".`,
        priority: input.prioridad === 'critica' || input.prioridad === 'alta' ? 'alta' : 'media',
        workspaceId: input.workspace_id,
        actorUserId: user.id,
        entityType: 'task',
        entityId: result.data.id,
        actionUrl: `/colabora/tareas/${result.data.id}`,
        actionLabel: 'Abrir tarea',
        metadata: {
          taskId: result.data.id,
          dueDate: input.due_date || null,
          priority: input.prioridad,
        },
        deduplicationKey: `task.assigned:${result.data.id}:${input.assigned_to}`,
      }).catch((error) => {
        console.error('[tasks] Assignment notification could not be created', error);
      });
    }
    return Response.json({ success: true, data: result.data }, { status: 201 });
  } catch (error) {
    return organizationApiFailure(error);
  }
}
