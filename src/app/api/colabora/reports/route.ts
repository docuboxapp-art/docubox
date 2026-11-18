import { z } from 'zod';
import { exportCollaborationReport } from '@/lib/collaboration/report-export';
import { organizationApiFailure } from '@/lib/organization/server';
import {
  authorizeCollaborationRequest,
  recordCollaborationAudit,
  requireCollaborationEntitlement,
} from '@/lib/collaboration/server';

export const runtime = 'nodejs';

const querySchema = z.object({
  workspace_id: z.string().uuid(),
  format: z.enum(['json', 'csv', 'pdf', 'xlsx']).default('json'),
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
    const permission = query.format !== 'json' ? 'reports.export' : 'reports.view';
    const {
      service: auditService,
      userClient: service,
      user,
      access,
    } = await authorizeCollaborationRequest(
      request,
      query.workspace_id,
      permission,
      query.format !== 'json'
    );
    requireCollaborationEntitlement(access, 'collaboration_analytics', false, {
      minimumLevel: query.scope,
      proFeature: query.scope === 'advanced',
    });
    const now = new Date().toISOString();
    const activeTasks = () =>
      service
        .from('tareas')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', query.workspace_id)
        .not('estado', 'in', '(completada,cancelada,rechazada)');
    const [tasks, overdue, blocked, reviews, spaces, requests, rooms] = await Promise.all([
      activeTasks(),
      activeTasks().lt('due_date', now),
      activeTasks().or('is_blocked.eq.true,estado.eq.bloqueada'),
      service
        .from('collaboration_review_rounds')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', query.workspace_id)
        .not('status', 'in', '(approved,closed,cancelled)'),
      service
        .from('collaboration_spaces')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', query.workspace_id)
        .eq('status', 'active'),
      service
        .from('collaboration_document_requests')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', query.workspace_id)
        .not('status', 'in', '(completed,cancelled,expired)'),
      query.scope === 'advanced'
        ? service
            .from('collaboration_rooms')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', query.workspace_id)
            .eq('status', 'active')
        : Promise.resolve({ count: 0, error: null }),
    ]);
    for (const result of [tasks, overdue, blocked, reviews, spaces, requests, rooms])
      if (result.error) throw result.error;
    const total = tasks.count || 0;
    const rows = [
      { metric: 'Trabajo abierto', value: total },
      { metric: 'Fuera de plazo', value: overdue.count || 0 },
      { metric: 'Tareas bloqueadas', value: blocked.count || 0 },
      { metric: 'Revisiones abiertas', value: reviews.count || 0 },
      { metric: 'Espacios activos', value: spaces.count || 0 },
      { metric: 'Solicitudes abiertas', value: requests.count || 0 },
    ];
    if (query.scope === 'advanced')
      rows.push(
        {
          metric: 'Cumplimiento SLA (%)',
          value: total ? Math.round(((total - (overdue.count || 0)) / total) * 100) : 100,
        },
        { metric: 'Salas activas', value: rooms.count || 0 }
      );
    if (query.format !== 'json') {
      const generatedAt = new Date().toISOString();
      const file = await exportCollaborationReport(rows, query.format, generatedAt, query.scope);
      await recordCollaborationAudit(auditService, {
        workspaceId: query.workspace_id,
        actorUserId: user.id,
        eventType: 'collaboration.report_exported',
        resourceType: 'collaboration_report',
        summary: 'Se exporto el reporte operativo agregado.',
        payload: { format: query.format, scope: query.scope, row_count: rows.length },
      });
      return new Response(new Uint8Array(file.bytes), {
        headers: {
          'Content-Type': file.contentType,
          'Content-Disposition': `attachment; filename="docubox-colabora-${generatedAt.slice(0, 10)}.${query.format}"`,
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
