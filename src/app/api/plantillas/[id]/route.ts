import { NextRequest, NextResponse } from 'next/server';
import { OrganizationApiError } from '@/lib/organization/server';
import {
  appendTemplateAuditEvent,
  assertTemplateActionAllowed,
  buildTemplateMutationPayload,
  deriveTemplateState,
  nextTemplateVersion,
  parseTemplateAction,
  resolveTemplateVersionTarget,
  resolveTemplatePublicationContext,
  startTemplateApprovalWorkflow,
  templateActionEvent,
  templateApiFailure,
} from '@/lib/templates/publication-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const workspaceId = new URL(request.url).searchParams.get('workspace_id') || '';
    const context = await resolveTemplatePublicationContext(request, workspaceId, id);
    const result = await context.service
      .from('plantillas')
      .select(
        '*, tipo_documento:tipo_documento_id(id, nombre), grupo_tipo:grupo_tipo_id(id, nombre)'
      )
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .single();
    if (result.error) throw result.error;
    return NextResponse.json(
      { data: result.data },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (cause) {
    return templateApiFailure(cause);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
    const context = await resolveTemplatePublicationContext(request, workspaceId, id);
    const source = context.template;
    if (!source)
      throw new OrganizationApiError(404, 'template_not_found', 'Plantilla no encontrada.');

    const action = parseTemplateAction(body.publicacionOpcion);
    assertTemplateActionAllowed(context, action, false);

    if (action === 'actualizar' || action === 'version') {
      const rootTemplateId = source.root_template_id || source.id;
      const versions = await context.service
        .from('plantillas')
        .select('version_publicada')
        .eq('workspace_id', workspaceId)
        .or(`id.eq.${rootTemplateId},root_template_id.eq.${rootTemplateId}`);
      if (versions.error) throw versions.error;
      const version =
        action === 'actualizar'
          ? source.version_publicada || '1.0'
          : nextTemplateVersion((versions.data || []).map((item) => item.version_publicada));
      const versionTarget = resolveTemplateVersionTarget(context, body.versionTargetAction);
      const state = deriveTemplateState(versionTarget);
      const persistedState =
        versionTarget === 'aprobacion' ? deriveTemplateState('borrador') : state;
      const payload = {
        ...buildTemplateMutationPayload(body, context, persistedState, version),
        created_by: context.user.id,
        workspace_id: workspaceId,
        source_template_id: source.id,
        root_template_id: rootTemplateId,
      };
      const created = await context.service.from('plantillas').insert(payload).select().single();
      if (created.error) throw created.error;
      let responseData = created.data;
      let workflowInstanceId: string | null = null;
      if (versionTarget === 'aprobacion') {
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
      await appendTemplateAuditEvent(context, {
        eventType: 'template.version.created',
        summary: 'Nueva versión de plantilla creada',
        templateId: created.data.id,
        request,
        payload: {
          source_template_id: source.id,
          version,
          version_mode: action === 'actualizar' ? 'replace' : 'increment',
          status: state.estado,
          workflow_id: context.approvalWorkflow?.id || null,
          workflow_instance_id: workflowInstanceId,
        },
      });
      return NextResponse.json(
        { data: responseData, createdVersion: true },
        { headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    const sourceIsPublished =
      source.estado === 'published' || source.estado_plantilla === 'Publicada';
    if (sourceIsPublished) {
      throw new OrganizationApiError(
        409,
        'published_template_is_immutable',
        'La plantilla publicada no se modifica directamente. Crea una nueva versión.'
      );
    }

    const state = deriveTemplateState(action);
    const persistedState = action === 'aprobacion' ? deriveTemplateState('borrador') : state;
    const previousVersion = source.version_publicada || '1.0';
    const payload = buildTemplateMutationPayload(body, context, persistedState, previousVersion);
    const classificationChanged =
      source.area_responsable !== payload.area_responsable ||
      source.tipo_plantilla !== payload.tipo_plantilla;
    const updated = await context.service
      .from('plantillas')
      .update(payload)
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .select()
      .single();
    if (updated.error) throw updated.error;
    let responseData = updated.data;
    let workflowInstanceId: string | null = null;
    if (action === 'aprobacion') {
      workflowInstanceId = await startTemplateApprovalWorkflow(
        context,
        id,
        typeof body.comentarioPublicacion === 'string' ? body.comentarioPublicacion : null
      );
      responseData = {
        ...updated.data,
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
      templateId: id,
      request,
      payload: {
        status: state.estado,
        version: previousVersion,
        workflow_id: context.approvalWorkflow?.id || null,
        workflow_instance_id: workflowInstanceId,
      },
    });
    if (classificationChanged) {
      await appendTemplateAuditEvent(context, {
        eventType: 'template.classification.changed',
        summary: 'Clasificación de plantilla actualizada',
        templateId: id,
        request,
        payload: {
          area_responsable: payload.area_responsable,
          tipo_plantilla: payload.tipo_plantilla,
        },
      });
    }

    return NextResponse.json(
      { data: responseData },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (cause) {
    return templateApiFailure(cause);
  }
}

async function archiveTemplate(request: NextRequest, id: string, workspaceId: string) {
  const context = await resolveTemplatePublicationContext(request, workspaceId, id);
  const source = context.template;
  if (!source) {
    throw new OrganizationApiError(404, 'template_not_found', 'Plantilla no encontrada.');
  }
  if (source.estado === 'archived') {
    return NextResponse.json({
      data: {
        id: source.id,
        estado: source.estado,
        estado_plantilla: source.estado_plantilla,
        publicacion_opcion: source.publicacion_opcion,
      },
      alreadyArchived: true,
    });
  }

  const archived = await context.service
    .from('plantillas')
    .update({ estado: 'archived', estado_plantilla: 'Archivada' })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select('id,estado,estado_plantilla,publicacion_opcion,updated_at')
    .single();
  if (archived.error) throw archived.error;

  await appendTemplateAuditEvent(context, {
    eventType: 'template.archived',
    summary: 'Plantilla archivada',
    templateId: id,
    request,
    payload: {
      previous_status: source.estado,
      previous_display_status: source.estado_plantilla,
      status: 'archived',
    },
  });
  return NextResponse.json({ data: archived.data });
}

async function reactivateTemplate(request: NextRequest, id: string, workspaceId: string) {
  const context = await resolveTemplatePublicationContext(request, workspaceId, id);
  const source = context.template;
  if (!source) {
    throw new OrganizationApiError(404, 'template_not_found', 'Plantilla no encontrada.');
  }
  if (source.estado !== 'archived') {
    return NextResponse.json({
      data: {
        id: source.id,
        estado: source.estado,
        estado_plantilla: source.estado_plantilla,
        publicacion_opcion: source.publicacion_opcion,
      },
      alreadyActive: true,
    });
  }

  const previousAction =
    source.publicacion_opcion === 'publicar' || source.publicacion_opcion === 'aprobacion'
      ? source.publicacion_opcion
      : 'borrador';
  const restoredState = deriveTemplateState(previousAction);
  const reactivated = await context.service
    .from('plantillas')
    .update({
      estado: restoredState.estado,
      estado_plantilla: restoredState.estadoPlantilla,
      publicacion_opcion: restoredState.publicacionOpcion,
    })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select('id,estado,estado_plantilla,publicacion_opcion,updated_at')
    .single();
  if (reactivated.error) throw reactivated.error;

  await appendTemplateAuditEvent(context, {
    eventType: 'template.reactivated',
    summary: 'Plantilla reactivada',
    templateId: id,
    request,
    payload: { status: restoredState.estado, display_status: restoredState.estadoPlantilla },
  });
  return NextResponse.json({ data: reactivated.data });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
    if (body.action === 'archive') return await archiveTemplate(request, id, workspaceId);
    if (body.action === 'reactivate') return await reactivateTemplate(request, id, workspaceId);
    throw new OrganizationApiError(
      400,
      'template_lifecycle_action_invalid',
      'La acción solicitada no es válida.'
    );
  } catch (cause) {
    return templateApiFailure(cause);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const workspaceId = new URL(request.url).searchParams.get('workspace_id') || '';
    return await archiveTemplate(request, id, workspaceId);
  } catch (cause) {
    return templateApiFailure(cause);
  }
}
