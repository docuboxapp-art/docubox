import { z } from 'zod';
import { organizationApiFailure } from '@/lib/organization/server';
import {
  authorizeCollaborationRequest,
  recordCollaborationAudit,
  requireCollaborationEntitlement,
} from '@/lib/collaboration/server';

export const runtime = 'nodejs';

const querySchema = z.object({
  workspace_id: z.string().uuid(),
  format: z.enum(['json', 'csv']).default('json'),
  scope: z.enum(['basic', 'advanced']).default('basic'),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = querySchema.parse({
      workspace_id: url.searchParams.get('workspace_id'),
      format: url.searchParams.get('format') || 'json',
      scope: url.searchParams.get('scope') || 'basic',
    });
    const permission = query.format === 'csv' ? 'reports.export' : 'reports.view';
    const { service, user, access } = await authorizeCollaborationRequest(
      request,
      query.workspace_id,
      permission,
      query.format === 'csv'
    );
    requireCollaborationEntitlement(access, 'collaboration_analytics', false, {
      minimumLevel: query.scope,
      proFeature: query.scope === 'advanced',
    });
    const [tasks, reviews, spaces, requests] = await Promise.all([
      service
        .from('tareas')
        .select('estado,prioridad,due_date')
        .eq('workspace_id', query.workspace_id),
      service
        .from('document_review_rounds')
        .select('status')
        .eq('workspace_id', query.workspace_id),
      service.from('collaboration_spaces').select('status').eq('workspace_id', query.workspace_id),
      service
        .from('collaboration_document_requests')
        .select('status')
        .eq('workspace_id', query.workspace_id),
    ]);
    for (const result of [tasks, reviews, spaces, requests])
      if (result.error) throw result.error;
    const now = Date.now();
    const openTasks = (tasks.data || []).filter(
      (item) => !['completada', 'cancelada', 'rechazada'].includes(item.estado)
    );
    const rows = [
      { metric: 'Trabajo abierto', value: openTasks.length },
      {
        metric: 'Fuera de plazo',
        value: openTasks.filter((item) => item.due_date && new Date(item.due_date).getTime() < now)
          .length,
      },
      {
        metric: 'Tareas bloqueadas',
        value: openTasks.filter((item) => item.estado === 'bloqueada').length,
      },
      {
        metric: 'Revisiones abiertas',
        value: (reviews.data || []).filter(
          (item) => !['approved', 'rejected', 'cancelled'].includes(item.status)
        ).length,
      },
      {
        metric: 'Espacios activos',
        value: (spaces.data || []).filter((item) => item.status === 'active').length,
      },
      {
        metric: 'Solicitudes abiertas',
        value: (requests.data || []).filter(
          (item) => !['completed', 'cancelled', 'expired'].includes(item.status)
        ).length,
      },
    ];
    if (query.scope === 'advanced') {
      const rooms = await service
        .from('collaboration_rooms')
        .select('status')
        .eq('workspace_id', query.workspace_id);
      if (rooms.error) throw rooms.error;
      const onTime = openTasks.filter(
        (item) => !item.due_date || new Date(item.due_date).getTime() >= now,
      ).length;
      rows.push(
        {
          metric: 'Cumplimiento SLA (%)',
          value: openTasks.length ? Math.round((onTime / openTasks.length) * 100) : 100,
        },
        {
          metric: 'Salas activas',
          value: (rooms.data || []).filter((item) => item.status === 'active').length,
        },
      );
    }
    if (query.format === 'csv') {
      await recordCollaborationAudit(service, {
        workspaceId: query.workspace_id,
        actorUserId: user.id,
        eventType: 'collaboration.report_exported',
        resourceType: 'collaboration_report',
        summary: 'Se exporto el reporte operativo agregado.',
        payload: { format: 'csv', scope: query.scope, row_count: rows.length },
      });
      const csv = ['Indicador,Valor', ...rows.map((row) => `"${row.metric}",${row.value}`)].join(
        '\r\n'
      );
      return new Response(`\uFEFF${csv}`, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="docubox-colabora-${new Date().toISOString().slice(0, 10)}.csv"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }
    return Response.json({
      success: true,
      data: { generated_at: new Date().toISOString(), report_level: query.scope, rows },
    });
  } catch (error) {
    return organizationApiFailure(error);
  }
}
