import { NextRequest, NextResponse } from 'next/server';
import {
  appendTemplateAuditEvent,
  assertTemplateActionAllowed,
  buildTemplateMutationPayload,
  deriveTemplateState,
  parseTemplateAction,
  resolveTemplatePublicationContext,
  startTemplateApprovalWorkflow,
  templateActionEvent,
  templateApiFailure,
} from '@/lib/templates/publication-server';
import { selectLatestTemplateVersions } from '@/lib/templates/versioning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspace_id') || '';
    const context = await resolveTemplatePublicationContext(request, workspaceId);
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const latestOnly = searchParams.get('latest_only') === 'true';

    let query = context.service
      .from('plantillas')
      .select(
        '*, tipo_documento:tipo_documento_id(id, nombre), grupo_tipo:grupo_tipo_id(id, nombre)'
      )
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false });

    if (context.workspace.workspace_type === 'personal') {
      query = query.eq('created_by', context.user.id);
    }
    if (status) query = query.eq('estado', status);
    if (search) query = query.ilike('nombre', `%${search}%`);

    const { data, error } = await query;
    if (error) throw error;
    const responseData = latestOnly ? selectLatestTemplateVersions(data || []) : data;
    return NextResponse.json(
      { data: responseData },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (cause) {
    return templateApiFailure(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
    const context = await resolveTemplatePublicationContext(request, workspaceId);
    const action = parseTemplateAction(body.publicacionOpcion);
    assertTemplateActionAllowed(context, action, true);

    const state = deriveTemplateState(action);
    const persistedState = action === 'aprobacion' ? deriveTemplateState('borrador') : state;
    const payload = {
      ...buildTemplateMutationPayload(body, context, persistedState, '1.0'),
      created_by: context.user.id,
      workspace_id: workspaceId,
    };
    const created = await context.service.from('plantillas').insert(payload).select().single();
    if (created.error) throw created.error;
    let responseData = created.data;
    let workflowInstanceId: string | null = null;
    if (action === 'aprobacion') {
      workflowInstanceId = await startTemplateApprovalWorkflow(
        context,
        created.data.id,
        typeof body.comentarioPublicacion === 'string' ? body.comentarioPublicacion : null
      );
      responseData = {
        ...created.data,
        estado: state.estado,
        estado_plantilla: state.estadoPlantilla,
        publicacion_opcion: state.publicacionOpcion,
        approval_workflow_id: context.approvalWorkflow?.id || null,
        approval_workflow_instance_id: workflowInstanceId,
      };
    }

    const event = templateActionEvent(state.publicacionOpcion);
    await appendTemplateAuditEvent(context, {
      ...event,
      templateId: created.data.id,
      request,
      payload: {
        status: state.estado,
        version: '1.0',
        workflow_id: context.approvalWorkflow?.id || null,
        workflow_instance_id: workflowInstanceId,
      },
    });

    return NextResponse.json(
      { data: responseData },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (cause) {
    return templateApiFailure(cause);
  }
}
