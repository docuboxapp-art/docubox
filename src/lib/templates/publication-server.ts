import { randomUUID } from 'crypto';
import type { User } from '@supabase/supabase-js';
import { authenticateOrganizationRequest, OrganizationApiError } from '@/lib/organization/server';

export type TemplatePublicationAction =
  | 'borrador'
  | 'publicar'
  | 'aprobacion'
  | 'actualizar'
  | 'version';

type TemplateRecord = {
  id: string;
  workspace_id: string | null;
  created_by: string | null;
  estado: string | null;
  estado_plantilla: string | null;
  publicacion_opcion: string | null;
  version_publicada: string | null;
  source_template_id: string | null;
  root_template_id: string | null;
  approval_workflow_instance_id: string | null;
  area_responsable: string | null;
  tipo_plantilla: string | null;
};

type PublicationContext = {
  user: User;
  service: Awaited<ReturnType<typeof authenticateOrganizationRequest>>['service'];
  userClient: Awaited<ReturnType<typeof authenticateOrganizationRequest>>['userClient'];
  workspace: {
    id: string;
    name: string;
    workspace_type: 'personal' | 'business';
    owner_id: string;
    organization_settings: Record<string, unknown> | null;
  };
  membership: { role: string };
  template: TemplateRecord | null;
  canManageResources: boolean;
  approvalRequired: boolean;
  approvalWorkflow: { id: string; name: string; version: number } | null;
  canSaveDraft: boolean;
  canPublish: boolean;
  canSubmitApproval: boolean;
  canCreateVersion: boolean;
};

export type TemplateState = {
  estado: 'draft' | 'in_review' | 'published';
  estadoPlantilla: 'Borrador' | 'En revisión' | 'Publicada';
  publicacionOpcion: Exclude<TemplatePublicationAction, 'actualizar' | 'version'>;
};

export function parseTemplateAction(value: unknown): TemplatePublicationAction {
  if (
    value === 'publicar' ||
    value === 'aprobacion' ||
    value === 'actualizar' ||
    value === 'version'
  )
    return value;
  return 'borrador';
}

export function deriveTemplateState(action: TemplatePublicationAction): TemplateState {
  if (action === 'publicar') {
    return { estado: 'published', estadoPlantilla: 'Publicada', publicacionOpcion: 'publicar' };
  }
  if (action === 'aprobacion') {
    return { estado: 'in_review', estadoPlantilla: 'En revisión', publicacionOpcion: 'aprobacion' };
  }
  return { estado: 'draft', estadoPlantilla: 'Borrador', publicacionOpcion: 'borrador' };
}

export function resolveTemplateVersionTarget(
  context: PublicationContext,
  requestedAction: unknown
): Exclude<TemplatePublicationAction, 'actualizar' | 'version'> {
  if (requestedAction === 'publicar') {
    if (!context.canPublish) {
      throw new OrganizationApiError(
        403,
        'template_publish_forbidden',
        'No tienes permiso para publicar directamente esta versión.'
      );
    }
    return 'publicar';
  }
  if (requestedAction === 'aprobacion') {
    if (!context.canSubmitApproval) {
      throw new OrganizationApiError(
        403,
        'template_approval_unavailable',
        'No existe un flujo de aprobación aplicable para esta versión.'
      );
    }
    return 'aprobacion';
  }
  if (requestedAction === 'borrador') {
    if (!context.canSaveDraft) {
      throw new OrganizationApiError(
        409,
        'template_review_in_progress',
        'La versión no puede guardarse como borrador en su estado actual.'
      );
    }
    return 'borrador';
  }

  if (context.canPublish) return 'publicar';
  if (context.canSubmitApproval) return 'aprobacion';
  if (context.canSaveDraft) return 'borrador';
  throw new OrganizationApiError(
    403,
    'template_version_target_unavailable',
    'No hay una acción disponible para guardar la nueva versión.'
  );
}

export function buildTemplateMutationPayload(
  body: Record<string, unknown>,
  context: PublicationContext,
  state: TemplateState,
  version: string
) {
  return {
    nombre:
      typeof body.nombre === 'string' && body.nombre.trim()
        ? body.nombre.trim()
        : 'Nueva Plantilla',
    descripcion: typeof body.descripcion === 'string' ? body.descripcion : null,
    numero_oficio: typeof body.numeroOficio === 'string' ? body.numeroOficio : null,
    area_responsable:
      context.workspace.workspace_type === 'business' && typeof body.areaResponsable === 'string'
        ? body.areaResponsable || null
        : null,
    tipo_plantilla: typeof body.tipoPlantilla === 'string' ? body.tipoPlantilla || null : null,
    etiquetas_ids: Array.isArray(body.etiquetasIds) ? body.etiquetasIds : [],
    tipo_documento_id:
      typeof body.tipoDocumentoId === 'string' && body.tipoDocumentoId
        ? body.tipoDocumentoId
        : null,
    grupo_tipo_id:
      typeof body.grupotipoId === 'string' && body.grupotipoId ? body.grupotipoId : null,
    hoja_tamano: typeof body.hojaTamano === 'string' ? body.hojaTamano : 'Carta (Letter)',
    hoja_orientacion: body.hojaOrientacion === 'horizontal' ? 'horizontal' : 'vertical',
    contenido_html: typeof body.contenidoHtml === 'string' ? body.contenidoHtml : null,
    campos_insertados: Array.isArray(body.camposInsertados) ? body.camposInsertados : [],
    publicacion_opcion: state.publicacionOpcion,
    comentario_publicacion:
      typeof body.comentarioPublicacion === 'string' ? body.comentarioPublicacion || null : null,
    estado_plantilla: state.estadoPlantilla,
    version_publicada: version,
    estado: state.estado,
    category: typeof body.category === 'string' ? body.category || null : null,
    fields: Array.isArray(body.fields) ? body.fields : [],
    content:
      body.content && typeof body.content === 'object' && !Array.isArray(body.content)
        ? body.content
        : {},
    signer_roles: Array.isArray(body.signerRoles) ? body.signerRoles : [],
    margenes:
      body.margenes && typeof body.margenes === 'object' && !Array.isArray(body.margenes)
        ? body.margenes
        : { top: 2.54, bottom: 2.54, left: 3.17, right: 3.17 },
    show_header: body.showHeader === true,
    show_footer: body.showFooter === true,
    campo_coordenadas: Array.isArray(body.camposCoordenadas) ? body.camposCoordenadas : [],
    approval_workflow_id:
      state.publicacionOpcion === 'aprobacion' ? context.approvalWorkflow?.id || null : null,
  };
}

export function templateActionEvent(
  action: Exclude<TemplatePublicationAction, 'actualizar' | 'version'>
) {
  if (action === 'publicar') {
    return { eventType: 'template.published', summary: 'Plantilla publicada' };
  }
  if (action === 'aprobacion') {
    return {
      eventType: 'template.submitted_for_approval',
      summary: 'Plantilla enviada a aprobación',
    };
  }
  return { eventType: 'template.draft.saved', summary: 'Borrador de plantilla guardado' };
}

function templateIsPublished(template: TemplateRecord | null) {
  return template?.estado === 'published' || template?.estado_plantilla === 'Publicada';
}

export async function resolveTemplatePublicationContext(
  request: Request,
  workspaceId: string,
  templateId?: string | null
): Promise<PublicationContext> {
  if (!workspaceId) {
    throw new OrganizationApiError(400, 'workspace_required', 'Selecciona un espacio de trabajo.');
  }

  const authenticated = await authenticateOrganizationRequest(request);
  const { user, service, userClient } = authenticated;
  const [workspaceResult, membershipResult] = await Promise.all([
    service
      .from('workspaces')
      .select('id,name,workspace_type,owner_id,organization_settings')
      .eq('id', workspaceId)
      .maybeSingle(),
    service
      .from('workspace_members')
      .select('role,status,access_expires_at')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .maybeSingle(),
  ]);

  if (workspaceResult.error) throw workspaceResult.error;
  if (membershipResult.error) throw membershipResult.error;
  const workspace = workspaceResult.data;
  const membership = membershipResult.data;
  const membershipExpired =
    membership?.access_expires_at && new Date(membership.access_expires_at).getTime() <= Date.now();
  if (!workspace || !membership || membership.status !== 'active' || membershipExpired) {
    throw new OrganizationApiError(
      403,
      'workspace_access_denied',
      'No tienes acceso activo a este espacio de trabajo.'
    );
  }

  const isBusiness = workspace.workspace_type === 'business';
  let canManageResources = workspace.owner_id === user.id || membership.role === 'owner';
  if (isBusiness && !canManageResources) {
    const permission = await userClient.rpc('has_organization_permission', {
      ws_id: workspaceId,
      requested_permission: 'resources.manage',
    });
    if (permission.error) throw permission.error;
    canManageResources = permission.data === true;
  }

  const settings = (workspace.organization_settings || {}) as Record<string, unknown>;
  const defaultWorkflowId =
    typeof settings.default_workflow_id === 'string' ? settings.default_workflow_id : null;
  let approvalWorkflow: PublicationContext['approvalWorkflow'] = null;
  if (isBusiness && defaultWorkflowId) {
    const workflow = await service
      .from('organization_approval_workflows')
      .select('id,name,version')
      .eq('workspace_id', workspaceId)
      .eq('id', defaultWorkflowId)
      .eq('status', 'published')
      .maybeSingle();
    if (workflow.error) throw workflow.error;
    approvalWorkflow = workflow.data;
  }

  let template: TemplateRecord | null = null;
  if (templateId) {
    const templateResult = await service
      .from('plantillas')
      .select(
        'id,workspace_id,created_by,estado,estado_plantilla,publicacion_opcion,version_publicada,source_template_id,root_template_id,approval_workflow_instance_id,area_responsable,tipo_plantilla'
      )
      .eq('id', templateId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (templateResult.error) throw templateResult.error;
    if (!templateResult.data) {
      throw new OrganizationApiError(404, 'template_not_found', 'Plantilla no encontrada.');
    }
    if (templateResult.data.created_by !== user.id && !canManageResources) {
      throw new OrganizationApiError(
        403,
        'template_access_denied',
        'No tienes permiso para administrar esta plantilla.'
      );
    }
    template = templateResult.data;
  }

  const approvalRequired = Boolean(approvalWorkflow);
  const templateInReview =
    template?.estado === 'in_review' || template?.estado_plantilla === 'En revisión';
  const personalOwner = !isBusiness && workspace.owner_id === user.id;
  const canPublish =
    !templateInReview && (personalOwner || (isBusiness && canManageResources && !approvalRequired));
  const canSubmitApproval = isBusiness && approvalRequired && !templateInReview;
  const canCreateVersion =
    templateIsPublished(template) && (personalOwner || (isBusiness && canManageResources));

  return {
    user,
    service,
    userClient,
    workspace: workspace as PublicationContext['workspace'],
    membership: { role: membership.role },
    template,
    canManageResources,
    approvalRequired,
    approvalWorkflow,
    canSaveDraft: !templateInReview,
    canPublish,
    canSubmitApproval,
    canCreateVersion,
  };
}

export async function startTemplateApprovalWorkflow(
  context: PublicationContext,
  templateId: string,
  comment: string | null
) {
  if (!context.approvalWorkflow) {
    throw new OrganizationApiError(
      409,
      'template_approval_workflow_missing',
      'El flujo de aprobación configurado ya no está disponible.'
    );
  }
  const instance = await context.userClient.rpc('submit_template_for_approval', {
    ws_id: context.workspace.id,
    target_workflow_id: context.approvalWorkflow.id,
    target_template_id: templateId,
    requested_context: {
      template_id: templateId,
      publication_comment: comment,
    },
    requested_idempotency_key: randomUUID(),
  });
  if (instance.error) throw instance.error;
  if (typeof instance.data !== 'string') {
    throw new Error('El flujo de aprobación no devolvió una instancia válida.');
  }
  return instance.data;
}

export function assertTemplateActionAllowed(
  context: PublicationContext,
  action: TemplatePublicationAction,
  creating: boolean
) {
  if (action === 'borrador' && !context.canSaveDraft) {
    throw new OrganizationApiError(
      409,
      'template_review_in_progress',
      'La plantilla está en revisión y no puede volver a borrador desde esta pantalla.'
    );
  }
  if (action === 'actualizar' || action === 'version') {
    if (creating || !context.canCreateVersion) {
      throw new OrganizationApiError(
        403,
        'template_version_forbidden',
        'No puedes crear una versión nueva de esta plantilla.'
      );
    }
    return;
  }
  if (action === 'publicar' && !context.canPublish) {
    throw new OrganizationApiError(
      403,
      'template_publish_forbidden',
      'No tienes permiso para publicar directamente en este espacio.'
    );
  }
  if (action === 'aprobacion' && !context.canSubmitApproval) {
    throw new OrganizationApiError(
      403,
      'template_approval_unavailable',
      'No existe un flujo de aprobación aplicable para esta plantilla.'
    );
  }
}

export function nextTemplateVersion(values: Array<string | null | undefined>) {
  let major = 1;
  let minor = -1;
  for (const value of values) {
    const match = String(value || '').match(/^(\d+)\.(\d+)$/);
    if (!match) continue;
    const candidateMajor = Number(match[1]);
    const candidateMinor = Number(match[2]);
    if (candidateMajor > major || (candidateMajor === major && candidateMinor > minor)) {
      major = candidateMajor;
      minor = candidateMinor;
    }
  }
  return `${major}.${Math.max(0, minor) + 1}`;
}

export async function appendTemplateAuditEvent(
  context: PublicationContext,
  input: {
    eventType: string;
    templateId: string;
    summary: string;
    payload?: Record<string, unknown>;
    request: Request;
  }
) {
  if (context.workspace.workspace_type !== 'business') return;
  const requestId = input.request.headers.get('x-request-id') || randomUUID();
  const result = await context.service.from('organization_audit_events').insert({
    workspace_id: context.workspace.id,
    actor_user_id: context.user.id,
    event_type: input.eventType,
    resource_type: 'document_template',
    resource_id: input.templateId,
    summary: input.summary,
    payload: input.payload || {},
    outcome: 'success',
    severity: 'info',
    module: 'templates',
    origin: 'api',
    correlation_id: requestId,
    ip_address: input.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    user_agent: input.request.headers.get('user-agent'),
  });
  if (result.error) throw result.error;
}

export function templateApiFailure(cause: unknown) {
  const error = cause as { status?: number; code?: string; message?: string };
  const status = typeof error.status === 'number' ? error.status : 500;
  return Response.json(
    {
      error:
        status >= 500
          ? 'No se pudo completar la operación de la plantilla.'
          : error.message || 'Solicitud inválida.',
      code: error.code || 'template_operation_failed',
    },
    { status }
  );
}
