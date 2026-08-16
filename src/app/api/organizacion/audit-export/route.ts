import { randomUUID } from 'crypto';
import { z } from 'zod';
import { authorizeOrganizationRequest, organizationApiFailure } from '@/lib/organization/server';

export const runtime = 'nodejs';

function csvCell(value: unknown) {
  const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  const requestId = randomUUID();
  try {
    const url = new URL(request.url);
    const workspaceId = z.string().uuid().parse(url.searchParams.get('workspace_id'));
    const format = url.searchParams.get('format') === 'json' ? 'json' : 'csv';
    const query = (url.searchParams.get('q') || '').trim().slice(0, 160);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const { user, service } = await authorizeOrganizationRequest(request, workspaceId, 'audit.read');
    let selection = service.from('organization_audit_events')
      .select('id,occurred_at,actor_user_id,event_type,resource_type,resource_id,summary,outcome,severity,module,origin,correlation_id,payload,ip_address,user_agent,event_hash,previous_event_hash,sequence_number')
      .eq('workspace_id', workspaceId)
      .order('occurred_at', { ascending: false })
      .limit(5000);
    if (from) selection = selection.gte('occurred_at', new Date(from).toISOString());
    if (to) selection = selection.lte('occurred_at', new Date(to).toISOString());
    if (query) selection = selection.or(`summary.ilike.%${query.replaceAll(',', '')}%,event_type.ilike.%${query.replaceAll(',', '')}%,resource_type.ilike.%${query.replaceAll(',', '')}%`);
    const result = await selection;
    if (result.error) throw result.error;
    const rows = result.data || [];

    await service.from('organization_audit_events').insert({ workspace_id: workspaceId, actor_user_id: user.id, event_type: 'audit.export.generated', resource_type: 'organization_audit_export', summary: 'Exportación de auditoría generada', payload: { format, row_count: rows.length, filters: { query: Boolean(query), from: from || null, to: to || null } }, outcome: 'success', severity: 'high', module: 'audit', origin: 'api', correlation_id: requestId, ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null, user_agent: request.headers.get('user-agent') });

    if (format === 'json') return Response.json({ generated_at: new Date().toISOString(), workspace_id: workspaceId, row_count: rows.length, data: rows }, { headers: { 'Content-Disposition': `attachment; filename="docubox-auditoria-${new Date().toISOString().slice(0, 10)}.json"`, 'Cache-Control': 'no-store' } });
    const columns = ['sequence_number','occurred_at','actor_user_id','event_type','resource_type','resource_id','summary','outcome','severity','module','origin','correlation_id','previous_event_hash','event_hash','payload'];
    const csv = [columns.map(csvCell).join(','), ...rows.map((row: any) => columns.map((column) => csvCell(row[column])).join(','))].join('\r\n');
    return new Response(`\uFEFF${csv}`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="docubox-auditoria-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}
